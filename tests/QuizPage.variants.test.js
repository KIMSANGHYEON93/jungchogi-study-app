// @vitest-environment jsdom
//
// 코드 퀴즈 화면의 AI 변형 문제 (BLUEPRINT §4.4 · §5 Phase 4).
//
// 지키려는 것 네 가지:
//   1) 검수 전 생성물은 어떤 경로로도 학습에 들어가지 않는다
//   2) 변형은 화면에서 원본과 분명히 구분된다
//   3) 변형 진도가 `quiz_results` 를 오염시키지 않는다
//      — 대시보드 `quizDone/40` 과 이 화면의 "남은 문제"가 고정 분모를 쓴다
//   4) 변형 문항에서는 서버 API 버튼을 띄우지 않는다 (guard 의 ID_PATTERN 이 400 을 낸다)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuizPage from '../src/pages/QuizPage.jsx';
import { loadProgress, saveProgress, VARIANT_RESULTS_KEY } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');

function drillVariant(overrides = {}) {
  return {
    id: 'C-01-v1',
    title: '포인터 기본 변형',
    context: '',
    code: '#include <stdio.h>\nint main(){int a=3;int *p=&a;*p+=4;printf("%d",a);}',
    lang: 'c',
    answer: '출력: 7',
    expectedOutput: '7',
    pitfall: '',
    variantOf: 'C-01',
    generated: true,
    ...overrides,
  };
}

function generatedFile(overrides = {}) {
  return {
    version: 1,
    source: 'codedrill',
    generatedAt: '2026-09-03T12:00:00.000Z',
    model: 'claude-opus-5',
    reviewed: true,
    items: [drillVariant()],
    ...overrides,
  };
}

/** 이 테스트가 서버에 돌려줄 생성물. null 이면 파일이 없는 상태(404). */
let generated;

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

function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 변형 포함을 켜고 화면이 다시 그려지길 기다린다 */
async function enableVariants(container) {
  await act(async () => { buttonByName(container, 'AI 변형').click(); });
  await flush();
}

/** 마지막 문항(= 변형은 원본 뒤에 붙는다)으로 이동한다 */
async function goToLast(container) {
  const next = buttonByName(container, '다음');
  while (!next.disabled) {
    await act(async () => { next.click(); });
  }
  await flush();
}

/** 지금 문항에 답을 적고 `정답 확인`을 누른다 */
async function answerCurrent(container, answer = '7') {
  await act(async () => { typeInto(container.querySelector('input.quiz-input'), answer); });
  await act(async () => { buttonByName(container, '정답 확인').click(); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  generated = generatedFile();
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('/data/generated/')) {
        if (!generated) return Promise.resolve(new Response('Not Found', { status: 404 }));
        return Promise.resolve(new Response(JSON.stringify(generated), { status: 200 }));
      }
      return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('변형 포함 토글', () => {
  it('기본값은 꺼짐이라 교재 문항만 나온다', async () => {
    const { container, unmount } = render();
    await flush();
    // 픽스처의 교재 문항은 4개(C-01·J-01·S-01·S-05)
    expect(container.textContent).toContain('1 / 4');
    unmount();
  });

  it('쓸 수 있는 변형이 있으면 켜기 버튼이 보인다', async () => {
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeTruthy();
    unmount();
  });

  it('생성물이 없으면 켜기 버튼도 없다', async () => {
    generated = null;
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeUndefined();
    unmount();
  });

  // ★ 이 앱에서 가장 중요한 규칙
  it('reviewed 가 false 면 문항도 켜기 버튼도 나오지 않는다', async () => {
    generated = generatedFile({ reviewed: false });
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeUndefined();
    expect(container.textContent).toContain('1 / 4');
    unmount();
  });

  it('켜면 변형이 덱에 들어온다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    expect(container.textContent).toContain('1 / 5');
    unmount();
  });

  it('켠 상태는 저장돼 다음에 열 때도 유지된다', async () => {
    const first = render();
    await flush();
    await enableVariants(first.container);
    first.unmount();

    const second = render();
    await flush();
    expect(second.container.textContent).toContain('1 / 5');
    second.unmount();
  });

  it('다시 누르면 꺼지고 교재 문항만 남는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await enableVariants(container);
    expect(container.textContent).toContain('1 / 4');
    unmount();
  });
});

