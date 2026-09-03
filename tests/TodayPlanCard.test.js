// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TodayPlanCard from '../src/components/TodayPlanCard.jsx';
import { saveStudyPlan, getStudyPlan, toLocalDateKey, saveProgress, setExamDate } from '../src/utils/storage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const encoder = new TextEncoder();
const TODAY = toLocalDateKey();

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, createElement(TodayPlanCard))));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** 화면에 보이는 이름(텍스트 또는 aria-label)으로 버튼을 찾는다 */
function buttonByName(container, name) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

function controllableSse(signal) {
  let ctrl;
  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller;
      signal?.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
        } catch { /* 이미 닫힌 스트림 */ }
      });
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (frame) => ctrl.enqueue(encoder.encode(frame)),
    close: () => ctrl.close(),
  };
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// React 는 노드의 value 접근자를 감싸 값 변화를 추적한다.
// `select.value = x` 로 바꾸면 추적값도 같이 바뀌어 onChange 가 안 뜬다 —
// 프로토타입의 원래 setter 로 바꿔야 실제 사용자 조작과 같아진다.
function changeSelect(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const PLAN = {
  date: TODAY,
  items: [
    { type: 'review_wrong', source: 'quiz100', ids: ['042'], minutes: 20, why: 'DB 정답률이 낮다' },
    { type: 'study_day', day: 6, section: '결합도/응집도', minutes: 30, why: '미완료 Day' },
  ],
  rationale: '오답부터 정리하고 Day 6 로 넘어간다',
  riskFlags: ['SQL 카테고리 정답률 40% 이하'],
};

let fetchMock;

function mockControllableSse() {
  let sse;
  fetchMock.mockImplementation((_url, init) => {
    sse = controllableSse(init.signal);
    return Promise.resolve(sse.response);
  });
  return () => sse;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('TodayPlanCard — 계획이 없을 때', () => {
  it('생성 버튼과 학습 시간 선택을 보여준다', () => {
    const { container, unmount } = render();

    expect(container.textContent).toContain('오늘의 계획');
    expect(buttonByName(container, '계획 만들기')).toBeTruthy();
    expect(container.querySelector('select')).toBeTruthy();
    unmount();
  });

  it('시험일이 없으면 설정하라고 안내하되 생성은 막지 않는다', () => {
    const { container, unmount } = render();

    expect(container.textContent).toContain('시험일');
    expect(buttonByName(container, '계획 만들기').disabled).toBe(false);
    unmount();
  });

  it('시험일이 설정돼 있으면 안내를 띄우지 않는다', () => {
    setExamDate('2026-10-18');
    const { container, unmount } = render();

    expect(container.textContent).not.toContain('시험일을 설정하면');
    unmount();
  });
});

describe('TodayPlanCard — 저장된 계획', () => {
  it('같은 날 다시 열면 재생성 없이 저장된 계획을 보여준다', () => {
    saveStudyPlan(PLAN);
    const { container, unmount } = render();

    expect(container.textContent).toContain('결합도/응집도');
    expect(container.textContent).toContain('오답부터 정리하고');
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it('어제 계획은 오늘 계획으로 보여주지 않는다', () => {
    saveStudyPlan({ ...PLAN, date: '2000-01-01' });
    const { container, unmount } = render();

    expect(container.textContent).not.toContain('결합도/응집도');
    expect(buttonByName(container, '계획 만들기')).toBeTruthy();
    unmount();
  });

  it('계획 항목에서 학습 화면으로 가는 링크를 건다', () => {
    saveStudyPlan(PLAN);
    const { container, unmount } = render();

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/wrong');
    expect(hrefs).toContain('/study?day=6');
    unmount();
  });

  it('위험 신호를 함께 보여준다', () => {
    saveStudyPlan(PLAN);
    const { container, unmount } = render();

    expect(container.textContent).toContain('SQL 카테고리 정답률 40% 이하');
    unmount();
  });
});

describe('TodayPlanCard — 생성 흐름', () => {
  it('없음 → 생성 중 → 표시 로 넘어가고 계획을 저장한다', async () => {
    const getSse = mockControllableSse();
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();

    expect(container.textContent).toContain('계획을 세우는 중');
    expect(buttonByName(container, '중단')).toBeTruthy();

    await act(async () => {
      getSse().push('data: {"phase":"tool","tool":"get_weak_categories"}\n\n');
    });
    await flush();
    expect(container.textContent).toContain('약점 카테고리 계산 중…');

    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: PLAN })}\n\n`);
      getSse().close();
    });
    await flush();

    expect(container.textContent).toContain('결합도/응집도');
    expect(getStudyPlan(TODAY).rationale).toBe(PLAN.rationale);
    unmount();
  });

  it('선택한 학습 시간을 스냅샷에 실어 보내고 다음에도 기억한다', async () => {
    const getSse = mockControllableSse();
    const { container, unmount } = render();

    await act(async () => { changeSelect(container.querySelector('select'), '120'); });
    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.snapshot.availableMinutes).toBe(120);

    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: PLAN })}\n\n`);
      getSse().close();
    });
    await flush();
    unmount();

    const again = render();
    expect(again.container.querySelector('select').value).toBe('120');
    again.unmount();
  });

  it('오답노트 본문은 스냅샷에 싣지 않는다', async () => {
    saveProgress('wrong_notes', [
      { id: 'C-01', source: 'quiz', type: 'code', code: 'SECRET_CODE_BLOB', lang: 'c', reviewCount: 0, mastered: false },
    ]);
    mockControllableSse();
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();

    expect(fetchMock.mock.calls[0][1].body).not.toContain('SECRET_CODE_BLOB');
    unmount();
  });

  it('중단하면 오류가 아니라 중단 안내를 보여준다', async () => {
    mockControllableSse();
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();
    await act(async () => { buttonByName(container, '중단').click(); });
    await flush();

    expect(container.textContent).toContain('중단');
    expect(container.textContent).not.toContain('받지 못했습니다');
    expect(buttonByName(container, '다시')).toBeTruthy();
    unmount();
  });
});

