// @vitest-environment jsdom
// aiClient 가 사용 원장(utils/usageLedger → utils/storage)을 쓰므로 localStorage 가 필요하다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamTutor, AiRequestError, TUTOR_ENDPOINT } from '../src/services/aiClient.js';

const encoder = new TextEncoder();

// SSE 응답을 흉내낸다. chunks 는 "네트워크가 나눠서 준 조각" 그대로이며
// 프레임 경계(\n\n)와 일치할 필요가 없다 — 그게 이 테스트의 핵심이다.
function sseResponse(chunks, { status = 200 } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// 실제 fetch 처럼 signal 이 끊기면 본문 스트림을 AbortError 로 터뜨린다.
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

const REQUEST = { source: 'codedrill', id: 'C-07', userAnswer: '30 50' };

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('streamTutor — 요청', () => {
  it('명세대로 JSON 본문을 POST 한다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    await streamTutor(REQUEST);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TUTOR_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      source: 'codedrill',
      id: 'C-07',
      userAnswer: '30 50',
      history: [],
    });
  });

  it('접근 코드 환경변수가 없으면 x-access-code 헤더를 아예 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    await streamTutor(REQUEST);

    const [, init] = fetchMock.mock.calls[0];
    expect('x-access-code' in init.headers).toBe(false);
  });

  it('접근 코드 환경변수가 있으면 x-access-code 헤더로 실어 보낸다', async () => {
    vi.stubEnv('VITE_AI_ACCESS_CODE', 'secret-code');
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    await streamTutor(REQUEST);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-access-code']).toBe('secret-code');
  });

  it('빈 문자열 접근 코드는 미설정으로 본다', async () => {
    vi.stubEnv('VITE_AI_ACCESS_CODE', '   ');
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    await streamTutor(REQUEST);

    const [, init] = fetchMock.mock.calls[0];
    expect('x-access-code' in init.headers).toBe(false);
  });
});

describe('streamTutor — SSE 파싱', () => {
  it('정상 시퀀스의 delta 를 순서대로 넘기고 누적 텍스트를 돌려준다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"delta":"정규화"}\n\n',
        'data: {"delta":"란 "}\n\n',
        'data: {"delta":"무엇인가"}\n\n',
        'data: {"done":true,"usage":{"input_tokens":10}}\n\n',
      ])
    );
    const deltas = [];

    const result = await streamTutor(REQUEST, { onDelta: (d) => deltas.push(d) });

    expect(deltas).toEqual(['정규화', '란 ', '무엇인가']);
    expect(result.text).toBe('정규화란 무엇인가');
    expect(result.usage).toEqual({ input_tokens: 10 });
    expect(result.aborted).toBe(false);
  });

  it('한 프레임이 청크 경계로 쪼개져도 온전히 파싱한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"del',
        'ta":"쪼개',
        '진 프레임"}',
        '\n',
        '\ndata: {"done":true}\n\n',
      ])
    );
    const deltas = [];

    const result = await streamTutor(REQUEST, { onDelta: (d) => deltas.push(d) });

    expect(deltas).toEqual(['쪼개진 프레임']);
    expect(result.text).toBe('쪼개진 프레임');
  });

  it('멀티바이트 문자가 청크 중간에서 잘려도 깨지지 않는다', async () => {
    // "한" = EC 95 9C — 바이트 단위로 갈라 보낸다
    const bytes = encoder.encode('data: {"delta":"한글"}\n\ndata: {"done":true}\n\n');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('한글');
  });

  it('한 청크에 여러 프레임이 들어와도 전부 파싱한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"delta":"A"}\n\ndata: {"delta":"B"}\n\ndata: {"delta":"C"}\n\ndata: {"done":true}\n\n',
      ])
    );
    const deltas = [];

    await streamTutor(REQUEST, { onDelta: (d) => deltas.push(d) });

    expect(deltas).toEqual(['A', 'B', 'C']);
  });

  it('마지막 프레임에 종결 개행이 없어도 버퍼 잔여분을 처리한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":"끝"}\n\ndata: {"done":true,"usage":{"output_tokens":3}}'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('끝');
    expect(result.usage).toEqual({ output_tokens: 3 });
  });

  it('CRLF 개행을 쓰는 서버 응답도 파싱한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":"윈도우"}\r\n\r\ndata: {"done":true}\r\n\r\n'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('윈도우');
  });

  it('한 프레임에 data 줄이 여러 개면 개행으로 이어 붙여 파싱한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":\ndata: "여러 줄"}\n\ndata: {"done":true}\n\n'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('여러 줄');
  });

  it('주석 줄(:)과 event/id 필드는 무시한다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([': keep-alive\n\nevent: message\nid: 1\ndata: {"delta":"본문"}\n\ndata: {"done":true}\n\n'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('본문');
  });

  it('done 프레임 뒤의 프레임은 읽지 않는다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":"A"}\n\ndata: {"done":true}\n\ndata: {"delta":"유령"}\n\n'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('A');
  });

  it('done 없이 스트림이 끝나도 받은 텍스트를 정상 반환한다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"delta":"잘린 응답"}\n\n']));

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('잘린 응답');
    expect(result.usage).toBeNull();
  });

  it('JSON 이 아닌 data 줄은 건너뛰고 계속 읽는다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: not-json\n\ndata: {"delta":"살아남음"}\n\ndata: {"done":true}\n\n'])
    );

    const result = await streamTutor(REQUEST);

    expect(result.text).toBe('살아남음');
  });
});