describe('변형 문항 표시', () => {
  it('변형 문항에는 AI 변형 배지가 붙는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    expect(container.textContent).toContain('C-01-v1');
    expect(container.textContent).toContain('AI 변형');
    unmount();
  });

  it('교재 문항에는 배지가 붙지 않는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    // 첫 문항은 교재의 C-01 이다. 필터 바의 토글 버튼 텍스트는 빼고 본다.
    const card = container.querySelector('.card');
    expect(card.textContent).toContain('C-01');
    expect(card.textContent).not.toContain('AI 변형');
    unmount();
  });

  it('변형의 정답에는 교재와 다를 수 있다고 알린다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);
    expect(container.textContent).toContain('교재와 다를 수 있으니');
    unmount();
  });
});

describe('변형 진도는 교재 진도와 섞이지 않는다', () => {
  it('변형을 풀어도 quiz_results 에 쓰지 않는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);

    // 대시보드 quizDone/40 과 이 화면의 "남은 문제"가 이 맵을 분모 고정으로 쓴다
    expect(loadProgress('quiz_results', {})).toEqual({});
    expect(loadProgress(VARIANT_RESULTS_KEY, {})).toEqual({ 'C-01-v1': 'answered' });
    unmount();
  });

  it('변형을 자기 채점해도 quiz_results 는 그대로다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);
    await act(async () => { buttonByName(container, '맞았어요').click(); });

    expect(loadProgress('quiz_results', {})).toEqual({});
    expect(loadProgress(VARIANT_RESULTS_KEY, {})).toEqual({ 'C-01-v1': 'correct' });
    unmount();
  });

  it('변형 채점 결과가 자기 채점 버튼에 반영된다', async () => {
    saveProgress(VARIANT_RESULTS_KEY, { 'C-01-v1': 'incorrect' });
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);
    expect(container.textContent).toContain('오답으로 기록됨');
    unmount();
  });

  it('"전체"·"풀이 완료" 는 변형을 켜도 교재 문항만 센다', async () => {
    saveProgress('quiz_results', { 'C-01': 'correct' });
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);

    const values = [...container.querySelectorAll('.stat-box .value')].map((n) => n.textContent);
    // [전체, 풀이 완료, 남은 문제] — 변형 1개를 풀어도 4/1/3 그대로다
    expect(values).toEqual(['4', '1', '3']);
    unmount();
  });

  it('교재 문항은 예전처럼 quiz_results 에 기록한다', async () => {
    const { container, unmount } = render();
    await flush();
    await answerCurrent(container, '30 50');
    expect(loadProgress('quiz_results', {})).toEqual({ 'C-01': 'answered' });
    expect(loadProgress(VARIANT_RESULTS_KEY, {})).toEqual({});
    unmount();
  });
});

describe('변형 문항은 서버 API 를 부르지 않는다', () => {
  it('변형 문항에는 AI 해설·AI 채점 버튼이 없다', async () => {
    // 서버 guard 의 ID_PATTERN 이 `C-01-v1` 을 거절해 400 이 난다 —
    // 눌러 봐야 오류 문구만 나오는 버튼은 띄우지 않는다
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);

    expect(container.textContent).not.toContain('AI 해설');
    expect(container.textContent).not.toContain('AI 채점');
    unmount();
  });

  it('교재 문항에는 그대로 있다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await answerCurrent(container, '30 50');
    expect(container.textContent).toContain('AI 해설');
    expect(container.textContent).toContain('AI 채점');
    unmount();
  });
});

describe('변형 오답노트', () => {
  it('변형을 오답노트에 넣으면 변형이라는 사실이 함께 남는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await answerCurrent(container);
    await act(async () => { buttonByName(container, '오답노트에 추가').click(); });

    const notes = loadProgress('wrong_notes', []);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('C-01-v1');
    // 표시가 없으면 오답노트 화면이 배지를 못 붙이고 AI 해설 버튼을 띄운다
    expect(notes[0].generated).toBe(true);
    unmount();
  });
});
