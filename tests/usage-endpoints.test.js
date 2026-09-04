// 세 엔드포인트의 usage 계측 (블루프린트 §5 Phase 5).
//
// 여기서 못 박는 것:
//   1. 요청 하나에 **구조화 로그 한 줄**이 stdout 으로 나간다 — 성공이든 실패든.
//      Vercel 로그를 긁어 `scripts/usage-report.mjs` 에 그대로 먹일 수 있어야 하므로
//      줄 전체가 유효한 JSON 이어야 한다.
//   2. 응답에 `cost` 를 **더한다**. 기존 필드는 하나도 바꾸지 않는다 (회귀 방지).
//   3. 로그에 **사용자 입력이 없다** — 답안·스냅샷·문항 id 가 새어 나가면 안 된다.
//
// SDK 는 모킹한다 (이 환경에 API 키가 없다). 오류 클래스는 실물을 써야
// `classifyUpstreamError` 의 instanceof 분류가 실제로 검증된다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { streamMock, parseMock, toolRunnerMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  parseMock: vi.fn(),
  toolRunnerMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal();
  const Real = actual.default;
  class MockAnthropic {
    constructor() {
      this.messages = { stream: streamMock, parse: parseMock };
      this.beta = {
        messages: { stream: streamMock, parse: parseMock, toolRunner: toolRunnerMock },
      };
    }
  }
  Object.setPrototypeOf(MockAnthropic, Real);
  return { ...actual, default: MockAnthropic };
});

const Anthropic = (await import('@anthropic-ai/sdk')).default;
const tutor = await import('../api/ai/tutor.js');
const plan = await import('../api/ai/plan.js');
const grade = await import('../api/ai/grade.js');
const { resetRateLimits, DEFAULT_RATE_LIMIT } = await import('../lib/ai/guard.js');
const { resetClient } = await import('../lib/ai/client.js');
const { clearContentCache } = await import('../lib/ai/content.js');
const { USAGE_RECORD_FIELDS } = await import('../lib/ai/usage.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

/** 학습자가 쓴 답안 — 이 문자열이 로그 어디에도 나오면 안 된다. */
const SECRET_ANSWER = '원자값으로쪼개는것이라고생각합니다';

const START_USAGE = {
  input_tokens: 1_000,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 2_000,
};
const FULL_USAGE = { ...START_USAGE, output_tokens: 500 };

// ─── 오답 해설 (SSE) ────────────────────────────────────────────────────────

/**
 * SDK MessageStream 흉내.
 * 실제 스트림처럼 usage 가 두 번에 나눠 온다 — message_start 에 입력·캐시,
 * message_delta 에 누적 출력. 중간에 끊기면 출력 토큰만 모르는 상태가 된다.
 */
function fakeTutorStream({ failAfter } = {}) {
  const events = [
    { type: 'message_start', message: { usage: { ...START_USAGE } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '조각' } },
    { type: 'message_delta', usage: { output_tokens: 500 } },
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
    finalMessage: async () => {
      if (failAfter !== undefined) {
        throw new Anthropic.InternalServerError(503, {}, 'overloaded', new Headers());
      }
      return { stop_reason: 'end_turn', usage: FULL_USAGE };
    },
  };
}

const failingTutorStream = (error) => ({
  async *[Symbol.asyncIterator]() {
    throw error;
    // eslint-disable-next-line no-unreachable
    yield null;
  },
  finalMessage: async () => {
    throw error;
  },
});

// ─── 플래너 (Tool Runner + SSE) ──────────────────────────────────────────────

const PLAN = {
  date: '2026-09-04',
  items: [
    { type: 'review_wrong', source: 'quiz100', ids: ['001'], minutes: 20, why: '정규화가 약하다' },
    { type: 'study_day', day: 6, section: '결합도', minutes: 40, why: '미학습 구간' },
  ],
  rationale: '오답 복습을 앞에 둔다.',
  riskFlags: [],
};

const planFinal = (text = JSON.stringify(PLAN)) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: FULL_USAGE,
});

function fakePlanRunner({ failAtStart, failMidStream, finalMessage } = {}) {
  const last = finalMessage ?? planFinal();
  let turn = 0;
  const iterator = {
    async next() {
      if (turn === 0 && failAtStart) throw failAtStart;
      if (turn === 1 && failMidStream) throw failMidStream;
      if (turn > 0) return { done: true, value: undefined };
      turn += 1;
      return {
        done: false,
        value: {
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_stop' };
          },
          finalMessage: async () => last,
        },
      };
    },
  };
  return { [Symbol.asyncIterator]: () => iterator, done: async () => last };
}

