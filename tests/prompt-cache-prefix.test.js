// 프롬프트 **캐시 프리픽스** 회귀 테스트 (블루프린트 §5 Phase 5).
//
// 프롬프트 캐싱은 **프리픽스 매치**다. 고정 프리픽스의 한 바이트만 달라져도 그 뒤가
// 전부 무효화되고, 그때 깨지는 것은 기능이 아니라 **비용**이다 — 화면은 멀쩡히
// 동작하면서 `cache_read_input_tokens` 만 0 이 된다. 어떤 기존 테스트도 이걸 잡지 않는다.
// 그래서 네 프롬프트(tutor · grade · plan · variants)에 대해 다음을 못 박는다:
//
//   1. 같은 코드에서 만든 고정 프리픽스는 **입력이 달라도 바이트 단위로 같다**
//   2. 시계·난수·UUID·epoch 가 프리픽스에 섞이지 않는다 (시각을 바꿔 두 번 만들어 비교)
//   3. `cache_control` 브레이크포인트가 **고정 프리픽스의 마지막 블록**에 있다
//   4. 가변 데이터(답안·스냅샷·문항)는 브레이크포인트 **뒤**(messages)에만 있다
//   5. 프리픽스가 최소 캐시 가능 분량(1,024 토큰)을 넘는다 — 못 넘으면 캐시가 아예 안 잡힌다
//
// 프롬프트는 `api/ai/*.js` 안의 모듈 상수라 밖에서 import 할 수 없다. 그래서 SDK 를
// 모킹해 **실제로 업스트림에 나가는 요청 파라미터**를 잡아 검사한다 — 프롬프트를
// 따로 노출시키는 것보다 이쪽이 실제 전송값을 보므로 더 정확하다.

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

const tutor = await import('../api/ai/tutor.js');
const grade = await import('../api/ai/grade.js');
const plan = await import('../api/ai/plan.js');
const { buildVariantSystem, buildVariantRequests, estimateTokens } = await import(
  '../lib/ai/variants.js'
);
const { resetRateLimits } = await import('../lib/ai/guard.js');
const { resetClient } = await import('../lib/ai/client.js');
const { clearContentCache, CACHE_PREFIX_FILE } = await import('../lib/ai/content.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));
/** 배포에 실제로 실리는 교재 디렉터리 — 프리픽스 분량 검사는 이쪽으로 해야 뜻이 있다 */
const REAL_DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));

/** Anthropic 이 캐시를 잡아 주는 최소 프리픽스 (Opus/Sonnet 기준) */
const MIN_CACHEABLE_TOKENS = 1_024;

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 };

function fakeStream(message) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '조각' } };
    },
    finalMessage: async () => message,
  };
}

const PLAN_JSON = JSON.stringify({
  date: '2026-09-04',
  items: [{ type: 'study_day', day: 1, section: '포인터', minutes: 30, why: '기초' }],
  rationale: '기초부터',
  riskFlags: [],
});

const textMessage = (text) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: USAGE,
});

/** Tool Runner 흉내 — 도구를 부르지 않고 한 턴에 계획을 낸다 (프롬프트만 보면 되므로) */
function fakeRunner(params) {
  let turn = 0;
  const message = textMessage(PLAN_JSON);
  return {
    params,
    [Symbol.asyncIterator]: () => ({
      async next() {
        if (turn > 0) return { done: true, value: undefined };
        turn += 1;
        return { done: false, value: fakeStream(message) };
      },
    }),
    done: async () => message,
  };
}

const GRADE = {
  verdict: 'partial',
  score: 55,
  feedback: '일부만 맞았습니다.',
  missedPoints: ['BCNF'],
  confidence: 0.8,
};

function request(path, payload, ip) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  });
}

/** 모듈 수명 캐시를 전부 비운다 — 콜드 스타트에서 프리픽스를 다시 만드는 상황을 흉내낸다 */
function coldStart() {
  clearContentCache();
  tutor.resetSystemBlocks();
  grade.resetGradeSystemBlocks();
  plan.resetPlanSystemBlocks();
  resetClient();
}

/** tutor 를 한 번 호출하고 업스트림에 나간 요청 파라미터를 돌려준다 */
async function callTutor(body, ip = '203.0.113.1') {
  streamMock.mockClear();
  const res = await tutor.POST(request('/api/ai/tutor', body, ip));
  await res.text();
  return streamMock.mock.calls.at(-1)[0];
}