describe('TodayPlanCard — 재생성', () => {
  it('저장된 계획이 있으면 확인을 받고, 취소하면 요청하지 않는다', async () => {
    saveStudyPlan(PLAN);
    window.confirm.mockReturnValue(false);
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '다시 생성').click(); });
    await flush();

    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('결합도/응집도');
    unmount();
  });

  it('확인하면 새 계획으로 갈아 끼우고 저장을 덮어쓴다', async () => {
    saveStudyPlan(PLAN);
    const getSse = mockControllableSse();
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '다시 생성').click(); });
    await flush();

    const next = { ...PLAN, items: [{ type: 'drill', source: 'codedrill', ids: ['J-03'], minutes: 25, why: '새 계획' }], rationale: '다시 세운 계획' };
    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: next })}\n\n`);
      getSse().close();
    });
    await flush();

    expect(container.textContent).toContain('J-03');
    expect(container.textContent).not.toContain('결합도/응집도');
    expect(getStudyPlan(TODAY).rationale).toBe('다시 세운 계획');
    unmount();
  });
});

describe('TodayPlanCard — 오류', () => {
  it('접근 코드 오류를 사람이 읽을 문구로 보여준다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'nope' } }, 401));
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();

    expect(container.textContent).toContain('접근 코드');
    expect(container.textContent).not.toContain('nope');
    expect(buttonByName(container, '다시 시도')).toBeTruthy();
    unmount();
  });

  it('오류가 나도 저장된 계획은 화면에 남는다', async () => {
    saveStudyPlan(PLAN);
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'RATE_LIMITED', message: 'x' } }, 429));
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '다시 생성').click(); });
    await flush();

    expect(container.textContent).toContain('요청이 몰렸습니다');
    expect(container.textContent).toContain('결합도/응집도');
    unmount();
  });

  it('용량이 꽉 차 저장하지 못하면 그 사실을 알린다', async () => {
    const getSse = mockControllableSse();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, unmount } = render();

    await act(async () => { buttonByName(container, '계획 만들기').click(); });
    await flush();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });

    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: PLAN })}\n\n`);
      getSse().close();
    });
    await flush();

    expect(container.textContent).toContain('결합도/응집도');
    expect(container.textContent).toContain('저장하지 못했습니다');
    unmount();
  });
});
