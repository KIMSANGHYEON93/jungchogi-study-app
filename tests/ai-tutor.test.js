import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

// SDK 를 모킹하되 **오류 클래스는 실물을 그대로 쓴다** — classifyUpstreamError 가
// instanceof 로 분류하므로 가짜 클래스를 쓰면 분류 로직을 검증하지 못한다.
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal();
  const Real = actual.default;
  class MockAnthropic {
    constructor() {
      this.messages = { stream: streamMock };
      this.beta = { messages: { stream: streamMock } };
    }
  }
  Object.setPrototypeOf(MockAnthropic, Real); // static 오류 클래스 상속
  return { ...actual, default: MockAnthropic };
});

const Anthropic = (await import('@anthropic-ai/sdk')).default;
const { POST, resetSystemBlocks } = await import('../api/ai/tutor.js');
const { resetRateLimits } = await import('../lib/ai/guard.js');
const { resetClient } = await import('../lib/ai/client.js');
const { clearContentCache } = await import('../lib/ai/content.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

const DEFAULT_USAGE = {
  input_tokens: 120,
  output_tokens: 64,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 3_400,
};

/** SDK MessageStream 흉내 — 이벤트를 순서대로 흘리고 finalMessage 를 준다. */
function fakeStream({ deltas = ['첫 조각', ' 둘째 조각'], usage = DEFAULT_USAGE, failAfter } = {}) {
  const events = [
    { type: 'message_start', message: { usage } },
    ...deltas.map((text) => ({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    })),
    // thinking 델타는 해설 본문이 아니므로 무시돼야 한다
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
  ];

  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < events.length; i++) {
        if (failAfter !== undefined && i === failAfter) {
          throw new Anthropic.InternalServerError(503, {}, 'overloaded', new Headers());
        }
        yield events[i];
      }
    },
    finalMessage: async () => ({ stop_reason: 'end_turn', usage }),
  };
}

/** 스트림을 열자마자(첫 이벤트 전에) 실패하는 스트림 */
function failingStream(error) {
  return {
    async *[Symbol.asyncIterator]() {
      throw error;
      // eslint-disable-next-line no-unreachable
      yield null;
    },
    finalMessage: async () => {
      throw error;
    },
  };
}

const body = (overrides = {}) => ({
  source: 'quiz100',
  id: '002',
  userAnswer: '원자값으로 쪼개는 것',
  history: [],
  ...overrides,
});