async function callGrade(body, ip = '203.0.113.2') {
  parseMock.mockClear();
  const res = await grade.POST(request('/api/ai/grade', body, ip));
  await res.text();
  return parseMock.mock.calls.at(-1)[0];
}

async function callPlan(body, ip = '203.0.113.3') {
  toolRunnerMock.mockClear();
  const res = await plan.POST(request('/api/ai/plan', body, ip));
  await res.text();
  return toolRunnerMock.mock.calls.at(-1)[0];
}

const tutorBody = (overrides = {}) => ({
  source: 'quiz100',
  id: '001',
  userAnswer: '원자성',
  history: [],
  ...overrides,
});

const gradeBody = (overrides = {}) => ({
  kind: 'short',
  source: 'quiz100',
  id: '001',
  userAnswer: '원자성',
  ...overrides,
});

const planBody = (overrides = {}) => ({
  snapshot: {
    examDate: '2026-10-18',
    wrongNotes: [
      {
        source: 'quiz100',
        id: '001',
        question: '트랜잭션',
        category: '데이터베이스',
        reviewCount: 0,
        mastered: false,
        addedAt: 1,
      },
    ],
    quizResults: { '002': 'answered' },
    studyTime: { '2026-09-01': 90 },
    dayChecks: { 1: true },
    availableMinutes: 90,
    ...overrides,
  },
});

/** 고정 프리픽스 블록들의 텍스트를 이어 붙인다 */
const systemText = (system) => system.map((block) => block.text ?? '').join('\n');

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.stubEnv('AI_ACCESS_CODE', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  streamMock.mockReset();
  streamMock.mockImplementation(() => fakeStream(textMessage('해설')));
  parseMock.mockReset();
  parseMock.mockImplementation(async () => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(GRADE) }],
    parsed_output: GRADE,
    usage: USAGE,
  }));
  toolRunnerMock.mockReset();
  toolRunnerMock.mockImplementation((params) => fakeRunner(params));

  resetRateLimits();
  coldStart();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  coldStart();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. 고정 프리픽스는 입력이 달라도 바이트 단위로 같다
// ─────────────────────────────────────────────────────────────────────────────

