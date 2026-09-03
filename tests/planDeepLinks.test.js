// @vitest-environment jsdom
//
// 계획 항목이 거는 링크(`/study?day=N`, `/search?q=...`)가 실제로 그 화면을
// 그 상태로 연다는 것을 확인한다. 링크 문자열만 맞고 화면이 안 따라오면
// "실제 학습으로 이어진다"는 말이 성립하지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import StudyPage from '../src/pages/StudyPage.jsx';
import SearchPage from '../src/pages/SearchPage.jsx';
import { ThemeProvider } from '../src/hooks/useTheme.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderAt(Component, url, wrap = (el) => el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(MemoryRouter, { initialEntries: [url] }, wrap(createElement(Component)))
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('# 빈 문서\n', { status: 200 })))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function activeSidebarLabel(container) {
  return container.querySelector('.sidebar-item.active')?.textContent ?? '';
}

describe('학습노트 딥링크 (/study?day=N)', () => {
  it('day 파라미터가 가리키는 Day 를 열어 준다', async () => {
    const { container, unmount } = renderAt(StudyPage, '/study?day=6');
    await flush();

    expect(activeSidebarLabel(container)).toContain('Day 06');
    unmount();
  });

  it('파라미터가 없으면 첫 Day 를 연다', async () => {
    const { container, unmount } = renderAt(StudyPage, '/study');
    await flush();

    expect(activeSidebarLabel(container)).toContain('Day 01');
    unmount();
  });

  it('범위를 벗어난 day 는 첫 Day 로 떨어뜨린다', async () => {
    for (const url of ['/study?day=0', '/study?day=99', '/study?day=abc']) {
      const { container, unmount } = renderAt(StudyPage, url);
      await flush();
      expect(activeSidebarLabel(container)).toContain('Day 01');
      unmount();
    }
  });
});

describe('검색 딥링크 (/search?q=...)', () => {
  it('q 파라미터를 검색어로 채운 채 연다', async () => {
    const { container, unmount } = renderAt(SearchPage, `/search?q=${encodeURIComponent('결합도/응집도')}`, (el) =>
      createElement(ThemeProvider, { value: { theme: 'light', toggle: () => {} } }, el)
    );
    await flush();

    expect(container.querySelector('.search-input').value).toBe('결합도/응집도');
    unmount();
  });

  it('q 가 없으면 빈 검색어로 연다', async () => {
    const { container, unmount } = renderAt(SearchPage, '/search', (el) =>
      createElement(ThemeProvider, { value: { theme: 'light', toggle: () => {} } }, el)
    );
    await flush();

    expect(container.querySelector('.search-input').value).toBe('');
    unmount();
  });
});
