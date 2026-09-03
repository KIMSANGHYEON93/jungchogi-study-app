// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import usePlanStream from '../src/hooks/usePlanStream.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const encoder = new TextEncoder();

// JSX 없이 훅만 실행하는 최소 렌더러 (useAiStream 테스트와 같은 방식)
function renderHook(useHook) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  const capture = (value) => { result.current = value; };

  function Probe({ onResult }) {
    onResult(useHook());
    return null;
  }

  act(() => root.render(createElement(Probe, { onResult: capture })));

  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** 테스트가 한 프레임씩 밀어 넣을 수 있는 SSE 응답 */
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

const SNAPSHOT = {
  examDate: null,
  wrongNotes: [],
  quizResults: {},
  studyTime: {},
  dayChecks: {},
  availableMinutes: 90,
};

const PLAN = {
  date: '2026-09-03',
  items: [{ type: 'study_day', day: 6, section: '결합도', minutes: 30, why: '약점' }],
  rationale: '오늘은 SW공학',
  riskFlags: [],
};

let fetchMock;
let lastSignal;

beforeEach(() => {
  lastSignal = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function mockControllableSse() {
  let sse;
  fetchMock.mockImplementation((_url, init) => {
    lastSignal = init.signal;
    sse = controllableSse(init.signal);
    return Promise.resolve(sse.response);
  });
  return () => sse;
}

describe('usePlanStream — 상태 전이', () => {
  it('처음에는 idle 이고 계획이 없다', () => {
    const { result, unmount } = renderHook(usePlanStream);

    expect(result.current.status).toBe('idle');
    expect(result.current.plan).toBeNull();
    expect(result.current.steps).toEqual([]);
    expect(result.current.isGenerating).toBe(false);
    unmount();
  });

  it('start 를 부르면 generating 이 되고 도구 진행이 쌓인다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();
    expect(result.current.status).toBe('generating');
    expect(result.current.isGenerating).toBe(true);

    await act(async () => {
      getSse().push('data: {"phase":"tool","tool":"search_content"}\n\n');
    });
    await flush();

    expect(result.current.steps).toEqual(['교재 내용 검색 중…']);

    await act(async () => {
      getSse().push('data: {"phase":"tool_result","tool":"search_content","ok":true}\n\n');
    });
    await flush();

    expect(result.current.steps).toEqual(['교재 내용 검색 중…', '교재 내용 검색 완료']);
    unmount();
  });

  it('done 프레임을 받으면 계획과 함께 done 이 된다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: PLAN, usage: { output_tokens: 9 } })}\n\n`);
      getSse().close();
    });
    await flush();

    expect(result.current.status).toBe('done');
    // 정규화가 ids 를 항상 배열로 보장해 준다 — 화면에서 join() 을 그냥 쓸 수 있다
    expect(result.current.plan).toEqual({ ...PLAN, items: [{ ...PLAN.items[0], ids: [] }] });
    expect(result.current.usage).toEqual({ output_tokens: 9 });
    expect(result.current.isGenerating).toBe(false);
    unmount();
  });

  it('서버가 보낸 계획을 정규화해서 내놓는다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    await act(async () => {
      // minutes 가 문자열이고 rationale·riskFlags 가 빠진 응답
      getSse().push(
        'data: {"done":true,"plan":{"items":[{"type":"drill","source":"codedrill","ids":"J-03","minutes":"25"}]}}\n\n'
      );
      getSse().close();
    });
    await flush();

    expect(result.current.plan.items[0]).toEqual({
      type: 'drill',
      source: 'codedrill',
      ids: ['J-03'],
      minutes: 25,
      why: '',
    });
    expect(result.current.plan.rationale).toBe('');
    // date 가 없으면 오늘 날짜를 채운다
    expect(result.current.plan.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    unmount();
  });

  it('계획으로 볼 수 없는 응답은 오류로 다룬다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    await act(async () => {
      getSse().push('data: {"done":true,"plan":{"rationale":"items 가 없다"}}\n\n');
      getSse().close();
    });
    await flush();

    expect(result.current.status).toBe('error');
    expect(result.current.plan).toBeNull();
    expect(result.current.error.code).toBe('UPSTREAM');
    unmount();
  });
});

describe('usePlanStream — 오류·취소', () => {
  it('시작 전 오류 응답을 코드로 정규화한다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'RATE_LIMITED', message: '너무 잦음' } }, 429)
    );
    const { result, unmount } = renderHook(usePlanStream);

    await act(async () => { await result.current.start(SNAPSHOT); });

    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('RATE_LIMITED');
    expect(result.current.isGenerating).toBe(false);
    unmount();
  });

  it('스트림 중간 error 프레임도 오류 상태로 만든다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    await act(async () => {
      getSse().push('data: {"error":{"code":"UPSTREAM","message":"모델 실패"}}\n\n');
      getSse().close();
    });
    await flush();

    expect(result.current.status).toBe('error');
    expect(result.current.error.message).toBe('모델 실패');
    unmount();
  });

  it('cancel 은 오류가 아니라 cancelled 로 끝낸다', async () => {
    mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    await act(async () => { result.current.cancel(); });
    await flush();

    expect(result.current.status).toBe('cancelled');
    expect(result.current.error).toBeNull();
    expect(lastSignal.aborted).toBe(true);
    unmount();
  });

  it('reset 은 유휴 상태로 되돌린다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();
    await act(async () => {
      getSse().push(`data: ${JSON.stringify({ done: true, plan: PLAN })}\n\n`);
      getSse().close();
    });
    await flush();

    act(() => { result.current.reset(); });

    expect(result.current.status).toBe('idle');
    expect(result.current.plan).toBeNull();
    expect(result.current.steps).toEqual([]);
    unmount();
  });

  it('언마운트하면 진행 중인 생성을 취소한다', async () => {
    mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    unmount();

    expect(lastSignal.aborted).toBe(true);
  });

  it('다시 시작하면 앞선 생성을 취소하고 진행 표시를 비운다', async () => {
    const getSse = mockControllableSse();
    const { result, unmount } = renderHook(usePlanStream);

    act(() => { result.current.start(SNAPSHOT); });
    await flush();
    await act(async () => {
      getSse().push('data: {"phase":"tool","tool":"get_section"}\n\n');
    });
    await flush();
    expect(result.current.steps).toHaveLength(1);

    const firstSignal = lastSignal;
    act(() => { result.current.start(SNAPSHOT); });
    await flush();

    expect(firstSignal.aborted).toBe(true);
    expect(result.current.status).toBe('generating');
    expect(result.current.steps).toEqual([]);
    unmount();
  });
});
