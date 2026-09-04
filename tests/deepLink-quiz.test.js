// @vitest-environment jsdom
//
// 코드 퀴즈의 문항 딥링크 (`/quiz?id=C-01`).
//
// 계획 항목은 `ids: ["C-01"]` 처럼 문항을 지목하는데 화면이 화면 단위로만 열리면
// 사용자가 그 문항을 직접 찾아야 한다. 여기서 지키는 것:
//   1) 지목한 문항에서 시작한다
//   2) `?id=` 가 없으면 지금까지와 **완전히 같다**
//   3) 못 찾는 id 는 조용히 넘기지 않는다 — 첫 문항 + 안내
//   4) 필터·진도 같은 기존 기능이 딥링크 때문에 달라지지 않는다
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuizPage from '../src/pages/QuizPage.jsx';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';
import { setIncludeVariants } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');

// 픽스처의 교재 문항은 C-01 · J-01 · S-01 · S-05 네 개다.
const GENERATED = {
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
      code: 'int a=3;',
      lang: 'c',
      answer: '출력: 7',
      expectedOutput: '7',
      pitfall: '',
      variantOf: 'C-01',
      generated: true,
    },
  ],
};

function renderAt(url) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(QuizPage)));
  });
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

const counter = (container) => container.querySelector('.flashcard-counter')?.textContent ?? '';
const heading = (container) => container.querySelector('.card h2')?.textContent ?? '';
const notice = (container) => container.querySelector('.deep-link-notice')?.textContent ?? '';

function buttonByName(container, name) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      String(url).includes('/data/generated/')
        ? Promise.resolve(new Response(JSON.stringify(GENERATED), { status: 200 }))
        : Promise.resolve(new Response(DRILL_MD, { status: 200 }))
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('지목한 문항에서 시작한다', () => {
  it('`?id=S-01` 은 세 번째 문항을 연다', async () => {
    const { container, unmount } = renderAt('/quiz?id=S-01');
    await flush();

    expect(heading(container)).toContain('S-01');
    expect(counter(container)).toBe('3 / 4');
    expect(notice(container)).toBe('');
    unmount();
  });

  it('첫 문항을 지목해도 그대로 연다', async () => {
    const { container, unmount } = renderAt('/quiz?id=C-01');
    await flush();

    expect(heading(container)).toContain('C-01');
    expect(counter(container)).toBe('1 / 4');
    unmount();
  });

  it('딥링크로 연 문항에서도 이전/다음이 그대로 움직인다', async () => {
    const { container, unmount } = renderAt('/quiz?id=S-01');
    await flush();

    await act(async () => { buttonByName(container, '다음').click(); });
    expect(counter(container)).toBe('4 / 4');

    await act(async () => { buttonByName(container, '이전').click(); });
    expect(counter(container)).toBe('3 / 4');
    unmount();
  });
});

describe('`?id=` 가 없으면 기존 동작 그대로', () => {
  it('첫 문항에서 시작하고 안내도 없다', async () => {
    const { container, unmount } = renderAt('/quiz');
    await flush();

    expect(heading(container)).toContain('C-01');
    expect(counter(container)).toBe('1 / 4');
    expect(container.querySelector('.deep-link-notice')).toBeNull();
    unmount();
  });

  it('`?id=` 만 있고 값이 비면 딥링크가 없는 것으로 본다', async () => {
    const { container, unmount } = renderAt('/quiz?id=');
    await flush();

    expect(counter(container)).toBe('1 / 4');
    expect(container.querySelector('.deep-link-notice')).toBeNull();
    unmount();
  });
});

describe('못 찾는 id', () => {
  it('교재에 없는 id 는 첫 문항으로 떨어뜨리고 이유를 알린다', async () => {
    const { container, unmount } = renderAt('/quiz?id=Z-99');
    await flush();

    expect(counter(container)).toBe('1 / 4');
    expect(notice(container)).toContain('Z-99');
    expect(notice(container)).toContain('찾지 못해');
    unmount();
  });

  it('경로 문자가 섞인 id 도 안내로 끝난다 (요청은 나가지 않는다)', async () => {
    const { container, unmount } = renderAt(`/quiz?id=${encodeURIComponent('../../etc/passwd')}`);
    await flush();

    expect(counter(container)).toBe('1 / 4');
    expect(notice(container)).toContain('찾지 못해');
    expect(globalThis.fetch.mock.calls.every(([u]) => !String(u).includes('passwd'))).toBe(true);
    unmount();
  });

  it('아주 긴 id 는 잘라서 보여 준다', async () => {
    const { container, unmount } = renderAt(`/quiz?id=${'x'.repeat(3000)}`);
    await flush();

    expect(counter(container)).toBe('1 / 4');
    expect(notice(container)).toContain('찾지 못해');
    expect(notice(container).length).toBeLessThan(200);
    unmount();
  });
});

describe('변형 문항 딥링크', () => {
  it('변형 포함이 꺼져 있으면 첫 문항 + 켜라는 안내', async () => {
    const { container, unmount } = renderAt('/quiz?id=C-01-v1');
    await flush();

    expect(counter(container)).toBe('1 / 4');
    expect(notice(container)).toContain('C-01-v1');
    expect(notice(container)).toContain('변형 포함');
    unmount();
  });

  it('변형 포함이 켜져 있으면 그 변형을 연다', async () => {
    setIncludeVariants(true);
    const { container, unmount } = renderAt('/quiz?id=C-01-v1');
    await flush();

    expect(heading(container)).toContain('C-01-v1');
    expect(counter(container)).toBe('5 / 5');
    expect(notice(container)).toBe('');
    unmount();
  });
});

describe('기존 기능과의 얽힘', () => {
  it('언어 필터를 바꾸면 딥링크를 놓고 첫 문항으로 간다', async () => {
    const { container, unmount } = renderAt('/quiz?id=S-01');
    await flush();
    expect(counter(container)).toBe('3 / 4');

    await act(async () => { buttonByName(container, 'Java').click(); });
    await flush();

    expect(heading(container)).toContain('J-01');
    expect(counter(container)).toBe('1 / 1');
    unmount();
  });

  it('딥링크는 진도를 건드리지 않는다', async () => {
    const { container, unmount } = renderAt('/quiz?id=S-01');
    await flush();

    // "전체 4 · 풀이 완료 0 · 남은 문제 4"
    const values = [...container.querySelectorAll('.stat-box .value')].map((n) => n.textContent);
    expect(values).toEqual(['4', '0', '4']);
    unmount();
  });
});