// ─── 채점 (구조화 출력) ──────────────────────────────────────────────────────

const GRADE = {
  verdict: 'partial',
  score: 60,
  feedback: '1NF 는 맞혔지만 BCNF 가 빠졌습니다.',
  missedPoints: ['BCNF: 모든 결정자가 후보키'],
  confidence: 0.82,
};

const gradeMessage = (parsed = GRADE, usage = FULL_USAGE) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(parsed) }],
  parsed_output: parsed,
  usage,
});

// ─── 요청 헬퍼 ───────────────────────────────────────────────────────────────

const request = (path, payload, ip) =>
  new Request(`https://example.test/api/ai/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  });

const tutorRequest = () =>
  request('tutor', { source: 'quiz100', id: '002', userAnswer: SECRET_ANSWER, history: [] }, '203.0.113.9');

const planRequest = () =>
  request(
    'plan',
    {
      snapshot: {
        examDate: '2026-10-18',
        wrongNotes: [
          {
            source: 'quiz100',
            id: '001',
            question: SECRET_ANSWER,
            category: '데이터베이스',
            reviewCount: 0,
            mastered: false,
            addedAt: 1,
            lastReviewed: 0,
          },
        ],
        quizResults: { '002': 'answered' },
        studyTime: { '2026-09-01': 90 },
        dayChecks: { 1: true },
        availableMinutes: 90,
      },
    },
    '203.0.113.44'
  );

const gradeRequest = () =>
  request('grade', { kind: 'short', source: 'quiz100', id: '002', userAnswer: SECRET_ANSWER }, '198.51.100.7');

function parseSse(text) {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

/** stdout 으로 나간 줄 중 사용 기록(한 줄 JSON)만 골라낸다. */
function usageLines() {
  return console.log.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

const onlyUsageRecord = () => {
  const lines = usageLines();
  expect(lines).toHaveLength(1);
  return lines[0];
};

/** stdout·stderr 로 나간 모든 줄을 한 문자열로 (개인 데이터 유출 검사용) */
const allLogText = () =>
  [console.log, console.warn, console.error]
    .flatMap((fn) => fn.mock.calls)
    .flat()
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value ?? null)))
    .join('\n');

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.stubEnv('AI_ACCESS_CODE', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  streamMock.mockReset().mockImplementation(() => fakeTutorStream());
  parseMock.mockReset().mockResolvedValue(gradeMessage());
  toolRunnerMock.mockReset().mockImplementation(() => fakePlanRunner());

  resetRateLimits();
  resetClient();
  clearContentCache();
  tutor.resetSystemBlocks();
  plan.resetPlanSystemBlocks();
  grade.resetGradeSystemBlocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('사용 기록 — 세 엔드포인트 공통', () => {
  const cases = [
    { name: 'tutor', effort: 'low', run: async () => (await tutor.POST(tutorRequest())).text() },
    { name: 'plan', effort: 'high', run: async () => (await plan.POST(planRequest())).text() },
    { name: 'grade', effort: 'medium', run: async () => (await grade.POST(gradeRequest())).text() },
  ];

  for (const { name, effort, run } of cases) {
    it(`${name}: 성공 요청 하나에 로그 한 줄이 나간다`, async () => {
      await run();
      const record = onlyUsageRecord();

      expect(record.endpoint).toBe(name);
      expect(record.ok).toBe(true);
      expect(record.errorCode).toBeNull();
      expect(record.model).toBe('claude-opus-5');
      expect(record.effort).toBe(effort);
    });

    it(`${name}: 기록은 계약된 열두 필드만 갖는다`, async () => {
      await run();
      expect(Object.keys(onlyUsageRecord()).sort()).toEqual([...USAGE_RECORD_FIELDS].sort());
    });

    it(`${name}: 토큰과 비용을 실제 usage 로 채운다`, async () => {
      await run();
      const record = onlyUsageRecord();

      expect(record.inputTokens).toBe(1_000);
      expect(record.outputTokens).toBe(500);
      expect(record.cacheReadTokens).toBe(10_000);
      expect(record.cacheCreationTokens).toBe(2_000);
      expect(record.costUsd).toBe(0.035);
    });

    it(`${name}: 지연 시간과 시각을 남긴다`, async () => {
      await run();
      const record = onlyUsageRecord();

      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(record.latencyMs)).toBe(true);
      expect(Date.parse(record.ts)).not.toBeNaN();
    });

    it(`${name}: 로그에 사용자 입력이 들어가지 않는다`, async () => {
      await run();
      expect(allLogText()).not.toContain(SECRET_ANSWER);
    });
  }
});

describe('오답 해설 — 응답 계약', () => {
  it('done 프레임에 cost 를 더한다 (기존 필드는 그대로)', async () => {
    const frames = parseSse(await (await tutor.POST(tutorRequest())).text());
    const done = frames.at(-1);

    expect(done.done).toBe(true);
    expect(done.usage).toEqual(FULL_USAGE); // 프론트가 이미 읽는 필드 — 바뀌지 않는다
    expect(done.cost).toMatchObject({ usd: 0.035, known: true, model: 'claude-opus-5' });
  });

  it('delta 프레임에는 cost 를 붙이지 않는다', async () => {
    const frames = parseSse(await (await tutor.POST(tutorRequest())).text());
    expect(frames.slice(0, -1)).toEqual([{ delta: '조각' }]);
  });

  it('스트림 시작 전 실패도 ok:false 로 기록한다', async () => {
    streamMock.mockImplementation(() =>
      failingTutorStream(new Anthropic.InternalServerError(503, {}, 'boom', new Headers()))
    );

    const res = await tutor.POST(tutorRequest());
    expect(res.status).toBe(502);

    const record = onlyUsageRecord();
    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
    expect(record.inputTokens).toBeNull(); // 아무것도 못 받았다 — 0 이 아니라 모름
    expect(record.costUsd).toBeNull();
  });

  it('스트림 도중 끊기면 그때까지 받은 토큰만 기록하고 총액은 null 이다', async () => {
    streamMock.mockImplementation(() => fakeTutorStream({ failAfter: 2 }));

    await (await tutor.POST(tutorRequest())).text();
    const record = onlyUsageRecord();

    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
    expect(record.inputTokens).toBe(1_000); // message_start 로 받은 값은 살린다
    expect(record.outputTokens).toBeNull(); // 출력은 못 봤다
    expect(record.costUsd).toBeNull(); // 모르는 항목이 있으면 총액을 내지 않는다
  });
});

describe('학습 플래너 — 응답 계약', () => {
  it('done 프레임에 cost 를 더한다 (plan·usage 는 그대로)', async () => {
    const frames = parseSse(await (await plan.POST(planRequest())).text());
    const done = frames.at(-1);

    expect(done.done).toBe(true);
    expect(done.plan).toEqual(PLAN);
    expect(done.usage).toEqual(FULL_USAGE);
    expect(done.cost).toMatchObject({ usd: 0.035, known: true });
  });

  it('첫 턴 실패도 ok:false 로 기록한다', async () => {
    toolRunnerMock.mockImplementation(() =>
      fakePlanRunner({
        failAtStart: new Anthropic.InternalServerError(503, {}, 'boom', new Headers()),
      })
    );

    expect((await plan.POST(planRequest())).status).toBe(502);

    const record = onlyUsageRecord();
    expect(record.endpoint).toBe('plan');
    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
  });

  it('계획 추출에 실패하면 토큰은 알아도 ok:false 로 남긴다', async () => {
    toolRunnerMock.mockImplementation(() =>
      fakePlanRunner({ finalMessage: planFinal('계획이 아닌 산문') })
    );

    const frames = parseSse(await (await plan.POST(planRequest())).text());
    expect(frames.at(-1).error.code).toBe('UPSTREAM');

    const record = onlyUsageRecord();
    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
    expect(record.costUsd).toBe(0.035); // 실패해도 토큰은 썼다
  });
});

describe('자동 채점 — 응답 계약', () => {
  it('응답 객체에 cost 를 더한다 (다섯 필드는 그대로)', async () => {
    const body = await (await grade.POST(gradeRequest())).json();

    expect(body).toMatchObject(GRADE);
    expect(Object.keys(body).sort()).toEqual([
      'confidence',
      'cost',
      'feedback',
      'missedPoints',
      'score',
      'verdict',
    ]);
    expect(body.cost).toMatchObject({ usd: 0.035, known: true, pricingAsOf: '2026-06' });
  });

  it('usage 는 여전히 응답에 싣지 않는다', async () => {
    const body = await (await grade.POST(gradeRequest())).json();
    expect(body).not.toHaveProperty('usage');
  });

  it('업스트림 실패도 ok:false 로 기록한다', async () => {
    parseMock.mockRejectedValue(new Anthropic.InternalServerError(503, {}, 'boom', new Headers()));

    expect((await grade.POST(gradeRequest())).status).toBe(502);

    const record = onlyUsageRecord();
    expect(record.endpoint).toBe('grade');
    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
    expect(record.costUsd).toBeNull();
  });

  it('채점 결과가 계약을 어기면 토큰은 알아도 ok:false 로 남긴다', async () => {
    parseMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '채점 못 함' }],
      parsed_output: null,
      usage: FULL_USAGE,
    });

    expect((await grade.POST(gradeRequest())).status).toBe(502);

    const record = onlyUsageRecord();
    expect(record.ok).toBe(false);
    expect(record.costUsd).toBe(0.035);
  });

  it('usage 가 없는 응답이면 토큰을 0 이 아니라 null 로 남긴다', async () => {
    parseMock.mockResolvedValue({ ...gradeMessage(), usage: undefined });

    const body = await (await grade.POST(gradeRequest())).json();

    expect(body.cost.usd).toBeNull();
    expect(body.cost.warning).toBe('NO_USAGE');
    expect(onlyUsageRecord().inputTokens).toBeNull();
  });

  it('레이트리밋에 걸린 요청은 업스트림을 부르지 않았으므로 기록하지 않는다', async () => {
    // 한도(기본 10)까지 채운다 — 여기까지는 정상 호출이라 기록이 남는다.
    for (let i = 0; i < DEFAULT_RATE_LIMIT.max; i++) await grade.POST(gradeRequest());
    expect(usageLines()).toHaveLength(DEFAULT_RATE_LIMIT.max);

    console.log.mockClear();
    const blocked = await grade.POST(gradeRequest());

    expect(blocked.status).toBe(429);
    expect(usageLines()).toHaveLength(0); // 돈이 안 나간 요청은 비용 기록도 없다
  });
});

describe('응답의 cost 는 프론트 원장이 그대로 저장할 수 있는 모양이다', () => {
  // src/utils/usageLedger.js 의 normalizeCostEntry 가 계약된 이름으로 읽는다.
  // 비용만 보내면 원장의 토큰 항목이 전부 0 이 되므로 기록을 통째로 싣는다.
  const contractFields = [...USAGE_RECORD_FIELDS];

  it('tutor done 프레임의 cost 가 계약된 열두 필드를 갖는다', async () => {
    const done = parseSse(await (await tutor.POST(tutorRequest())).text()).at(-1);

    for (const field of contractFields) expect(done.cost).toHaveProperty(field);
    expect(done.cost.endpoint).toBe('tutor');
    expect(done.cost.costUsd).toBe(0.035);
    expect(done.cost.inputTokens).toBe(1_000);
    expect(done.cost.usd).toBe(done.cost.costUsd);
  });

  it('plan done 프레임의 cost 도 같은 모양이다', async () => {
    const done = parseSse(await (await plan.POST(planRequest())).text()).at(-1);

    for (const field of contractFields) expect(done.cost).toHaveProperty(field);
    expect(done.cost.endpoint).toBe('plan');
    expect(done.cost.effort).toBe('high');
    expect(done.cost.outputTokens).toBe(500);
  });

  it('grade 응답의 cost 도 같은 모양이다', async () => {
    const body = await (await grade.POST(gradeRequest())).json();

    for (const field of contractFields) expect(body.cost).toHaveProperty(field);
    expect(body.cost.endpoint).toBe('grade');
    expect(body.cost.effort).toBe('medium');
    expect(body.cost.cacheReadTokens).toBe(10_000);
  });

  it('cost 는 로그에 남은 기록과 같은 값을 담는다', async () => {
    const done = parseSse(await (await tutor.POST(tutorRequest())).text()).at(-1);
    const record = onlyUsageRecord();

    for (const field of contractFields) expect(done.cost[field]).toEqual(record[field]);
  });

  it('cost 에도 개인 학습 데이터가 없다', async () => {
    const done = parseSse(await (await tutor.POST(tutorRequest())).text()).at(-1);
    expect(JSON.stringify(done.cost)).not.toContain(SECRET_ANSWER);
    expect(JSON.stringify(done.cost)).not.toContain('quiz100');
  });
});
