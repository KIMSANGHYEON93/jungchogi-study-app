// @vitest-environment jsdom
//
// 모의고사 화면의 채점 흐름 (BLUEPRINT §4.2 · §5 Phase 3).
//
// 모의고사는 단답형(quiz100)과 코드 트레이싱(codedrill)을 섞어 내므로
// `kind`·`source` 를 화면이 아니라 **문항 데이터**에서 유도해야 한다.
// 그리고 시험 중에는 채점 자체가 존재하면 안 된다 — 아직 안 푼 문제의 답이 샌다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExamPage from '../src/pages/ExamPage.jsx';
import { loadProgress } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 에서는 import.meta.url 이 file: 가 아니라 http: 라 cwd 로 잡는다.
const QUIZ_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/quiz-sample.md'), 'utf-8');
const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(ExamPage)));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
});

function buttonByName(scope, name) {
  return [...scope.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GRADE = {
  verdict: 'correct',
  score: 100,
  feedback: '핵심 용어가 모두 들어 있습니다.',
  missedPoints: [],
  confidence: 0.9,
};

let gradeResponder;

beforeEach(() => {
  localStorage.clear();
  gradeResponder = () => jsonResponse(GRADE);
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/ai/grade')) return Promise.resolve(gradeResponder());
      if (u.includes('코드트레이싱')) return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
      return Promise.resolve(new Response(QUIZ_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function startExam(container) {
  await flush();
  await act(async () => { buttonByName(container, '시험 시작').click(); });
  await flush();
}

async function submitExam(container) {
  await act(async () => { buttonByName(container, '시험 제출').click(); });
  await flush();
}

/** 결과 화면에서 AI 채점 패널을 가진 문항 카드들 */
function questionCards(container) {
  return [...container.querySelectorAll('.card')].filter((c) => c.querySelector('.ai-grade'));
}

describe('시험 중에는 채점이 존재하지 않는다', () => {
  it('시험 화면에는 AI 채점 패널도 정답 블록도 없다', async () => {
    const { container, unmount } = render();
    await startExam(container);

    expect(container.textContent).toContain('문제 1 /');
    expect(container.querySelector('.ai-grade')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('AI 채점');

    unmount();
  });

  it('시험 중에는 어떤 AI 요청도 나가지 않는다', async () => {
    const { container, unmount } = render();
    await startExam(container);

    const textarea = container.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set;
      setter.call(textarea, '원자성');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/ai/'))).toHaveLength(0);

    unmount();
  });
});

describe('제출 후에만 채점을 붙인다', () => {
  it('결과 화면의 모든 문항에 AI 채점 패널이 붙는다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const cards = questionCards(container);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBe(container.querySelectorAll('details').length);

    unmount();
  });

  it('패널이 떠 있어도 버튼을 누르기 전에는 요청하지 않는다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/ai/'))).toHaveLength(0);

    unmount();
  });
});

describe('kind·source 는 문항 데이터에서 유도한다', () => {
  /** 결과 화면에서 원하는 종류(단답형/코드)의 첫 카드를 찾는다 */
  function cardOfType(container, label) {
    return questionCards(container).find((c) => {
      const badge = c.querySelector('.badge');
      return label === 'quiz'
        ? badge?.textContent.includes('단답형')
        : !badge?.textContent.includes('단답형');
    });
  }

  it('단답형 문항은 short + quiz100 으로 채점을 요청한다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const card = cardOfType(container, 'quiz');
    expect(card).toBeTruthy();
    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    const body = JSON.parse(
      fetch.mock.calls.find(([u]) => String(u).includes('/api/ai/grade'))[1].body
    );
    expect(body.kind).toBe('short');
    expect(body.source).toBe('quiz100');
    expect(body.id).toMatch(/^\d{3}$/);

    unmount();
  });

  it('코드 트레이싱 문항은 code + codedrill 로 채점을 요청한다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const card = cardOfType(container, 'code');
    expect(card).toBeTruthy();
    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    const body = JSON.parse(
      fetch.mock.calls.find(([u]) => String(u).includes('/api/ai/grade'))[1].body
    );
    expect(body.kind).toBe('code');
    expect(body.source).toBe('codedrill');
    expect(body.id).toMatch(/^[CJPS]-\d{2}$/);

    unmount();
  });
});

describe('모의고사 채점은 코드 퀴즈 진도를 건드리지 않는다', () => {
  it('채점해도 quiz_results 에 쓰지 않는다 — 두 화면의 문항 집합이 달라 진도가 어긋난다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const card = questionCards(container)[0];
    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(container.textContent).toContain('정답');
    expect(loadProgress('quiz_results', null)).toBeNull();

    unmount();
  });
});

describe('서버가 없어도 결과 화면은 그대로다', () => {
  it('채점이 실패해도 정답 확인과 오답노트 추가는 남아 있다', async () => {
    gradeResponder = () => { throw new TypeError('Failed to fetch'); };
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const card = questionCards(container)[0];
    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(card.textContent).toContain('연결하지 못했습니다');
    expect(card.querySelector('details')).toBeTruthy();

    await act(async () => { buttonByName(card, '오답노트에 추가').click(); });
    expect(loadProgress('wrong_notes', [])).toHaveLength(1);

    unmount();
  });
});
