// @vitest-environment jsdom
//
// 오답노트의 AI 변형 문항 (BLUEPRINT §4.4).
//
// 변형을 틀리면 오답노트에 들어온다. 이 화면은 저장된 본문을 그대로 그리므로
// 문항 자체는 잘 보이지만, 두 가지가 남는다:
//   1) 어디서 온 문항인지 — 배지가 없으면 교재 오답으로 오인한다
//   2) AI 해설 버튼 — 서버 guard 의 ID_PATTERN 이 변형 id 를 거절해 400 이다
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

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  // 이 화면은 `?id=` 딥링크를 읽으므로 Router 안에서만 그려진다
  act(() => root.render(createElement(MemoryRouter, null, createElement(WrongNotePage))));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 카드 머리를 눌러 펼친다 */
function expand(container, index = 0) {
  act(() => container.querySelectorAll('.wrong-note-header')[index].click());
}

const cardAt = (container, index = 0) => container.querySelectorAll('.wrong-note-card')[index];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('네트워크를 쓰지 않는 화면'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('변형 오답 표시', () => {
  it('변형 오답에는 AI 변형 배지가 붙는다', () => {
    saveProgress('wrong_notes', [note({ id: 'C-01-v1', generated: true })]);
    const { container, unmount } = render();
    expect(cardAt(container).textContent).toContain('AI 변형');
    unmount();
  });

  it('교재 오답에는 배지가 붙지 않는다', () => {
    saveProgress('wrong_notes', [note()]);
    const { container, unmount } = render();
    expect(cardAt(container).textContent).not.toContain('AI 변형');
    unmount();
  });

  it('변형 오답의 정답에는 교재와 다를 수 있다고 알린다', () => {
    saveProgress('wrong_notes', [note({ id: 'C-01-v1', generated: true })]);
    const { container, unmount } = render();
    expand(container);
    expect(container.textContent).toContain('교재와 다를 수 있으니');
    unmount();
  });
});

describe('변형 오답은 서버 API 를 부르지 않는다', () => {
  it('변형 오답에는 AI 해설 버튼이 없다', () => {
    saveProgress('wrong_notes', [note({ id: 'C-01-v1', generated: true })]);
    const { container, unmount } = render();
    expand(container);
    expect(container.querySelector('.ai-explain')).toBeNull();
    unmount();
  });

  it('generated 표시가 없는 옛 변형 오답도 id 모양으로 막는다', () => {
    // Phase 4 이전 형식으로 저장된 항목에는 generated 필드가 없다
    saveProgress('wrong_notes', [note({ id: 'C-01-v1' })]);
    const { container, unmount } = render();
    expand(container);
    expect(container.querySelector('.ai-explain')).toBeNull();
    unmount();
  });

  it('교재 오답에는 AI 해설이 그대로 있다', () => {
    saveProgress('wrong_notes', [note()]);
    const { container, unmount } = render();
    expand(container);
    expect(container.querySelector('.ai-explain')).not.toBeNull();
    unmount();
  });
});

describe('교재 오답과 변형 오답이 함께 있을 때', () => {
  it('둘 다 보이고 배지만 갈린다', () => {
    saveProgress('wrong_notes', [note(), note({ id: 'C-01-v1', generated: true })]);
    const { container, unmount } = render();
    expect(container.querySelectorAll('.wrong-note-card')).toHaveLength(2);
    expect(cardAt(container, 0).textContent).not.toContain('AI 변형');
    expect(cardAt(container, 1).textContent).toContain('AI 변형');
    unmount();
  });
});