function makeRequest(payload, headers = {}) {
  return new Request('https://example.test/api/ai/tutor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

/** SSE 본문을 `data:` 프레임의 JSON 배열로 파싱한다. */
function parseSse(text) {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.stubEnv('AI_ACCESS_CODE', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  streamMock.mockReset();
  streamMock.mockImplementation(() => fakeStream());
  resetRateLimits();
  resetClient();
  clearContentCache();
  resetSystemBlocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/ai/tutor — SSE 성공 경로', () => {
  it('text/event-stream 으로 응답한다', async () => {
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
  });

  it('delta 프레임을 순서대로 흘리고 done 프레임으로 끝낸다', async () => {
    const res = await POST(makeRequest(body()));
    const frames = parseSse(await res.text());

    expect(frames.slice(0, -1)).toEqual([{ delta: '첫 조각' }, { delta: ' 둘째 조각' }]);
    // Phase 5 에서 done 프레임에 cost 가 **더해졌다**. usage 는 그대로다.
    expect(frames.at(-1)).toEqual({ done: true, usage: DEFAULT_USAGE, cost: expect.any(Object) });
  });

  it('각 프레임은 `data: <json>` 한 줄이고 빈 줄로 끝난다', async () => {
    streamMock.mockImplementation(() => fakeStream({ deltas: ['가', '나'] }));
    const raw = await (await POST(makeRequest(body()))).text();

    // Phase 5 에서 done 프레임에 cost 가 붙어 통째로 비교하지 않는다.
    // 여기서 지키는 계약은 "한 프레임 = `data: ` + JSON 한 줄 + 빈 줄" 이다.
    const chunks = raw.split('\n\n');
    expect(chunks.at(-1)).toBe(''); // 마지막 프레임도 빈 줄로 끝난다
    const sent = chunks.slice(0, -1);

    expect(sent).toHaveLength(3);
    expect(sent[0]).toBe('data: {"delta":"가"}');
    expect(sent[1]).toBe('data: {"delta":"나"}');
    expect(sent[2].startsWith('data: {"done":true,')).toBe(true);
    for (const frame of sent) expect(frame).not.toContain('\n');
  });

  it('done 프레임의 usage 로 캐시 적중을 확인할 수 있다', async () => {
    const res = await POST(makeRequest(body()));
    const done = parseSse(await res.text()).at(-1);
    expect(done.usage.cache_read_input_tokens).toBe(3_400);
  });

  it('text_delta 가 아닌 이벤트는 본문으로 내보내지 않는다', async () => {
    streamMock.mockImplementation(() => fakeStream({ deltas: ['본문'] }));
    const frames = parseSse(await (await POST(makeRequest(body()))).text());
    expect(frames.filter((f) => 'delta' in f)).toEqual([{ delta: '본문' }]);
  });

  it('세 가지 source 를 모두 처리한다', async () => {
    for (const [source, id] of [
      ['quiz100', '001'],
      ['codedrill', 'S-01'],
      ['bogang', 'B01'],
    ]) {
      const res = await POST(makeRequest(body({ source, id })));
      expect(res.status).toBe(200);
    }
  });
});

describe('프롬프트 구성 — 캐시 프리픽스 안정성', () => {
  const paramsOf = (call) => streamMock.mock.calls[call][0];

  it('system 은 블록 배열이고 마지막 블록에 1h ephemeral 캐시를 건다', async () => {
    await (await POST(makeRequest(body()))).text();
    const { system } = paramsOf(0);
    expect(Array.isArray(system)).toBe(true);
    expect(system.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('요청이 달라도 system 프리픽스는 바이트 단위로 동일하다', async () => {
    await (await POST(makeRequest(body({ source: 'quiz100', id: '001' })))).text();
    // 캐시된 객체를 재사용해서가 아니라 **다시 만들어도** 같아야 한다
    resetSystemBlocks();
    await (await POST(makeRequest(body({ source: 'codedrill', id: 'C-01' })))).text();
    expect(paramsOf(1).system).not.toBe(paramsOf(0).system);
    expect(JSON.stringify(paramsOf(1).system)).toBe(JSON.stringify(paramsOf(0).system));
  });

  it('system 프리픽스에 타임스탬프·UUID 가 없다', async () => {
    await (await POST(makeRequest(body()))).text();
    const text = JSON.stringify(paramsOf(0).system);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // ISO 타임스탬프
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i); // UUID
  });

  it('가변 내용(사용자 답안·문항)은 messages 에만 들어간다', async () => {
    await (await POST(makeRequest(body({ userAnswer: '내가-쓴-답' })))).text();
    const { system, messages } = paramsOf(0);
    expect(JSON.stringify(system)).not.toContain('내가-쓴-답');
    expect(JSON.stringify(messages)).toContain('내가-쓴-답');
  });

  it('문항의 정답과 관련 교재 섹션을 messages 에 동봉한다', async () => {
    await (await POST(makeRequest(body({ source: 'quiz100', id: '002' })))).text();
    const serialized = JSON.stringify(paramsOf(0).messages);
    expect(serialized).toContain('부분 함수 종속'); // 교재 정답
    expect(serialized).toContain('정규화 단계'); // 관련 섹션 헤딩
  });

  it('history 를 첫 사용자 메시지 뒤에 이어 붙인다', async () => {
    const history = [
      { role: 'assistant', content: '앞선 해설' },
      { role: 'user', content: '왜 2NF 인가요?' },
    ];
    await (await POST(makeRequest(body({ history })))).text();
    const { messages } = paramsOf(0);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages.at(-1).content).toBe('왜 2NF 인가요?');
  });

  it('마지막이 assistant 로 끝나지 않게 잘라낸다 (Opus 5 prefill 은 400)', async () => {
    const history = [{ role: 'assistant', content: '앞선 해설' }];
    await (await POST(makeRequest(body({ history })))).text();
    const { messages } = paramsOf(0);
    expect(messages.at(-1).role).toBe('user');
  });

  it('assistant prefill 이나 budget_tokens 를 보내지 않는다', async () => {
    await (await POST(makeRequest(body()))).text();
    const params = paramsOf(0);
    expect(params).not.toHaveProperty('thinking');
    expect(JSON.stringify(params)).not.toContain('budget_tokens');
  });
});

describe('접근 제어', () => {
  it('AI_ACCESS_CODE 미설정이면 헤더 없이 통과한다', async () => {
    expect((await POST(makeRequest(body()))).status).toBe(200);
  });

  it('AI_ACCESS_CODE 설정 + 헤더 없음 → 401 UNAUTHORIZED', async () => {
    vi.stubEnv('AI_ACCESS_CODE', 'let-me-in');
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('AI_ACCESS_CODE 설정 + 헤더 일치 → 200', async () => {
    vi.stubEnv('AI_ACCESS_CODE', 'let-me-in');
    const res = await POST(makeRequest(body(), { 'x-access-code': 'let-me-in' }));
    expect(res.status).toBe(200);
  });

  it('AI_ACCESS_CODE 설정 + 헤더 불일치 → 401', async () => {
    vi.stubEnv('AI_ACCESS_CODE', 'let-me-in');
    const res = await POST(makeRequest(body(), { 'x-access-code': 'nope' }));
    expect(res.status).toBe(401);
  });
});

describe('레이트리밋', () => {
  it('한도를 넘기면 429 RATE_LIMITED 와 Retry-After 를 준다', async () => {
    vi.stubEnv('AI_RATE_LIMIT_PER_MIN', '2');
    let res;
    for (let i = 0; i < 40; i++) {
      res = await POST(makeRequest(body()));
      if (res.status === 429) break;
      await res.text();
    }
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('레이트리밋은 접근 코드보다 먼저 걸린다 (미인증 트래픽도 억제)', async () => {
    vi.stubEnv('AI_ACCESS_CODE', 'let-me-in');
    let res;
    for (let i = 0; i < 40; i++) {
      res = await POST(makeRequest(body()));
      if (res.status === 429) break;
    }
    expect(res.status).toBe(429);
  });
});

describe('요청 검증', () => {
  it('JSON 이 아니면 400 BAD_REQUEST', async () => {
    const res = await POST(makeRequest('{ not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('화이트리스트 밖 source 는 400', async () => {
    const res = await POST(makeRequest(body({ source: 'wikipedia' })));
    expect(res.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('형식이 틀린 id 는 400', async () => {
    expect((await POST(makeRequest(body({ id: '../../etc/passwd' })))).status).toBe(400);
  });

  it('존재하지 않는 문항 id 는 400', async () => {
    const res = await POST(makeRequest(body({ id: '999' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('999');
  });

  it('길이 상한을 넘는 userAnswer 는 400', async () => {
    const res = await POST(makeRequest(body({ userAnswer: 'ㄱ'.repeat(2_001) })));
    expect(res.status).toBe(400);
  });
});

describe('업스트림 오류', () => {
  it('API 키가 없으면 502 UPSTREAM 이고 SDK 를 부르지 않는다', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('UPSTREAM');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('스트림 시작 전 오류는 JSON 502 로 내려간다', async () => {
    streamMock.mockImplementation(() =>
      failingStream(new Anthropic.BadRequestError(400, {}, 'invalid param', new Headers()))
    );
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      error: { code: 'UPSTREAM', message: expect.any(String), retryable: false },
    });
  });

  it('업스트림 429 는 재시도 가능한 RATE_LIMITED 로 전달된다', async () => {
    streamMock.mockImplementation(() =>
      failingStream(new Anthropic.RateLimitError(429, {}, 'slow down', new Headers()))
    );
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(429);
    const payload = await res.json();
    expect(payload.error.code).toBe('RATE_LIMITED');
    expect(payload.error.retryable).toBe(true);
  });

  it('SDK 호출 자체가 예외를 던져도 502 로 감싼다', async () => {
    streamMock.mockImplementation(() => {
      throw new Anthropic.APIConnectionError({ message: 'ECONNRESET' });
    });
    const res = await POST(makeRequest(body()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.retryable).toBe(true);
  });

  it('스트림이 시작된 뒤의 오류는 SSE 프레임으로 나간다', async () => {
    streamMock.mockImplementation(() => fakeStream({ deltas: ['앞부분'], failAfter: 2 }));
    const res = await POST(makeRequest(body()));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = parseSse(await res.text());
    expect(frames[0]).toEqual({ delta: '앞부분' });
    expect(frames.at(-1)).toEqual({
      error: { code: 'UPSTREAM', message: expect.any(String), retryable: true },
    });
    expect(frames.some((f) => f.done)).toBe(false);
  });

  it('finalMessage 가 실패해도 스트림이 SSE 오류 프레임으로 닫힌다', async () => {
    streamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start', message: {} };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } };
      },
      finalMessage: async () => {
        throw new Anthropic.InternalServerError(500, {}, 'boom', new Headers());
      },
    }));
    const frames = parseSse(await (await POST(makeRequest(body()))).text());
    expect(frames.at(-1).error.code).toBe('UPSTREAM');
  });
});
