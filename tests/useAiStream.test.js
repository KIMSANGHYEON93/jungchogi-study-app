// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useAiStream from '../src/hooks/useAiStream.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const encoder = new TextEncoder();

// JSX 없이 훅만 실행하는 최소 렌더러.
// @testing-library/react 를 새로 들이지 않으려고 react-dom 만으로 붙였다.
function renderHook(useHook) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  // 렌더 중 바깥 변수를 직접 대입하면 react-hooks/immutability 에 걸린다.
  // 컴포넌트 밖에 둔 콜백으로 넘겨 받는다 — 렌더 프롭과 같은 모양이다.
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

// 렌더 큐와 스트림 읽기 루프를 모두 비운다
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

const REQUEST = { source: 'codedrill', id: 'C-07', userAnswer: '30 50' };

let fetchMock;
let lastSignal;

beforeEach(() => {
  lastSignal = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** 다음 fetch 호출이 조종 가능한 스트림을 돌려주게 한다 */
function nextStream() {
  let sse;
  fetchMock.mockImplementationOnce((_url, init) => {
    lastSignal = init.signal;
    sse = controllableSse(init.signal);
    return Promise.resolve(sse.response);
  });
  return {
    push: (frame) => sse.push(frame),
    close: () => sse.close(),
  };
}

describe('useAiStream — 상태 전이', () => {
  it('처음에는 유휴 상태다', () => {
    const { result, unmount } = renderHook(useAiStream);

    expect(result.current.status).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.usage).toBeNull();
    expect(result.current.isStreaming).toBe(false);

    unmount();
  });

  it('시작 → 진행 → 완료로 옮겨가며 텍스트를 누적한다', async () => {
    const stream = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    expect(result.current.status).toBe('streaming');
    expect(result.current.isStreaming).toBe(true);

    stream.push('data: {"delta":"정규화"}\n\n');
    await flush();
    expect(result.current.text).toBe('정규화');
    expect(result.current.status).toBe('streaming');

    stream.push('data: {"delta":"는 중복 제거"}\n\n');
    await flush();
    expect(result.current.text).toBe('정규화는 중복 제거');

    stream.push('data: {"done":true,"usage":{"output_tokens":12}}\n\n');
    stream.close();
    await flush();
    expect(result.current.status).toBe('done');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.usage).toEqual({ output_tokens: 12 });
    expect(result.current.text).toBe('정규화는 중복 제거');

    unmount();
  });

  it('오류 응답은 code·message 를 담은 error 상태로 끝난다', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: '너무 잦음' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { result, unmount } = renderHook(useAiStream);

    await act(async () => { await result.current.start(REQUEST); });

    expect(result.current.status).toBe('error');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toEqual({ code: 'RATE_LIMITED', message: '너무 잦음' });

    unmount();
  });

  it('스트림 중간 error 프레임이 오면 받은 텍스트를 남긴 채 error 로 끝난다', async () => {
    const stream = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    stream.push('data: {"delta":"여기까지"}\n\n');
    await flush();
    stream.push('data: {"error":{"code":"UPSTREAM","message":"모델 실패"}}\n\n');
    stream.close();
    await flush();

    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('UPSTREAM');
    expect(result.current.text).toBe('여기까지');

    unmount();
  });
});

describe('useAiStream — 취소', () => {
  it('cancel 은 오류가 아니라 cancelled 상태로 끝나고 받은 텍스트를 남긴다', async () => {
    const stream = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    stream.push('data: {"delta":"쓰다 만 해설"}\n\n');
    await flush();

    act(() => { result.current.cancel(); });
    await flush();

    expect(result.current.status).toBe('cancelled');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.text).toBe('쓰다 만 해설');

    unmount();
  });

  it('언마운트하면 진행 중인 요청을 abort 한다', async () => {
    const stream = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    stream.push('data: {"delta":"진행 중"}\n\n');
    await flush();
    expect(lastSignal.aborted).toBe(false);

    unmount();

    expect(lastSignal.aborted).toBe(true);
  });

  it('언마운트 후에는 상태를 갱신하지 않는다', async () => {
    nextStream();
    const { result, unmount } = renderHook(useAiStream);
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));

    act(() => { result.current.start(REQUEST); });
    await flush();
    unmount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(errors).toEqual([]);
    spy.mockRestore();
  });
});

describe('useAiStream — 재호출', () => {
  it('다시 시작하면 이전 텍스트·오류를 지우고 새로 쌓는다', async () => {
    const first = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    first.push('data: {"delta":"첫 번째"}\n\n');
    await flush();
    first.push('data: {"error":{"code":"UPSTREAM","message":"실패"}}\n\n');
    first.close();
    await flush();
    expect(result.current.status).toBe('error');

    const second = nextStream();
    act(() => { result.current.start(REQUEST); });
    expect(result.current.text).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('streaming');

    second.push('data: {"delta":"두 번째"}\n\n');
    second.push('data: {"done":true}\n\n');
    second.close();
    await flush();
    expect(result.current.text).toBe('두 번째');
    expect(result.current.status).toBe('done');

    unmount();
  });

  it('재호출은 이전 스트림을 abort 하고, 늦게 도착한 이전 델타를 무시한다', async () => {
    nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    await flush();
    const firstSignal = lastSignal;

    const second = nextStream();
    act(() => { result.current.start(REQUEST); });
    await flush();

    expect(firstSignal.aborted).toBe(true);
    expect(lastSignal).not.toBe(firstSignal);

    second.push('data: {"delta":"새 응답"}\n\n');
    second.push('data: {"done":true}\n\n');
    second.close();
    await flush();

    expect(result.current.text).toBe('새 응답');

    unmount();
  });

  it('reset 은 유휴 상태로 되돌린다', async () => {
    const stream = nextStream();
    const { result, unmount } = renderHook(useAiStream);

    act(() => { result.current.start(REQUEST); });
    stream.push('data: {"delta":"내용"}\n\ndata: {"done":true}\n\n');
    stream.close();
    await flush();
    expect(result.current.status).toBe('done');

    act(() => { result.current.reset(); });
    expect(result.current.status).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.usage).toBeNull();

    unmount();
  });
});
