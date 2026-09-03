// @vitest-environment jsdom
//
// 모의고사의 AI 변형 문제 (BLUEPRINT §4.4).
//
// 모의고사는 두 교재에서 섞어 내므로 변형도 두 교재 몫을 각각 읽어야 한다.
// 시험 중에도 결과 화면에도 변형임이 보여야 한다 — 실전처럼 푸는 화면에서
// AI 가 만든 정답을 교재 정답으로 오인하면 그대로 외운다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExamPage from '../src/pages/ExamPage.jsx';
import { loadProgress, setIncludeVariants } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUIZ_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/quiz-sample.md'), 'utf-8');
const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');

const DRILL_GENERATED = {
  version: 1,
  source: 'codedrill',
  generatedAt: '2026-09-03T12:00:00.000Z',
  model: 'claude-opus-5',
  reviewed: true,
  items: [
    {
      id: 'C-01-v1',
      title: '포인터 기본 변형',
      context: '',
      code: 'int a=3; int *p=&a; *p+=4;',
      lang: 'c',
      answer: '출력: 7',
      expectedOutput: '7',
      pitfall: '',
      variantOf: 'C-01',
      generated: true,
    },
  ],
};

/** codedrill 생성물. null 이면 파일이 없는 상태(404). */
let drillGenerated;

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

async function startExam(container) {
  await flush();
  await act(async () => { buttonByName(container, '시험 시작').click(); });
  await flush();
}

async function submitExam(container) {
  await act(async () => { buttonByName(container, '시험 제출').click(); });
  await flush();
}

/** 결과 화면에서 특정 문항 id·제목을 담은 카드 */
function cardContaining(container, text) {
  return [...container.querySelectorAll('.card')].find((c) => c.textContent.includes(text));
}

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  drillGenerated = DRILL_GENERATED;
  // 검수 전 생성물 경고는 이 테스트가 일부러 만드는 상황이다 — 출력만 막는다
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/ai/')) return Promise.reject(new Error('이 테스트는 AI 를 부르지 않는다'));
      if (u.includes('/data/generated/codedrill')) {
        if (!drillGenerated) return Promise.resolve(new Response('Not Found', { status: 404 }));
        return Promise.resolve(new Response(JSON.stringify(drillGenerated), { status: 200 }));
      }
      if (u.includes('/data/generated/')) return Promise.resolve(new Response('Not Found', { status: 404 }));
      if (u.includes('코드트레이싱')) return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
      return Promise.resolve(new Response(QUIZ_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('변형 포함 토글', () => {
  it('시작 화면에 켜기 버튼이 있다', async () => {
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeTruthy();
    unmount();
  });

  // ★ 검수 전 생성물은 어떤 경로로도 학습에 들어가지 않는다
  it('reviewed 가 false 면 켜기 버튼이 없다', async () => {
    drillGenerated = { ...DRILL_GENERATED, reviewed: false };
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeUndefined();
    unmount();
  });

  it('꺼져 있으면 변형이 출제되지 않는다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(container.textContent).not.toContain('C-01-v1');
    unmount();
  });

  it('켜면 변형이 출제 풀에 들어온다', async () => {
    // 픽스처 풀이 작아 코드 문항 5개(교재 4 + 변형 1)가 모두 출제된다
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(container.textContent).toContain('포인터 기본 변형');
    unmount();
  });
});

describe('변형 문항 표시', () => {
  it('결과 화면의 변형 문항에는 AI 변형 배지가 붙는다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(cardContaining(container, '포인터 기본 변형').textContent).toContain('AI 변형');
    unmount();
  });

  it('교재 문항에는 배지가 붙지 않는다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(cardContaining(container, '트랜잭션의 4가지').textContent).not.toContain('AI 변형');
    unmount();
  });
});

describe('변형 문항은 서버 API 를 부르지 않는다', () => {
  it('결과 화면의 변형 문항에는 AI 채점 패널이 없다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(cardContaining(container, '포인터 기본 변형').querySelector('.ai-grade')).toBeNull();
    unmount();
  });

  it('교재 문항에는 그대로 있다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);
    expect(cardContaining(container, '트랜잭션의 4가지').querySelector('.ai-grade')).not.toBeNull();
    unmount();
  });
});

describe('변형 오답노트', () => {
  it('변형을 오답노트에 넣으면 변형이라는 사실이 함께 남는다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const card = cardContaining(container, '포인터 기본 변형');
    await act(async () => { buttonByName(card, '오답노트에 추가').click(); });

    const saved = loadProgress('wrong_notes', []).find((n) => n.id === 'C-01-v1');
    expect(saved).toBeTruthy();
    expect(saved.generated).toBe(true);
    unmount();
  });
});
