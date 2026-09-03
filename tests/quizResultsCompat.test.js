// @vitest-environment jsdom
//
// `quiz_results` 를 읽는 곳이 세 값을 모두 올바로 다루는지 확인한다.
//
//   'correct' | 'incorrect' : Phase 3 이후의 채점 결과
//   'answered'              : 레거시 — 시도했으나 정오 미상
//
// **레거시를 정답으로도 오답으로도 세면 안 된다.** 마이그레이션은 불가능하다
// (정오 정보가 애초에 저장되지 않았다). 그래서 읽는 쪽이 전부 감당해야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../src/pages/DashboardPage.jsx';
import { buildPlanSnapshot } from '../src/domain/studyPlan.js';
import { saveProgress } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, createElement(DashboardPage))));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** 대시보드의 "코드 퀴즈" 통계 카드 */
function quizCard(container) {
  return [...container.querySelectorAll('.dash-stat-card')].find((c) =>
    c.querySelector('.dash-stat-title')?.textContent.includes('코드 퀴즈')
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('대시보드 진도 표시', () => {
  it('레거시 answered 도 시도로 세어 진도가 뒤로 가지 않는다', async () => {
    saveProgress('quiz_results', { 'C-01': 'answered', 'C-02': 'answered', 'C-03': 'answered' });
    const { container, unmount } = render();
    await flush();

    expect(quizCard(container).querySelector('.dash-stat-value').textContent).toContain('3');

    unmount();
  });

  it('세 값이 섞여 있어도 시도 수는 전부 센다', async () => {
    saveProgress('quiz_results', { 'C-01': 'correct', 'C-02': 'incorrect', 'C-03': 'answered' });
    const { container, unmount } = render();
    await flush();

    expect(quizCard(container).querySelector('.dash-stat-value').textContent).toContain('3');

    unmount();
  });

  it('손상된 값(문자열이 아닌 것)은 시도로 세지 않는다', async () => {
    saveProgress('quiz_results', { 'C-01': 'correct', 'C-02': 3, 'C-03': null });
    const { container, unmount } = render();
    await flush();

    expect(quizCard(container).querySelector('.dash-stat-value').textContent).toContain('1');

    unmount();
  });
});

describe('대시보드 정답률 — 레거시를 정답으로도 오답으로도 세지 않는다', () => {
  it('레거시만 있으면 정답률을 말하지 않는다', async () => {
    saveProgress('quiz_results', { 'C-01': 'answered', 'C-02': 'answered' });
    const { container, unmount } = render();
    await flush();

    expect(quizCard(container).textContent).not.toContain('정답률');

    unmount();
  });

  it('채점된 문항만으로 정답률을 낸다', async () => {
    saveProgress('quiz_results', {
      'C-01': 'correct',
      'C-02': 'incorrect',
      'C-03': 'answered',
      'C-04': 'answered',
    });
    const { container, unmount } = render();
    await flush();

    // 레거시 2건을 오답으로 셌다면 25%, 정답으로 셌다면 75% 가 된다
    expect(quizCard(container).textContent).toContain('정답률 50%');

    unmount();
  });

  it('전부 맞았으면 100% 다', async () => {
    saveProgress('quiz_results', { 'C-01': 'correct', 'C-02': 'correct' });
    const { container, unmount } = render();
    await flush();

    expect(quizCard(container).textContent).toContain('정답률 100%');

    unmount();
  });
});

describe('플래너 스냅샷', () => {
  it('세 값이 그대로 서버로 실려 간다 — 채점 결과가 약점 분석에 닿는다', () => {
    saveProgress('quiz_results', { 'C-01': 'correct', 'C-02': 'incorrect', 'C-03': 'answered' });

    expect(buildPlanSnapshot({}).quizResults).toEqual({
      'C-01': 'correct',
      'C-02': 'incorrect',
      'C-03': 'answered',
    });
  });
});
