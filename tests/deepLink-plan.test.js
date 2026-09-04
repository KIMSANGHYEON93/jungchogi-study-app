// @vitest-environment jsdom
//
// 계획 항목이 만든 링크가 **그 문항을** 실제로 연다는 것을 확인한다.
// `tests/planDeepLinks.test.js` 가 화면 단위 링크(`/study?day=`·`/search?q=`)에서
// 하는 일을 문항 단위 링크(`?id=`)에서 한다 — 링크 문자열만 맞고 화면이 안 따라오면
// "계획이 실제 학습으로 이어진다"는 말이 성립하지 않는다.
//
// 도메인(`planItemLink`)과 화면(`useDeepLink`)이 따로 고쳐지는 자리라 이음매를 건다.
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuizPage from '../src/pages/QuizPage.jsx';
import FlashcardPage from '../src/pages/FlashcardPage.jsx';
import WrongNotePage from '../src/pages/WrongNotePage.jsx';
import { planItemLink } from '../src/domain/studyPlan.js';
import { saveProgress } from '../src/utils/storage.js';
import { clearGeneratedCache } from '../src/utils/generatedDeck.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRILL_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/code-drill-sample.md'), 'utf-8');
const QUIZ_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/quiz-sample.md'), 'utf-8');
const BOGANG_MD = readFileSync(resolve(process.cwd(), 'tests/fixtures/bogang-sample.md'), 'utf-8');

function renderAt(Component, url) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Component)));
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

beforeEach(() => {
  localStorage.clear();
  clearGeneratedCache();
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url);
      if (path.includes('/data/generated/')) return Promise.resolve(new Response('Not Found', { status: 404 }));
      if (path.includes('코드트레이싱')) return Promise.resolve(new Response(DRILL_MD, { status: 200 }));
      if (path.includes('보강')) return Promise.resolve(new Response(BOGANG_MD, { status: 200 }));
      return Promise.resolve(new Response(QUIZ_MD, { status: 200 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('드릴 계획(codedrill) → 코드 퀴즈가 그 문항을 연다', async () => {
  const link = planItemLink({ type: 'drill', source: 'codedrill', ids: ['S-01'], minutes: 20, why: '' });
  expect(link.to).toBe('/quiz?id=S-01');

  const { container, unmount } = renderAt(QuizPage, link.to);
  await flush();

  expect(container.querySelector('.card h2').textContent).toContain('S-01');
  expect(container.querySelector('.flashcard-counter').textContent).toBe('3 / 4');
  unmount();
});

it('드릴 계획(bogang) → 플래시카드가 덱까지 맞춰 그 카드를 연다', async () => {
  const link = planItemLink({ type: 'drill', source: 'bogang', ids: ['B02'], minutes: 15, why: '' });
  expect(link.to).toBe('/flashcard?id=B02');

  const { container, unmount } = renderAt(FlashcardPage, link.to);
  await flush();

  expect(container.querySelector('.deck-btn.active').textContent).toContain('보강');
  expect(container.querySelector('.flashcard-face h2').textContent).toContain('B02.');
  unmount();
});

it('오답 복습 계획 → 오답노트가 그 카드를 펼친다', async () => {
  saveProgress('wrong_notes', [
    { id: 'C-01', source: 'quiz', type: 'code', title: '포인터', answer: '1', userAnswer: '2', addedAt: 0, reviewCount: 0, mastered: false },
    { id: '042', source: 'exam', type: 'quiz', question: '정규화', answer: '2NF', userAnswer: '', addedAt: 0, reviewCount: 0, mastered: false },
  ]);
  const link = planItemLink({ type: 'review_wrong', source: 'quiz100', ids: ['042'], minutes: 20, why: '' });
  expect(link.to).toBe('/wrong?id=042');

  const { container, unmount } = renderAt(WrongNotePage, link.to);

  const expanded = [...container.querySelectorAll('.wrong-note-card')].findIndex(
    (card) => card.querySelector('[aria-expanded="true"]')
  );
  expect(expanded).toBe(1);
  unmount();
});

it('문항을 지목하지 않은 계획은 예전처럼 화면 단위로 떨어진다', async () => {
  const link = planItemLink({ type: 'review_wrong', source: 'quiz100', ids: [], minutes: 20, why: '' });
  expect(link.to).toBe('/wrong');

  const { container, unmount } = renderAt(WrongNotePage, link.to);

  expect(container.querySelector('.deep-link-notice')).toBeNull();
  unmount();
});
