// @vitest-environment jsdom
//
// 모의고사 채점 결과의 저장 (BLUEPRINT §5 "Phase 3 에서 남긴 것").
//
// Phase 3 은 모의고사 채점을 **어디에도 쌓지 않았다.** `quiz_results` 는 id 만 키로
// 쓰는 평평한 맵이고 코드 퀴즈 40문항 진도(`quizDone/40`)가 거기 걸려 있어,
// 모의고사가 낸 단답형 id(`042`)가 섞이면 진도가 40 을 넘기 때문이다.
// 그래서 별도 키 `exam_results` 를 두고, 값 계약은 `quiz_results` 와 똑같이 맞춘다
// (`'correct'|'incorrect'|'answered'`) — 약점 분석이 두 맵을 한 규칙으로 세야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExamPage from '../src/pages/ExamPage.jsx';
import { getExamResults, loadProgress, saveExamResults } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const CONFIDENT = {
  verdict: 'correct',
  score: 100,
  feedback: '핵심 용어가 모두 들어 있습니다.',
  missedPoints: [],
  confidence: 0.9,
};

let gradeResponder;

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  gradeResponder = () => jsonResponse(CONFIDENT);
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/ai/grade')) return Promise.resolve(gradeResponder());
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

/** 카드가 어느 문항인지 — AI 채점 패널의 제목 id 가 `ai-grade-title-<문항 id>` 다 */
function idOf(card) {
  return card.querySelector('.ai-grade-title').id.replace('ai-grade-title-', '');
}

/** 결과 화면을 열고 첫 문항 카드를 돌려준다 */
async function toResult(container) {
  await startExam(container);
  await submitExam(container);
  const card = questionCards(container)[0];
  return { card, id: idOf(card) };
}

describe('AI 채점 확정분', () => {
  it('exam_results 에 정오를 남긴다', async () => {
    const { container, unmount } = render();
    const { card, id } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(getExamResults()[id]).toBe('correct');
    unmount();
  });

  it('partial 은 오답으로 접어 저장한다', async () => {
    // 저장 계약에 중간값이 없고, 못 짚은 부분이 남았는데 정답으로 세면 정답률이 부푼다
    gradeResponder = () => jsonResponse({ ...CONFIDENT, verdict: 'partial', score: 50 });
    const { container, unmount } = render();
    const { card, id } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(getExamResults()[id]).toBe('incorrect');
    unmount();
  });

  it('확신이 낮은 판정(confidence < 0.6)은 저장하지 않는다', async () => {
    // §4.2 의 폴백 경계. 근거가 약한 판정을 확정으로 쌓으면 약점 분석이 그 위에서 돈다
    gradeResponder = () => jsonResponse({ ...CONFIDENT, confidence: 0.4 });
    const { container, unmount } = render();
    const { card } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(card.textContent).toContain('확신하지 못한');
    expect(getExamResults()).toEqual({});
    unmount();
  });

  it('채점이 실패해도 아무것도 쌓지 않는다', async () => {
    gradeResponder = () => { throw new TypeError('Failed to fetch'); };
    const { container, unmount } = render();
    const { card } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();

    expect(getExamResults()).toEqual({});
    unmount();
  });
});

describe('자기 채점', () => {
  it('맞았어요·틀렸어요가 exam_results 에 남는다', async () => {
    const { container, unmount } = render();
    const { card, id } = await toResult(container);

    await act(async () => { buttonByName(card, '맞았어요').click(); });
    expect(getExamResults()[id]).toBe('correct');

    await act(async () => { buttonByName(card, '틀렸어요').click(); });
    expect(getExamResults()[id]).toBe('incorrect');
    unmount();
  });

  it('확신이 낮은 AI 판정 뒤에도 사용자가 직접 확정할 수 있다', async () => {
    gradeResponder = () => jsonResponse({ ...CONFIDENT, confidence: 0.4 });
    const { container, unmount } = render();
    const { card, id } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();
    expect(getExamResults()).toEqual({});

    await act(async () => { buttonByName(card, '맞았어요').click(); });
    expect(getExamResults()[id]).toBe('correct');
    unmount();
  });

  it('채점 상태를 화면에 되비친다', async () => {
    const { container, unmount } = render();
    const { card } = await toResult(container);

    expect(card.textContent).toContain('아직 채점하지 않음');
    await act(async () => { buttonByName(card, '틀렸어요').click(); });
    expect(card.textContent).toContain('오답으로 기록됨');
    unmount();
  });

  it('문항마다 따로 기록한다', async () => {
    const { container, unmount } = render();
    await startExam(container);
    await submitExam(container);

    const [first, second] = questionCards(container);
    await act(async () => { buttonByName(first, '맞았어요').click(); });
    await act(async () => { buttonByName(second, '틀렸어요').click(); });

    expect(getExamResults()).toEqual({
      [idOf(first)]: 'correct',
      [idOf(second)]: 'incorrect',
    });
    unmount();
  });
});

describe('다른 진도와 섞이지 않는다', () => {
  it('모의고사 채점은 quiz_results 를 건드리지 않는다', async () => {
    // 이 맵은 코드 퀴즈 40문항의 진도를 센다. 모의고사 id 가 섞이면 진도가 40 을 넘는다
    const { container, unmount } = render();
    const { card } = await toResult(container);

    await act(async () => { buttonByName(card, '채점 요청').click(); });
    await flush();
    await act(async () => { buttonByName(card, '틀렸어요').click(); });

    expect(loadProgress('quiz_results', null)).toBeNull();
    unmount();
  });

  it('지난 시험의 기록 위에 덧쌓인다', async () => {
    saveExamResults({ '999': 'incorrect' });
    const { container, unmount } = render();
    const { card, id } = await toResult(container);

    await act(async () => { buttonByName(card, '맞았어요').click(); });

    expect(getExamResults()['999']).toBe('incorrect');
    expect(getExamResults()[id]).toBe('correct');
    unmount();
  });

  it('용량이 꽉 차도 결과 화면이 죽지 않는다', async () => {
    const { container, unmount } = render();
    const { card } = await toResult(container);

    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota; });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => { buttonByName(card, '맞았어요').click(); });

    expect(card.textContent).toContain('정답으로 기록됨');
    unmount();
  });
});
