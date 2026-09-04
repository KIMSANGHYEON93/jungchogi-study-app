// @vitest-environment jsdom
//
// 오답노트의 문항 딥링크 (`/wrong?id=C-01`).
//
// 계획의 `review_wrong` 항목이 `ids: ["C-01","J-01"]` 로 문항을 지목한다.
// 이 화면은 목록이라 "그 문항에서 시작"이 곧 **그 카드를 펼치고 눈에 띄게**다.
//
// 여기가 못 찾는 id 가 가장 흔한 곳이다 — 계획을 받은 뒤 오답을 지울 수 있다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import WrongNotePage from '../src/pages/WrongNotePage.jsx';
import { saveProgress } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function note(overrides = {}) {
  return {
    id: 'C-01',
    source: 'quiz',
    type: 'code',
    title: '포인터 기본',
    context: '',
    code: 'int a = 1;',
    lang: 'c',
    answer: '출력: 1',
    pitfall: '',
    userAnswer: '2',
    addedAt: Date.now(),
    reviewCount: 0,
    mastered: false,
    ...overrides,
  };
}

function renderAt(url) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(WrongNotePage)));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const cards = (container) => [...container.querySelectorAll('.wrong-note-card')];
const expandedIndexes = (container) =>
  cards(container).flatMap((card, i) =>
    card.querySelector('[aria-expanded="true"]') ? [i] : []
  );
const notice = (container) => container.querySelector('.deep-link-notice')?.textContent ?? '';

let scrollIntoView;

beforeEach(() => {
  localStorage.clear();
  scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('네트워크를 쓰지 않는 화면'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.HTMLElement.prototype.scrollIntoView;
  document.body.innerHTML = '';
});

describe('지목한 오답을 펼친다', () => {
  it('`?id=J-01` 은 그 카드를 펼친다', () => {
    saveProgress('wrong_notes', [note(), note({ id: 'J-01', title: '상속' })]);
    const { container, unmount } = renderAt('/wrong?id=J-01');

    expect(expandedIndexes(container)).toEqual([1]);
    expect(cards(container)[1].textContent).toContain('출력: 1');
    expect(notice(container)).toBe('');
    unmount();
  });

  it('펼친 카드를 화면 안으로 스크롤한다', () => {
    saveProgress('wrong_notes', [note(), note({ id: 'J-01', title: '상속' })]);
    const { unmount } = renderAt('/wrong?id=J-01');

    expect(scrollIntoView).toHaveBeenCalled();
    unmount();
  });

  it('딥링크로 펼친 카드도 머리를 누르면 접힌다', () => {
    saveProgress('wrong_notes', [note({ id: 'J-01' })]);
    const { container, unmount } = renderAt('/wrong?id=J-01');
    expect(expandedIndexes(container)).toEqual([0]);

    act(() => container.querySelectorAll('.wrong-note-header')[0].click());
    expect(expandedIndexes(container)).toEqual([]);
    unmount();
  });
});

describe('`?id=` 가 없으면 기존 동작 그대로', () => {
  it('아무 카드도 펼치지 않고 스크롤도 하지 않는다', () => {
    saveProgress('wrong_notes', [note(), note({ id: 'J-01' })]);
    const { container, unmount } = renderAt('/wrong');

    expect(expandedIndexes(container)).toEqual([]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(container.querySelector('.deep-link-notice')).toBeNull();
    unmount();
  });
});

describe('못 찾는 id', () => {
  it('이미 지운 오답을 지목하면 아무것도 펼치지 않고 이유를 알린다', () => {
    saveProgress('wrong_notes', [note()]);
    const { container, unmount } = renderAt('/wrong?id=J-01');

    expect(expandedIndexes(container)).toEqual([]);
    expect(notice(container)).toContain('J-01');
    expect(notice(container)).toContain('찾지 못했');
    unmount();
  });

  it('오답노트가 비어 있어도 안내는 나온다', () => {
    const { container, unmount } = renderAt('/wrong?id=C-01');

    expect(notice(container)).toContain('C-01');
    unmount();
  });

  it('아주 긴 id 는 잘라서 보여 준다', () => {
    saveProgress('wrong_notes', [note()]);
    const { container, unmount } = renderAt(`/wrong?id=${'x'.repeat(3000)}`);

    expect(notice(container)).toContain('찾지 못했');
    expect(notice(container).length).toBeLessThan(200);
    unmount();
  });

  it('경로 문자가 섞인 id 도 안내로 끝난다', () => {
    saveProgress('wrong_notes', [note()]);
    const { container, unmount } = renderAt(`/wrong?id=${encodeURIComponent('../../etc/passwd')}`);

    expect(expandedIndexes(container)).toEqual([]);
    expect(notice(container)).toContain('찾지 못했');
    unmount();
  });
});

describe('필터와의 얽힘', () => {
  it('딥링크로 펼친 카드는 필터를 바꿔 사라져도 목록만 바뀐다', () => {
    saveProgress('wrong_notes', [note({ id: 'C-01', source: 'quiz' })]);
    const { container, unmount } = renderAt('/wrong?id=C-01');
    expect(expandedIndexes(container)).toEqual([0]);

    const examFilter = [...container.querySelectorAll('.filter-bar button')].find(
      (b) => b.textContent === '모의고사'
    );
    act(() => examFilter.click());

    expect(cards(container)).toHaveLength(0);
    unmount();
  });

  it('변형 오답도 id 로 지목해 펼칠 수 있다', () => {
    saveProgress('wrong_notes', [note(), note({ id: 'C-01-v1', generated: true })]);
    const { container, unmount } = renderAt('/wrong?id=C-01-v1');

    expect(expandedIndexes(container)).toEqual([1]);
    unmount();
  });
});
