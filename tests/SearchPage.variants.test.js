// @vitest-environment jsdom
//
// 검색 화면의 AI 변형 문제 (BLUEPRINT §4.4).
//
// 검색은 세 교재를 한꺼번에 다룬다. 변형도 세 몫을 각각 읽고,
// 결과 줄에서 교재 문항과 구분돼야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SearchPage from '../src/pages/SearchPage.jsx';
import { setIncludeVariants } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUIZ_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/quiz-sample.md'), 'utf-8');
const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');
const BOGANG_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/bogang-sample.md'), 'utf-8');

const QUIZ_GENERATED = {
  version: 1,
  source: 'quiz100',
  generatedAt: '2026-09-03T12:00:00.000Z',
  model: 'claude-opus-5',
  reviewed: true,
  items: [
    {
      id: '001-v1',
      question: '격리성을 뜻하는 영어 낱말을 쓰시오 — 슈뢰딩거',
      answer: 'Isolation',
      category: '데이터베이스',
      variantOf: '001',
      generated: true,
    },
  ],
};

let quizGenerated;

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, createElement(SearchPage))));
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

/** 검색어를 넣고 디바운스(200ms)를 흘려보낸다 */
async function search(container, query) {
  const input = container.querySelector('.search-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { vi.advanceTimersByTime(300); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  quizGenerated = QUIZ_GENERATED;
  // 검수 전 생성물 경고는 이 테스트가 일부러 만드는 상황이다 — 출력만 막는다
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = String(url);
      if (u.includes('/data/generated/quiz100')) {
        if (!quizGenerated) return Promise.resolve(new Response('Not Found', { status: 404 }));
        return Promise.resolve(new Response(JSON.stringify(quizGenerated), { status: 200 }));
      }
      if (u.includes('/data/generated/')) return Promise.resolve(new Response('Not Found', { status: 404 }));
      if (u.includes('코드트레이싱')) return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
      if (u.includes('보강')) return Promise.resolve(new Response(BOGANG_MD, { status: 200 }));
      return Promise.resolve(new Response(QUIZ_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('변형 포함 토글', () => {
  it('쓸 수 있는 변형이 있으면 켜기 버튼이 보인다', async () => {
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeTruthy();
    unmount();
  });

  // ★ 검수 전 생성물은 어떤 경로로도 학습에 들어가지 않는다
  it('reviewed 가 false 면 켜기 버튼이 없다', async () => {
    quizGenerated = { ...QUIZ_GENERATED, reviewed: false };
    const { container, unmount } = render();
    await flush();
    expect(buttonByName(container, 'AI 변형')).toBeUndefined();
    unmount();
  });

  it('설정을 켜 뒀더라도 reviewed 가 false 면 검색되지 않는다', async () => {
    quizGenerated = { ...QUIZ_GENERATED, reviewed: false };
    setIncludeVariants(true);
    const { container, unmount } = render();
    await flush();
    await search(container, '슈뢰딩거');
    expect(container.textContent).toContain('검색 결과가 없습니다');
    // 끌 수 있게 버튼은 남되, 쓸 수 있는 변형은 0개라고 알린다
    expect(buttonByName(container, 'AI 변형').getAttribute('aria-label')).toContain('0개');
    unmount();
  });

  it('꺼져 있으면 변형은 검색되지 않는다', async () => {
    const { container, unmount } = render();
    await flush();
    await search(container, '슈뢰딩거');
    expect(container.textContent).toContain('검색 결과가 없습니다');
    unmount();
  });

  it('켜면 변형도 검색된다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await flush();
    await search(container, '슈뢰딩거');
    expect(container.textContent).toContain('001-v1');
    unmount();
  });
});

describe('변형 문항 표시', () => {
  it('변형 결과에는 AI 변형 배지가 붙는다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await flush();
    await search(container, '슈뢰딩거');
    expect(container.querySelector('.search-result-card').textContent).toContain('AI 변형');
    unmount();
  });

  it('교재 결과에는 배지가 붙지 않는다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await flush();
    await search(container, 'ACID');
    expect(container.querySelector('.search-result-card').textContent).not.toContain('AI 변형');
    unmount();
  });

  it('변형을 펼치면 정답이 교재와 다를 수 있다고 알린다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = render();
    await flush();
    await search(container, '슈뢰딩거');
    await act(async () => { container.querySelector('.search-result-card [role="button"]').click(); });
    expect(container.textContent).toContain('교재와 다를 수 있으니');
    unmount();
  });
});