describe('streamTutor — 오류 정규화', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [400, 'BAD_REQUEST'],
    [502, 'UPSTREAM'],
  ])('%i 응답 본문의 error 코드를 그대로 전달한다', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code, message: '서버 메시지' } }, status));

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe(code);
    expect(err.message).toBe('서버 메시지');
    expect(err.status).toBe(status);
  });

  it('본문이 JSON 이 아니면 상태 코드로 오류 코드를 정한다', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('UPSTREAM');
    expect(err.message).toBeTruthy();
  });

  it('알 수 없는 상태 코드는 UPSTREAM 으로 접는다', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err.code).toBe('UPSTREAM');
  });

  it('스트림 중간 error 프레임도 같은 형태의 오류로 던진다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"delta":"여기까지"}\n\n',
        'data: {"error":{"code":"UPSTREAM","message":"모델 호출 실패"}}\n\n',
      ])
    );

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('UPSTREAM');
    expect(err.message).toBe('모델 호출 실패');
    // 끊기기 전까지 받은 텍스트는 잃지 않는다
    expect(err.partialText).toBe('여기까지');
  });

  it('네트워크 실패는 NETWORK 코드로 정규화한다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('NETWORK');
  });

  it('본문 없는 200 응답은 PROTOCOL 오류다', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: null });

    const err = await streamTutor(REQUEST).catch((e) => e);

    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('PROTOCOL');
  });
});

describe('streamTutor — 취소', () => {
  it('스트리밍 도중 abort 하면 오류가 아니라 정상 취소로 끝난다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(hangingResponse('data: {"delta":"부분"}\n\n', init.signal))
    );
    const deltas = [];

    const promise = streamTutor(REQUEST, {
      signal: controller.signal,
      onDelta: (d) => {
        deltas.push(d);
        controller.abort();
      },
    });

    const result = await promise;

    expect(result.aborted).toBe(true);
    expect(result.text).toBe('부분');
    expect(deltas).toEqual(['부분']);
  });

  it('요청 전에 이미 취소된 signal 이면 fetch 를 부르지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await streamTutor(REQUEST, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('본문 스트림이 abort 에 반응하지 않아도 즉시 취소로 끝난다', async () => {
    // 실제 fetch 는 abort 시 본문 스트림을 AbortError 로 터뜨리지만,
    // 그걸 기다리다 UI 가 "생성 중"에 멈춰 있으면 안 된다.
    const controller = new AbortController();
    let streamCtrl;
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ start(c) { streamCtrl = c; } }), { status: 200 })
    );

    const promise = streamTutor(REQUEST, {
      signal: controller.signal,
      onDelta: () => controller.abort(),
    });
    streamCtrl.enqueue(encoder.encode('data: {"delta":"부분"}\n\n'));

    const result = await promise;

    expect(result.aborted).toBe(true);
    expect(result.text).toBe('부분');
  });

  it('fetch 자체가 AbortError 로 거절돼도 취소로 끝난다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    const result = await streamTutor(REQUEST, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(result.text).toBe('');
  });
});