describe('고정 프리픽스 바이트 안정성', () => {
  it('tutor: 다른 문항·답안이어도 system 이 바이트 단위로 같다', async () => {
    const a = await callTutor(tutorBody({ source: 'quiz100', id: '001', userAnswer: '가' }));
    coldStart(); // 콜드 스타트 — 메모이제이션이 아니라 내용이 같아야 한다
    const b = await callTutor(
      tutorBody({ source: 'codedrill', id: 'C-01', userAnswer: '아주 다른 답안 🙂' })
    );

    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
  });

  it('grade: kind·문항·답안이 달라도 system 이 바이트 단위로 같다', async () => {
    const a = await callGrade(gradeBody({ kind: 'short', source: 'quiz100', id: '001' }));
    coldStart();
    const b = await callGrade(
      gradeBody({ kind: 'code', source: 'codedrill', id: 'C-01', userAnswer: '10 20' })
    );

    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
  });

  it('plan: 스냅샷이 달라도 system 이 바이트 단위로 같다', async () => {
    const a = await callPlan(planBody());
    coldStart();
    const b = await callPlan(
      planBody({ examDate: null, wrongNotes: [], quizResults: {}, availableMinutes: 30 })
    );

    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
  });

  it('variants: 같은 source 면 문항이 달라도 배치 안 모든 요청의 system 이 같다', () => {
    const problems = [
      { id: '001', question: '가', answer: '나', category: '데이터베이스' },
      { id: '002', question: '다', answer: '라', category: '소프트웨어공학' },
    ];
    const requests = buildVariantRequests({ source: 'quiz100', problems, variantsPerItem: 2 });

    expect(requests).toHaveLength(4);
    const [first, ...rest] = requests.map((r) => JSON.stringify(r.params.system));
    expect(rest.every((s) => s === first)).toBe(true);
    // 두 번 만들어도 같아야 한다 (상수만으로 만들어졌는가)
    expect(JSON.stringify(buildVariantSystem('quiz100'))).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 시계·난수가 프리픽스에 섞이지 않는다
// ─────────────────────────────────────────────────────────────────────────────

describe('프리픽스에 비결정적 값이 섞이지 않는다', () => {
  /** 어떤 정적 교재 본문에도 나올 이유가 없는 "생성된 값" 패턴 */
  const NONDETERMINISTIC = [
    [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'ISO 타임스탬프'],
    [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'UUID'],
    [/\b1[6-9]\d{11}\b/, 'epoch 밀리초'],
  ];

  /** 손으로 쓴 시스템 프롬프트(첫 블록)에는 날짜조차 있으면 안 된다 */
  const HAND_WRITTEN_FORBIDDEN = [...NONDETERMINISTIC, [/\b\d{4}-\d{2}-\d{2}\b/, 'YYYY-MM-DD 날짜']];

  const scan = (text, patterns) => {
    for (const [pattern, label] of patterns) {
      expect(
        { label, matched: pattern.exec(text)?.[0] ?? null },
        `프리픽스에 ${label} 가 섞였다`
      ).toEqual({ label, matched: null });
    }
  };

  it.each([
    ['tutor', () => callTutor(tutorBody())],
    ['grade', () => callGrade(gradeBody())],
    ['plan', () => callPlan(planBody())],
  ])('%s: 시각을 바꿔 두 번 만들어도 프리픽스가 같고 생성값이 없다', async (_name, call) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const a = await call();
    coldStart();
    vi.setSystemTime(new Date('2027-11-12T13:14:15.000Z'));
    const b = await call();
    vi.useRealTimers();

    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
    scan(systemText(a.system), NONDETERMINISTIC);
    scan(a.system[0].text, HAND_WRITTEN_FORBIDDEN);
  });

  it('variants: 시각·난수와 무관하게 프리픽스가 같다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const a = JSON.stringify(buildVariantSystem('codedrill'));
    vi.setSystemTime(new Date('2027-11-12T13:14:15.000Z'));
    const b = JSON.stringify(buildVariantSystem('codedrill'));
    vi.useRealTimers();

    expect(b).toBe(a);
    scan(systemText(buildVariantSystem('codedrill')), HAND_WRITTEN_FORBIDDEN);
  });

  it('plan: 오늘 날짜는 프리픽스가 아니라 messages 에 있다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));
    const params = await callPlan(planBody());
    vi.useRealTimers();

    // todayInSeoul 기준 — UTC 01:00 은 서울 10:00 이라 같은 날이다
    expect(JSON.stringify(params.messages)).toContain('2026-09-04');
    expect(systemText(params.system)).not.toContain('2026-09-04');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. cache_control 브레이크포인트 위치
// ─────────────────────────────────────────────────────────────────────────────

describe('cache_control 브레이크포인트 위치', () => {
  const expectBreakpointAtEnd = (system) => {
    expect(system.length).toBeGreaterThan(0);
    // 마지막 고정 블록에만 브레이크포인트가 있어야 한다
    expect(system.at(-1).cache_control).toBeTruthy();
    expect(system.slice(0, -1).every((block) => block.cache_control === undefined)).toBe(true);
  };

  it('tutor: 마지막 고정 블록에만 있고 messages 에는 없다', async () => {
    const params = await callTutor(tutorBody());
    expectBreakpointAtEnd(params.system);
    expect(JSON.stringify(params.messages)).not.toContain('cache_control');
  });

  it('grade: 마지막 고정 블록에만 있고 messages 에는 없다', async () => {
    const params = await callGrade(gradeBody());
    expectBreakpointAtEnd(params.system);
    expect(JSON.stringify(params.messages)).not.toContain('cache_control');
  });

  it('plan: 마지막 고정 블록에만 있고 messages·tools 에는 없다', async () => {
    const params = await callPlan(planBody());
    expectBreakpointAtEnd(params.system);
    expect(JSON.stringify(params.messages)).not.toContain('cache_control');
    // 도구 정의는 system 뒤에 오는 고정값이지만 여기에 브레이크포인트를 또 걸면
    // system 쪽 프리픽스가 두 번 청구된다 — 지금은 걸지 않는 것이 계약이다
    expect(JSON.stringify(params.tools)).not.toContain('cache_control');
  });

  it('variants: 유일한 고정 블록에 브레이크포인트가 있고 messages 에는 없다', () => {
    const [request] = buildVariantRequests({
      source: 'quiz100',
      problems: [{ id: '001', question: '가', answer: '나', category: 'DB' }],
      variantsPerItem: 1,
    });
    expectBreakpointAtEnd(request.params.system);
    expect(JSON.stringify(request.params.messages)).not.toContain('cache_control');
  });

  it('tutor·grade·plan 의 브레이크포인트 TTL 은 1시간이다', async () => {
    const [t, g, p] = [
      await callTutor(tutorBody()),
      await callGrade(gradeBody()),
      await callPlan(planBody()),
    ];
    for (const params of [t, g, p]) {
      expect(params.system.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 가변 데이터는 브레이크포인트 뒤에만 있다
// ─────────────────────────────────────────────────────────────────────────────

describe('가변 데이터는 브레이크포인트 뒤(messages)에만 있다', () => {
  it('tutor: 학습자 답안은 messages 에만 있다', async () => {
    const needle = 'ZZ학습자답안표식ZZ';
    const params = await callTutor(tutorBody({ userAnswer: needle }));

    expect(JSON.stringify(params.messages)).toContain(needle);
    expect(systemText(params.system)).not.toContain(needle);
  });

  it('grade: 학습자 답안은 messages 에만 있다', async () => {
    const needle = 'ZZ채점답안표식ZZ';
    const params = await callGrade(gradeBody({ userAnswer: needle }));

    expect(JSON.stringify(params.messages)).toContain(needle);
    expect(systemText(params.system)).not.toContain(needle);
  });

  it('plan: 스냅샷 값은 messages 에만 있다', async () => {
    const params = await callPlan(planBody({ availableMinutes: 137 }));

    expect(JSON.stringify(params.messages)).toContain('137');
    expect(systemText(params.system)).not.toContain('137');
  });

  it('variants: 원본 문항 본문은 messages 에만 있다', () => {
    const needle = 'ZZ원본지문표식ZZ';
    const [request] = buildVariantRequests({
      source: 'quiz100',
      problems: [{ id: '001', question: needle, answer: '나', category: 'DB' }],
      variantsPerItem: 1,
    });

    expect(JSON.stringify(request.params.messages)).toContain(needle);
    expect(systemText(request.params.system)).not.toContain(needle);
  });

  it('tutor: 교재 문항 본문도 프리픽스가 아니라 messages 에 있다', async () => {
    const params = await callTutor(tutorBody({ source: 'quiz100', id: '001' }));
    const messages = JSON.stringify(params.messages);

    // 픽스처 001 번 문항의 지문 조각
    expect(messages).toContain('트랜잭션');
    expect(systemText(params.system)).not.toContain('트랜잭션의 4가지');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 프리픽스가 최소 캐시 가능 분량을 넘는다
// ─────────────────────────────────────────────────────────────────────────────

describe('프리픽스 분량 (실제 public/data 기준)', () => {
  beforeEach(() => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', REAL_DATA_DIR);
    coldStart();
  });

  it.each([
    ['tutor', () => callTutor(tutorBody({ source: 'quiz100', id: '001' }))],
    ['grade', () => callGrade(gradeBody({ source: 'quiz100', id: '001' }))],
    ['plan', () => callPlan(planBody())],
  ])('%s: 고정 프리픽스가 최소 캐시 가능 분량(1,024 토큰)을 넘는다', async (_name, call) => {
    const params = await call();
    // 프리픽스가 이 값에 못 미치면 cache_control 을 걸어도 캐시가 잡히지 않는다.
    // (그래서 세 엔드포인트 모두 시스템 프롬프트 뒤에 교재 총론을 붙여 둔다)
    expect(estimateTokens(systemText(params.system))).toBeGreaterThan(MIN_CACHEABLE_TOKENS);
  });

  it('교재 총론 파일이 프리픽스에 실제로 실린다', async () => {
    const params = await callTutor(tutorBody({ source: 'quiz100', id: '001' }));
    expect(params.system).toHaveLength(2);
    expect(params.system[1].text.startsWith('# 교재 총론\n\n')).toBe(true);
    expect(CACHE_PREFIX_FILE).toBe('정보처리기사_실기_합격전략.md');
  });
});
