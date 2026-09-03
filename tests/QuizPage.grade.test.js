// @vitest-environment jsdom
//
// 코드 퀴즈 화면의 채점 흐름 (BLUEPRINT §4.2 · §5 Phase 3).
//
// 지키려는 것 세 가지:
//   1) 정답 조기 노출 금지 — `정답 확인` 전에는 풀이도 AI 채점도 없다
//   2) AI 채점은 보조 — 서버가 없어도, 확신이 낮아도 자기 채점으로 학습이 이어진다
//   3) 저장 계약 — quiz_results 에 'correct'/'incorrect' 만 새로 쓴다
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuizPage from '../src/pages/QuizPage.jsx';
import { loadProgress, saveProgress } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 환경에서는 import.meta.url 이 file: URL 이 아니라 http: 라
// new URL(...) 로 픽스처 경로를 만들 수 없다. vitest 의 cwd(프로젝트 루트)에서 잡는다.
const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(QuizPage)));
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

function buttonByName(container, name) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function grade(overrides = {}) {
  return {
    verdict: 'correct',
    score: 100,
    feedback: '출력이 정확합니다.',
    missedPoints: [],
    confidence: 0.92,
    ...overrides,
  };
}

/** 채점 응답을 지정한다. 교재 md 요청은 언제나 픽스처로 답한다. */
let gradeResponder;

beforeEach(() => {
  localStorage.clear();
  gradeResponder = () => jsonResponse(grade());
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('/api/ai/grade')) return Promise.resolve(gradeResponder());
      return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// React 는 자체 value 트래커를 두고 있어 input.value 에 그냥 대입하면
// onChange 가 돌지 않는다. 네이티브 setter 로 값을 넣어야 변경으로 인식한다.
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 첫 문항에 답을 적는다 (정답 확인은 누르지 않는다) */
async function typeAnswer(container, answer = '30 50') {
  await act(async () => { typeInto(container.querySelector('input.quiz-input'), answer); });
}

/** 첫 문항을 풀고 `정답 확인`까지 누른 상태를 만든다 */
async function answerFirstProblem(container, answer = '30 50') {
  await typeAnswer(container, answer);
  await act(async () => { buttonByName(container, '정답 확인').click(); });
  await flush();
}

describe('정답 조기 노출 방지', () => {
  it('정답 확인 전에는 풀이도 AI 채점도 자기 채점도 없다', async () => {
    const { container, unmount } = render();
    await flush();

    expect(container.textContent).toContain('C-01');
    expect(container.textContent).not.toContain('AI 채점');
    expect(container.textContent).not.toContain('맞았어요');
    // 풀이(추적표)는 정답 확인 전에는 화면에 없다
    expect(container.textContent).not.toContain('추적표');

    unmount();
  });

  it('답을 적어도 정답 확인 전에는 어떤 AI 요청도 나가지 않는다', async () => {
    const { container, unmount } = render();
    await flush();

    await typeAnswer(container);

    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/ai/'))).toHaveLength(0);

    unmount();
  });

  it('정답 확인을 눌러야 풀이와 AI 채점 패널이 함께 나타난다', async () => {
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    expect(container.textContent).toContain('추적표');
    expect(container.textContent).toContain('AI 채점');
    // 패널이 떠도 요청은 사용자가 버튼을 눌러야만 나간다
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/ai/'))).toHaveLength(0);

    unmount();
  });
});

describe('AI 채점 확정분 저장', () => {
  it('확신이 충분한 판정은 quiz_results 에 correct 로 저장한다', async () => {
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    expect(loadProgress('quiz_results', {})['C-01']).toBe('answered');

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(loadProgress('quiz_results', {})['C-01']).toBe('correct');
    expect(container.textContent).toContain('정답');

    unmount();
  });

  it('partial 판정은 오답으로 저장한다 — 정답률을 부풀리지 않는다', async () => {
    gradeResponder = () => jsonResponse(grade({ verdict: 'partial', score: 60, confidence: 0.8 }));
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(loadProgress('quiz_results', {})['C-01']).toBe('incorrect');

    unmount();
  });
});

describe('confidence 폴백 — 자기 채점으로 넘어간다', () => {
  it('확신이 낮으면 확정 저장하지 않고 직접 확인을 요청한다', async () => {
    gradeResponder = () => jsonResponse(grade({ verdict: 'incorrect', confidence: 0.55 }));
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    // 판정이 저장되지 않는다 — 시도 기록만 남는다
    expect(loadProgress('quiz_results', {})['C-01']).toBe('answered');
    expect(container.textContent).toContain('직접');

    // 사용자가 직접 고르면 그때 저장된다
    await act(async () => { buttonByName(container, '틀렸어요').click(); });
    expect(loadProgress('quiz_results', {})['C-01']).toBe('incorrect');

    unmount();
  });
});

describe('서버가 없어도 학습은 이어진다', () => {
  it('채점 요청이 실패해도 자기 채점 버튼은 그대로 동작한다', async () => {
    gradeResponder = () => { throw new TypeError('Failed to fetch'); };
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(container.textContent).toContain('연결하지 못했습니다');

    await act(async () => { buttonByName(container, '맞았어요').click(); });
    expect(loadProgress('quiz_results', {})['C-01']).toBe('correct');

    unmount();
  });

  it('AI 를 한 번도 부르지 않아도 자기 채점만으로 저장된다', async () => {
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '틀렸어요').click(); });

    expect(loadProgress('quiz_results', {})['C-01']).toBe('incorrect');
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/ai/'))).toHaveLength(0);

    unmount();
  });

  it('자기 채점은 되돌릴 수 있다 — 오판을 고칠 길이 있어야 한다', async () => {
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '맞았어요').click(); });
    await act(async () => { buttonByName(container, '틀렸어요').click(); });

    expect(loadProgress('quiz_results', {})['C-01']).toBe('incorrect');

    unmount();
  });
});

describe('레거시 데이터와의 공존', () => {
  it('레거시 answered 가 쌓여 있어도 진도 표시가 그대로 동작한다', async () => {
    saveProgress('quiz_results', { 'C-01': 'answered', 'C-02': 'answered', 'C-03': 'correct' });
    const { container, unmount } = render();
    await flush();

    // 풀이 완료 = 시도한 문항 수(세 값 모두) — 레거시를 빠뜨리면 진도가 뒤로 간다
    expect(container.querySelector('.stat-box .value').textContent).toBeTruthy();
    expect(container.textContent).toContain('풀이 완료');

    unmount();
  });

  it('레거시 값은 자기 채점으로 덮어써진다', async () => {
    saveProgress('quiz_results', { 'C-01': 'answered' });
    const { container, unmount } = render();
    await flush();
    await answerFirstProblem(container);

    await act(async () => { buttonByName(container, '맞았어요').click(); });

    expect(loadProgress('quiz_results', {})['C-01']).toBe('correct');

    unmount();
  });
});
