import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamPlan, PLAN_ENDPOINT, AiRequestError } from '../src/services/aiClient.js';

const encoder = new TextEncoder();

// 네트워크가 나눠 준 조각 그대로 — 프레임 경계(\n\n)와 일치할 필요가 없다.
function sseResponse(chunks) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function hangingResponse(firstChunk, signal) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(firstChunk));
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const SNAPSHOT = {
  examDate: '2026-10-18',
  wrongNotes: [{ source: 'quiz100', id: '042', reviewCount: 0, mastered: false, due: true }],
  quizResults: { 'C-01': 'incorrect' },
  studyTime: { '2026-09-02': 40 },
  dayChecks: { 1: true },
  availableMinutes: 90,
};

const PLAN = {
  date: '2026-09-03',
  items: [{ type: 'review_wrong', source: 'quiz100', ids: ['042'], minutes: 20, why: '약점' }],
  rationale: '오답부터',
  riskFlags: [],
};

const donePlanFrame = (plan = PLAN, usage = { input_tokens: 100 }) =>
  `data: ${JSON.stringify({ done: true, plan, usage })}\n\n`;

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('streamPlan — 요청', () => {
  it('명세대로 snapshot 을 감싼 JSON 본문을 POST 한다', async () => {
    fetchMock.mockResolvedValue(sseResponse([donePlanFrame()]));

    await streamPlan(SNAPSHOT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PLAN_ENDPOINT);
    expect(PLAN_ENDPOINT).toBe('/api/ai/plan');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ snapshot: SNAPSHOT });
  });

  it('접근 코드가 설정돼 있으면 x-access-code 헤더를 붙인다', async () => {
    vi.stubEnv('VITE_AI_ACCESS_CODE', 'secret-code');
    fetchMock.mockResolvedValue(sseResponse([donePlanFrame()]));

    await streamPlan(SNAPSHOT);

    expect(fetchMock.mock.calls[0][1].headers['x-access-code']).toBe('secret-code');
  });

  it('접근 코드가 없으면 헤더를 아예 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(sseResponse([donePlanFrame()]));

    await streamPlan(SNAPSHOT);

    expect('x-access-code' in fetchMock.mock.calls[0][1].headers).toBe(false);
  });
});

describe('streamPlan — 도구 호출 진행', () => {
  it('phase:"tool" 프레임을 순서대로 흘려준다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"phase":"tool","tool":"search_content","input":{"query":"결합도"}}\n\n',
        'data: {"phase":"tool_result","tool":"search_content","ok":true}\n\n',
        donePlanFrame(),
      ])
    );
    const events = [];

    const result = await streamPlan(SNAPSHOT, { onToolEvent: (e) => events.push(e) });

    expect(events).toEqual([
      { phase: 'tool', tool: 'search_content', input: { query: '결합도' } },
      { phase: 'tool_result', tool: 'search_content', ok: true },
    ]);
    expect(result.events).toEqual(events);
  });

  it('청크 경계가 프레임 경계와 어긋나도 프레임을 잃지 않는다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"phase":"tool","too',
        'l":"get_section"}\n',
        '\ndata: {"phase":"tool_result","tool":"get_section","ok":true}\n\n' + donePlanFrame(),
      ])
    );
    const events = [];

    await streamPlan(SNAPSHOT, { onToolEvent: (e) => events.push(e) });

    expect(events.map((e) => e.phase)).toEqual(['tool', 'tool_result']);
    expect(events[0].tool).toBe('get_section');
  });

  it('CRLF 를 쓰는 서버에서도 프레임을 읽는다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"phase":"tool","tool":"get_due_reviews"}\r\n\r\n',
        donePlanFrame().replace(/\n/g, '\r\n'),
      ])
    );
    const events = [];

    const result = await streamPlan(SNAPSHOT, { onToolEvent: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(result.plan).toEqual(PLAN);
  });

  it('도구 호출이 없어도 계획만 받으면 성공이다', async () => {
    fetchMock.mockResolvedValue(sseResponse([donePlanFrame()]));

    const result = await streamPlan(SNAPSHOT);

    expect(result.events).toEqual([]);
    expect(result.plan).toEqual(PLAN);
  });
});

describe('streamPlan — 최종 계획', () => {
  it('done 프레임에서 plan 과 usage 를 꺼낸다', async () => {
    fetchMock.mockResolvedValue(sseResponse([donePlanFrame(PLAN, { output_tokens: 2000 })]));

    const result = await streamPlan(SNAPSHOT);

    expect(result.plan).toEqual(PLAN);
    expect(result.usage).toEqual({ output_tokens: 2000 });
    expect(result.aborted).toBe(false);
  });

  it('done 프레임 없이 스트림이 끝나면 UPSTREAM 오류다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"phase":"tool","tool":"search_content"}\n\n'])
    );

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('UPSTREAM');
  });

  it('done 프레임에 plan 이 없으면 UPSTREAM 오류다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true,"usage":{}}\n\n']));

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('UPSTREAM');
  });
});

describe('streamPlan — 오류 정규화', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [400, 'BAD_REQUEST'],
    [502, 'UPSTREAM'],
  ])('%i 응답의 error 코드를 그대로 전달한다', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code, message: '서버 메시지' } }, status));

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it('스냅샷이 너무 크면 서버가 내는 400 을 BAD_REQUEST 로 받는다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'BAD_REQUEST', message: 'snapshot too large' } }, 400)
    );

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err.code).toBe('BAD_REQUEST');
  });

  it('스트림 중간 error 프레임도 같은 오류로 던진다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"phase":"tool","tool":"search_content"}\n\n',
        'data: {"error":{"code":"UPSTREAM","message":"도구 호출 상한 초과","retryable":true}}\n\n',
      ])
    );
    const events = [];

    const err = await streamPlan(SNAPSHOT, { onToolEvent: (e) => events.push(e) }).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('UPSTREAM');
    expect(err.message).toBe('도구 호출 상한 초과');
    // 오류 전까지 받은 진행 상황은 그대로 흘러갔다
    expect(events).toHaveLength(1);
  });

  it('네트워크 실패는 NETWORK 코드다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err.code).toBe('NETWORK');
  });

  it('본문 없는 200 응답은 PROTOCOL 오류다', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: null });

    const err = await streamPlan(SNAPSHOT).catch((e) => e);

    expect(err.code).toBe('PROTOCOL');
  });
});

describe('streamPlan — 취소', () => {
  it('생성 도중 abort 하면 오류가 아니라 정상 취소로 끝난다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(hangingResponse('data: {"phase":"tool","tool":"search_content"}\n\n', init.signal))
    );

    const promise = streamPlan(SNAPSHOT, {
      signal: controller.signal,
      onToolEvent: () => controller.abort(),
    });
    const result = await promise;

    expect(result.aborted).toBe(true);
    expect(result.plan).toBeNull();
  });

  it('이미 취소된 signal 이면 요청조차 보내지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await streamPlan(SNAPSHOT, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
