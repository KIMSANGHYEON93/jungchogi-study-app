// `/api/ai/grade` 호출 계약 (BLUEPRINT §4.2).
//
// 채점은 스트리밍이 아니라 JSON 한 번이다. 그래도 헤더 처리와 오류 정규화는
// 해설·플래너와 **같은 계층**(services/aiTransport.js)을 써야 한다 —
// 화면이 오류 코드 하나만 보고 안내 문구를 고르는 구조가 여기 달려 있다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gradeAnswer, AiRequestError, GRADE_ENDPOINT } from '../src/services/aiClient.js';

const REQUEST = { kind: 'code', source: 'codedrill', id: 'C-07', userAnswer: '1 2 3' };

const OK_BODY = {
  verdict: 'partial',
  score: 60,
  feedback: '두 번째 값이 다릅니다.',
  missedPoints: ['후위 증가 연산자'],
  confidence: 0.82,
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('gradeAnswer — 요청', () => {
  it('명세대로 JSON 본문을 POST 한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));

    await gradeAnswer(REQUEST);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GRADE_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      kind: 'code',
      source: 'codedrill',
      id: 'C-07',
      userAnswer: '1 2 3',
    });
  });

  it('답을 비워 두면 빈 문자열로 보낸다 — 서버가 undefined 를 400 으로 접지 않게', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));

    await gradeAnswer({ kind: 'short', source: 'quiz100', id: '042' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).userAnswer).toBe('');
  });

  it('접근 코드 환경변수가 없으면 x-access-code 헤더를 아예 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));

    await gradeAnswer(REQUEST);

    expect('x-access-code' in fetchMock.mock.calls[0][1].headers).toBe(false);
  });

  it('접근 코드가 설정돼 있으면 해설·플래너와 같은 헤더로 보낸다', async () => {
    vi.stubEnv('VITE_AI_ACCESS_CODE', ' s3cret ');
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));

    await gradeAnswer(REQUEST);

    expect(fetchMock.mock.calls[0][1].headers['x-access-code']).toBe('s3cret');
  });
});

describe('gradeAnswer — 정상 응답', () => {
  it('서버가 준 채점 결과를 그대로 돌려준다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));

    const { result, aborted } = await gradeAnswer(REQUEST);

    expect(aborted).toBe(false);
    expect(result).toEqual(OK_BODY);
  });

  it('채점 결과로 볼 수 없는 응답은 UPSTREAM 으로 접는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await expect(gradeAnswer(REQUEST)).rejects.toMatchObject({
      name: 'AiRequestError',
      code: 'UPSTREAM',
    });
  });

  it('JSON 이 아닌 본문은 PROTOCOL 로 접는다', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );

    await expect(gradeAnswer(REQUEST)).rejects.toMatchObject({ code: 'PROTOCOL' });
  });
});

describe('gradeAnswer — 오류 정규화', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [400, 'BAD_REQUEST'],
    [502, 'UPSTREAM'],
  ])('%i 응답을 %s 로 정규화한다', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code, message: 'detail' } }, status));

    const error = await gradeAnswer(REQUEST).catch((e) => e);

    expect(error).toBeInstanceOf(AiRequestError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('오류 본문이 JSON 이 아니어도 상태 코드로 정규화한다', async () => {
    fetchMock.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    await expect(gradeAnswer(REQUEST)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('서버에 닿지 못하면 NETWORK 다 — 서버 없이도 학습을 이어갈 수 있어야 한다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(gradeAnswer(REQUEST)).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('gradeAnswer — 취소', () => {
  it('취소는 오류가 아니다 — aborted 로 조용히 끝난다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );

    const promise = gradeAnswer(REQUEST, { signal: controller.signal });
    controller.abort();

    await expect(promise).resolves.toEqual({ result: null, aborted: true });
  });

  it('이미 취소된 시그널이면 요청 자체를 보내지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();

    const out = await gradeAnswer(REQUEST, { signal: controller.signal });

    expect(out).toEqual({ result: null, aborted: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
