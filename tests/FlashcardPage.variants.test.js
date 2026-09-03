// @vitest-environment jsdom
//
// 플래시카드의 AI 변형 문제 (BLUEPRINT §4.4).
//
// 이 화면의 고유한 위험: `flashcard_known_<deck>` 은 id 하나에 값 하나인
// 평평한 맵이고, 대시보드가 그 값의 **개수**를 분모 100(단답형)·24(보강)에
// 나눠 진도를 낸다. 변형 id 가 같은 맵에 들어가면 진도가 100% 를 넘는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import FlashcardPage from '../src/pages/FlashcardPage.jsx';
import { loadProgress, variantKnownKey } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUIZ_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/quiz-sample.md'), 'utf-8');
const BOGANG_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/bogang-sample.md'), 'utf-8');

function quizVariant(overrides = {}) {
  return {
    id: '001-v1',
    question: '트랜잭션의 격리성을 한 낱말로 쓰시오.',
    answer: 'Isolation',
    category: '데이터베이스',
    variantOf: '001',
    generated: true,
    ...overrides,
  };
}

function generatedFile(overrides = {}) {
  return {
    version: 1,
    source: 'quiz100',
    generatedAt: '2026-09-03T12:00:00.000Z',
    model: 'claude-opus-5',
    reviewed: true,
    items: [quizVariant()],
    ...overrides,
  };
}

let generated;

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(FlashcardPage)));
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

async function enableVariants(container) {
  await act(async () => { buttonByName(container, 'AI 변형').click(); });
  await flush();
}

/** 마지막 카드(= 변형은 원본 뒤에 붙는다)로 이동한다 */
async function goToLast(container) {
  const next = buttonByName(container, '다음');
  while (!next.disabled) {
    await act(async () => { next.click(); });
  }
  await flush();
}

const statValues = (container) =>
  [...container.querySelectorAll('.stat-box .value')].map((n) => n.textContent);

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  generated = generatedFile();
  // 검수 전 생성물 경고는 이 테스트가 일부러 만드는 상황이다 — 출력만 막는다
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const href = String(url);
      if (href.includes('/data/generated/')) {
        if (!generated || !href.includes(generated.source)) {
          return Promise.resolve(new Response('Not Found', { status: 404 }));
        }
        return Promise.resolve(new Response(JSON.stringify(generated), { status: 200 }));
      }
      if (href.includes('보강')) return Promise.resolve(new Response(BOGANG_MD, { status: 200 }));
      return Promise.resolve(new Response(QUIZ_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('변형 포함', () => {
  it('기본값은 꺼짐이라 교재 카드만 나온다', async () => {
    const { container, unmount } = render();
    await flush();
    expect(container.textContent).toContain('1 / 3');
    unmount();
  });

  // ★ 검수 전 생성물은 어떤 경로로도 학습에 들어가지 않는다
  it('reviewed 가 false 면 켜기 버튼도 카드도 나오지 않는다', async () => {
    generated = generatedFile({ reviewed: false });
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeUndefined();
    expect(container.textContent).toContain('1 / 3');
    unmount();
  });

  it('켜면 변형 카드가 덱에 들어온다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    expect(container.textContent).toContain('1 / 4');
    unmount();
  });

  it('변형 카드에는 AI 변형 배지가 붙는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    expect(container.querySelector('.flashcard').textContent).toContain('AI 변형');
    unmount();
  });

  it('교재 카드에는 배지가 붙지 않는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    expect(container.querySelector('.flashcard').textContent).not.toContain('AI 변형');
    unmount();
  });

  it('변형 카드의 정답 면에는 교재와 다를 수 있다고 알린다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    expect(container.querySelector('.flashcard-back').textContent).toContain('교재와 다를 수 있으니');
    unmount();
  });
});

describe('변형 진도는 교재 진도와 섞이지 않는다', () => {
  it('변형 카드를 외워도 flashcard_known_quiz100 에 쓰지 않는다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await act(async () => { buttonByName(container, '외움 표시').click(); });

    // 대시보드가 이 맵의 값 개수를 분모 100 에 나눈다 — 변형이 섞이면 100% 를 넘는다
    expect(loadProgress('flashcard_known_quiz100', {})).toEqual({});
    expect(loadProgress(variantKnownKey('quiz100'), {})).toEqual({ '001-v1': true });
    unmount();
  });

  it('교재 카드는 예전처럼 flashcard_known_quiz100 에 기록한다', async () => {
    const { container, unmount } = render();
    await flush();
    await act(async () => { buttonByName(container, '외움 표시').click(); });
    expect(loadProgress('flashcard_known_quiz100', {})).toEqual({ '001': true });
    expect(loadProgress(variantKnownKey('quiz100'), {})).toEqual({});
    unmount();
  });

  it('"전체 문제"·"외운 문제" 는 변형을 켜도 교재 카드만 센다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await act(async () => { buttonByName(container, '외움 표시').click(); });
    // [전체, 외움, 남음] — 변형 1개를 외워도 3/0/3 그대로다
    expect(statValues(container)).toEqual(['3', '0', '3']);
    unmount();
  });

  it('"모르는 것만" 필터가 외운 변형 카드를 빼 준다', async () => {
    const { container, unmount } = render();
    await flush();
    await enableVariants(container);
    await goToLast(container);
    await act(async () => { buttonByName(container, '외움 표시').click(); });
    await act(async () => { buttonByName(container, '모르는 것만').click(); });
    await flush();
    expect(container.textContent).toContain('1 / 3');
    unmount();
  });
});

describe('보강 덱', () => {
  it('보강 덱은 bogang 생성물을 읽는다', async () => {
    generated = {
      version: 1,
      source: 'bogang',
      generatedAt: '2026-09-03T12:00:00.000Z',
      model: 'claude-opus-5',
      reviewed: true,
      items: [
        {
          id: 'B01-v1',
          question: '[보강] C언어 서식문자열 변형',
          answer: '%d 는 10진 정수',
          category: 'OS/기타',
          variantOf: 'B01',
          generated: true,
        },
      ],
    };
    const { container, unmount } = render();
    await flush();
    await act(async () => { buttonByName(container, '암기 119선 보강').click(); });
    await flush();
    // 보강 픽스처는 2장 — 변형을 켜면 3장이 된다
    expect(container.textContent).toContain('1 / 2');
    await enableVariants(container);
    expect(container.textContent).toContain('1 / 3');
    unmount();
  });
});
