// 프롬프트 **골든 스냅샷 + 동작 문장** 회귀 테스트 (블루프린트 §5 Phase 5).
//
// ────────────────────────────────────────────────────────────────────────────
//  이 테스트가 깨졌을 때 무엇을 해야 하는가 — 반드시 읽을 것
// ────────────────────────────────────────────────────────────────────────────
//  스냅샷 테스트는 **무심코 갱신하면 아무것도 지키지 않는다.** 기대값만 새 값으로
//  바꾸는 것은 "프롬프트가 바뀐 사실을 기록에서 지우는" 일이지 검증이 아니다.
//
//  깨졌다면 둘 중 하나다:
//   (a) 프롬프트를 **의도적으로** 고쳤다 → 아래 순서를 밟는다.
//       1. 무엇이 달라졌는지 `git diff api/ai/*.js lib/ai/variants.js` 로 눈으로 확인한다.
//       2. **캐시가 통째로 미스된다**는 것을 인지한다. 시스템 프롬프트는 캐시 프리픽스의
//          첫 블록이라, 한 글자만 바뀌어도 그 뒤(교재 총론까지)가 전부 무효화된다.
//          배포 직후 한동안 `cache_read_input_tokens` 가 0 으로 떨어진다.
//       3. 이 파일 아래 `GOLDEN` 의 길이·해시를 새 값으로 바꾼다.
//          새 해시는 실패 메시지의 `received` 에 그대로 찍힌다.
//       4. **같은 커밋에서** `REQUIRED_CLAUSES` 를 다시 읽고, 지워진 문장이 있으면
//          그것이 의도한 것인지 확인한다. 해시만 갱신하고 문장 검사를 건너뛰면
//          채점 기준이나 주입 방어가 조용히 사라진 것을 놓친다.
//   (b) 프롬프트를 **고칠 생각이 없었는데** 깨졌다 → 되돌린다. 누군가 문자열을
//       손댔거나(공백·줄바꿈 포함) 프롬프트에 가변 값이 섞여 들어간 것이다.
//
//  해시는 "무엇이 바뀌었는지"를 알려주지 않는다. 그래서 아래 `REQUIRED_CLAUSES` 로
//  **동작을 좌우하는 문장**을 따로 못 박는다 — 해시가 깨지면 "바뀌었다"를,
//  문장 검사가 깨지면 "무엇이 사라졌는지"를 알려준다.

import { createHash } from 'node:crypto';
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
const { buildVariantSystem, variantSchema } = await import('../lib/ai/variants.js');
const { createPlannerTools, MAX_TOOL_CALLS } = await import('../lib/ai/tools/index.js');
const { resetRateLimits } = await import('../lib/ai/guard.js');
const { resetClient } = await import('../lib/ai/client.js');
const { clearContentCache } = await import('../lib/ai/content.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

/**
 * 손으로 쓴 시스템 프롬프트(첫 고정 블록)의 길이와 SHA-256.
 * 교재 총론 블록은 여기 넣지 않는다 — 그쪽은 교재 편집으로 정상적으로 바뀐다.
 * 갱신 절차는 파일 상단 주석 참조.
 */
const GOLDEN = {
  tutor: { length: 458, sha256: '41d7e1e03ac96ed9c060b47f4b40848dee286aaa0d83eb6ff87dc3d87c04d529' },
  grade: { length: 2137, sha256: '51581fa338bbfd473debc06038d25101bd91f306790ce61ed0ef53db545bb9ec' },
  plan: { length: 851, sha256: '52390511e20cef2f4336c38953c2cf0ac5930bcfc0cf5064cafdcefecc560e44' },
  variantsShort: {
    length: 467,
    sha256: 'ebb4eff95ebee09e51a366747a6fc746f6bc4aa321a39776b640a6d0b09d6e8b',
  },
  variantsDrill: {
    length: 770,
    sha256: 'b1c89dd226912f300c732f74317af32e0562d3ef817b1a012cc5fb2853d25998',
  },
};

const USAGE = { input_tokens: 10, output_tokens: 5 };
const textMessage = (text) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: USAGE,
});

function fakeStream(message) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } };
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
  verdict: 'correct',
  score: 100,
  feedback: '맞았습니다.',
  missedPoints: [],
  confidence: 0.95,
};

function request(path, payload, ip) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  });
}

function coldStart() {
  clearContentCache();
  tutor.resetSystemBlocks();
  grade.resetGradeSystemBlocks();
  plan.resetPlanSystemBlocks();
  resetClient();
}

async function callTutor(body, ip = '203.0.113.21') {
  streamMock.mockClear();
  const res = await tutor.POST(request('/api/ai/tutor', body, ip));
  await res.text();
  return streamMock.mock.calls.at(-1)[0];
}

async function callGrade(body, ip = '203.0.113.22') {
  parseMock.mockClear();
  const res = await grade.POST(request('/api/ai/grade', body, ip));
  await res.text();
  return parseMock.mock.calls.at(-1)[0];
}

async function callPlan(body, ip = '203.0.113.23') {
  toolRunnerMock.mockClear();
  const res = await plan.POST(request('/api/ai/plan', body, ip));
  await res.text();
  return toolRunnerMock.mock.calls.at(-1)[0];
}

const snapshot = {
  examDate: '2026-10-18',
  wrongNotes: [],
  quizResults: {},
  studyTime: {},
  dayChecks: {},
  availableMinutes: 90,
};

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fingerprint = (text) => ({ length: text.length, sha256: sha256(text) });

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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  coldStart();
});

// ─────────────────────────────────────────────────────────────────────────────
// 골든 스냅샷 — 의도치 않은 변경이면 여기가 먼저 깨진다
// ─────────────────────────────────────────────────────────────────────────────

describe('시스템 프롬프트 골든 스냅샷', () => {
  it('tutor 의 시스템 프롬프트가 바뀌지 않았다', async () => {
    const params = await callTutor({ source: 'quiz100', id: '001', userAnswer: 'a', history: [] });
    expect(fingerprint(params.system[0].text)).toEqual(GOLDEN.tutor);
  });

  it('grade 의 시스템 프롬프트가 바뀌지 않았다', async () => {
    const params = await callGrade({ kind: 'short', source: 'quiz100', id: '001', userAnswer: 'a' });
    expect(fingerprint(params.system[0].text)).toEqual(GOLDEN.grade);
  });

  it('plan 의 시스템 프롬프트가 바뀌지 않았다', async () => {
    const params = await callPlan({ snapshot });
    expect(fingerprint(params.system[0].text)).toEqual(GOLDEN.plan);
  });

  it('variants 의 시스템 프롬프트가 source 별로 바뀌지 않았다', () => {
    expect(fingerprint(buildVariantSystem('quiz100')[0].text)).toEqual(GOLDEN.variantsShort);
    expect(fingerprint(buildVariantSystem('bogang')[0].text)).toEqual(GOLDEN.variantsShort);
    expect(fingerprint(buildVariantSystem('codedrill')[0].text)).toEqual(GOLDEN.variantsDrill);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 동작을 좌우하는 문장 — 해시가 "바뀌었다", 여기가 "무엇이 사라졌는지"를 말한다
// ─────────────────────────────────────────────────────────────────────────────

/** 사라지면 모델의 판단이 달라지는 문장들 */
const REQUIRED_CLAUSES = {
  tutor: [
    // 환각 방지 — 교재에 없는 내용을 지어내면 학습자가 틀린 것을 외운다
    '교재에 근거가 없으면 "교재에서 확인되지 않는다"고 말하고 추측하지 않습니다',
    // 출력 형식 — AiExplainPanel 이 마크다운 제목을 기준으로 읽는다
    '## 채점',
    '## 왜 틀렸나',
    '## 핵심 정리',
    '## 함께 볼 것',
  ],
  grade: [
    // 채점 기준의 출처 — 이 문장이 사라지면 모델의 일반 지식으로 채점한다
    '채점 기준은 **요청에 실려 온 "교재의 정답"** 입니다',
    // kind=code 규칙
    '학습자 답안은 프로그램의 **출력값**입니다',
    '공백 개수, 줄바꿈 위치, 앞뒤 여백, 값 사이 구분(공백/줄바꿈/쉼표) 차이는 **틀린 것이 아닙니다.**',
    '값이 하나라도 다르면 correct 가 아닙니다',
    // kind=short 규칙
    '동의어·표기 흔들림은 **허용**합니다',
    '개념이 틀리면 표현이 그럴듯해도 incorrect 입니다',
    '순서가 채점 대상인 문항',
    // verdict ↔ score 대역 (domain/grading.js 의 DEFAULT_SCORE 와 어긋나면 안 된다)
    'correct   : 교재 기준으로 맞다. score 90~100.',
    'partial   : 일부만 맞거나 핵심 일부가 빠졌다. score 40~89.',
    'incorrect : 틀렸거나 채점할 내용이 없다. score 0~39.',
    // confidence 정의 — 0.6 경계는 domain/grading.js 의 CONFIDENCE_THRESHOLD 와 짝이다
    '0.9 이상 :',
    '0.6 ~ 0.9:',
    '0.6 미만 :',
    'confidence 가 낮으면 화면은 자동 채점 대신 학습자의 자기 채점으로 돌아갑니다',
    // missedPoints 상한 — 서버 normalizeGrade 가 5개로 자른다
    '최대 5개',
  ],
  plan: [
    // 도구 사용 지시 — 이 문장이 사라지면 에이전트가 도구 없이 지어낸다
    '먼저 get_due_reviews 와 get_weak_categories 로 학습자의 현재 상태를 확인합니다',
    '계획에 넣을 문항이 실제로 있는지 list_problems 로 확인합니다. 없는 문항 id 를 지어내지 않습니다',
    '교재 구간을 계획에 넣을 때는 search_content 로 실제 섹션을 찾아 근거를 만듭니다',
    '도구 호출은 필요한 만큼만 씁니다. 상한을 넘기면 더 이상 쓸 수 없고',
    // 계획 원칙 — TodayPlanCard 가 이 형태를 전제로 그린다
    '항목 minutes 의 합이 학습자의 availableMinutes 를 넘지 않게 합니다',
    '항목 수는 2~5개로 하고, 한 항목은 15~45분으로 잡습니다',
    'riskFlags',
  ],
  variantsShort: [
    '난이도 — 원본보다 쉬워지거나 어려워지면 안 된다',
    '정답은 **당신이 만든 변형 지문에서 직접 도출**되어야 한다',
    '교재에 없는 용어·수치를 지어내지 않는다',
    '정답이 여러 개로 갈릴 수 있는 지문은 내지 않는다',
  ],
  variantsDrill: [
    '`expectedOutput` 은 **코드를 한 줄씩 직접 추적해 계산한 값**이다',
    '언어는 원본과 같은 언어를 쓴다',
    'SQL 이면 예제 테이블을 `context` 에, 쿼리를 `code` 에 나눠 담는다',
  ],
};

describe('동작을 좌우하는 문장이 프롬프트에 남아 있다', () => {
  const expectAll = (text, clauses) => {
    const missing = clauses.filter((clause) => !text.includes(clause));
    expect(missing).toEqual([]);
  };

  it('tutor: 환각 방지 지시와 출력 형식 제목이 그대로 있다', async () => {
    const params = await callTutor({ source: 'quiz100', id: '001', userAnswer: 'a', history: [] });
    expectAll(params.system[0].text, REQUIRED_CLAUSES.tutor);
  });

  it('grade: kind 별 채점 기준·score 대역·confidence 정의가 그대로 있다', async () => {
    const params = await callGrade({ kind: 'short', source: 'quiz100', id: '001', userAnswer: 'a' });
    expectAll(params.system[0].text, REQUIRED_CLAUSES.grade);
  });

  it('plan: 도구 사용 지시와 계획 원칙이 그대로 있다', async () => {
    const params = await callPlan({ snapshot });
    expectAll(params.system[0].text, REQUIRED_CLAUSES.plan);
  });

  it('variants: 정답 규칙과 드릴 추적 규칙이 그대로 있다', () => {
    expectAll(buildVariantSystem('quiz100')[0].text, REQUIRED_CLAUSES.variantsShort);
    expectAll(buildVariantSystem('codedrill')[0].text, [
      ...REQUIRED_CLAUSES.variantsShort,
      ...REQUIRED_CLAUSES.variantsDrill,
    ]);
    // 단답형 프롬프트에 드릴 규칙이 섞이면 안 된다 (엉뚱한 지시로 캐시도 갈린다)
    for (const clause of REQUIRED_CLAUSES.variantsDrill) {
      expect(buildVariantSystem('quiz100')[0].text).not.toContain(clause);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kind 별 채점 지시가 실제로 갈린다 (가변 메시지 쪽)
// ─────────────────────────────────────────────────────────────────────────────

describe('kind 별 채점 지시', () => {
  const userText = (params) => params.messages.find((m) => m.role === 'user').content;

  it('code 와 short 의 마지막 지시가 서로 다르다', async () => {
    const code = await callGrade({
      kind: 'code',
      source: 'codedrill',
      id: 'C-01',
      userAnswer: '10',
    });
    const short = await callGrade({
      kind: 'short',
      source: 'quiz100',
      id: '001',
      userAnswer: '원자성',
    });

    expect(userText(code)).toContain('이 문항은 코드 트레이싱(kind=code)입니다');
    expect(userText(code)).toContain('공백·줄바꿈 차이는 틀린 것으로 보지 말고 채점하세요');
    expect(userText(short)).toContain('이 문항은 단답형(kind=short)입니다');
    expect(userText(short)).toContain('동의어·표기 흔들림은 정답으로 인정하되');
    expect(userText(code)).not.toContain('kind=short');
    expect(userText(short)).not.toContain('kind=code');
  });

  it('코드 문항은 교재의 기대 출력을 채점 기준으로 함께 싣는다', async () => {
    const params = await callGrade({
      kind: 'code',
      source: 'codedrill',
      id: 'C-01',
      userAnswer: '10',
    });
    expect(userText(params)).toContain('## 교재의 기대 출력');
    expect(userText(params)).toContain('# 교재의 정답 (채점 기준 — 이 내용을 기준으로만 채점한다)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 구조화 출력 스키마 — 프롬프트와 짝을 이루는 계약
// ─────────────────────────────────────────────────────────────────────────────

describe('구조화 출력 스키마 계약', () => {
  it('채점 스키마는 계약된 다섯 필드를 모두 required 로 갖는다', () => {
    expect(Object.keys(grade.GRADE_SCHEMA.properties).sort()).toEqual([
      'confidence',
      'feedback',
      'missedPoints',
      'score',
      'verdict',
    ]);
    expect(grade.GRADE_SCHEMA.required.sort()).toEqual([
      'confidence',
      'feedback',
      'missedPoints',
      'score',
      'verdict',
    ]);
    expect(grade.GRADE_SCHEMA.additionalProperties).toBe(false);
    expect(grade.GRADE_SCHEMA.properties.verdict.enum).toEqual([
      'correct',
      'partial',
      'incorrect',
    ]);
  });

  it('구조화 출력 스키마에 수치 제약을 쓰지 않는다 (지원하지 않는다)', async () => {
    const params = await callGrade({ kind: 'short', source: 'quiz100', id: '001', userAnswer: 'a' });
    const schemas = [
      JSON.stringify(grade.GRADE_SCHEMA),
      JSON.stringify(params.output_config.format.schema),
      JSON.stringify(variantSchema('quiz100')),
      JSON.stringify(variantSchema('codedrill')),
    ];
    for (const json of schemas) {
      expect(json).not.toContain('"minimum"');
      expect(json).not.toContain('"maximum"');
      expect(json).not.toContain('"multipleOf"');
    }
    // 그래서 범위는 description 으로 알린다 — 이 설명이 사라지면 모델이 범위를 모른다
    expect(grade.GRADE_SCHEMA.properties.score.description).toContain('0 이상 100 이하');
    expect(grade.GRADE_SCHEMA.properties.confidence.description).toContain('0.0 ~ 1.0');
  });

  it('구조화 출력 포맷 객체에는 strict 필드가 없다 (도구 쪽 필드다)', async () => {
    const params = await callGrade({ kind: 'short', source: 'quiz100', id: '001', userAnswer: 'a' });
    expect(Object.keys(params.output_config.format).sort()).toEqual(['schema', 'type']);
  });

  it('계획 스키마는 세 항목 종류를 판별자로 나눈다', async () => {
    const params = await callPlan({ snapshot });
    const items = params.output_config.format.schema.properties.items.items;
    expect(items.anyOf.map((entry) => entry.properties.type.const)).toEqual([
      'review_wrong',
      'study_day',
      'drill',
    ]);
    expect(items.anyOf.every((entry) => entry.additionalProperties === false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 플래너 도구 — 프롬프트가 부르는 이름이 실제로 존재해야 한다
// ─────────────────────────────────────────────────────────────────────────────

describe('플래너 도구 계약', () => {
  it('프롬프트가 이름을 부르는 도구는 모두 실제로 등록돼 있다', async () => {
    const params = await callPlan({ snapshot });
    const names = params.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'get_due_reviews',
      'get_section',
      'get_weak_categories',
      'list_problems',
      'search_content',
    ]);

    const systemPrompt = params.system[0].text;
    for (const name of ['get_due_reviews', 'get_weak_categories', 'list_problems', 'search_content']) {
      expect(systemPrompt).toContain(name);
    }
  });

  it('도구는 모두 strict 스키마다 (인자 형태가 흔들리면 서버가 못 읽는다)', async () => {
    const params = await callPlan({ snapshot });
    expect(params.tools.every((tool) => tool.strict === true)).toBe(true);
    expect(
      params.tools.every((tool) => tool.input_schema.additionalProperties === false)
    ).toBe(true);
    // strict 모드는 모든 속성이 required 여야 한다 — 선택 인자는 nullable 로 표현한다
    for (const tool of params.tools) {
      const properties = Object.keys(tool.input_schema.properties ?? {});
      expect([...(tool.input_schema.required ?? [])].sort()).toEqual(properties.sort());
    }
  });

  it('도구 호출 상한을 넘기면 모델에게 "계획을 마무리하라"고 돌려준다', () => {
    const { tools, stats } = createPlannerTools({
      snapshot: { wrongNotes: [], quizResults: {} },
      now: 0,
    });
    const search = tools.find((tool) => tool.name === 'search_content');

    for (let i = 0; i < MAX_TOOL_CALLS; i += 1) search.run({ query: '정규화', limit: null });
    expect(stats.calls).toBe(MAX_TOOL_CALLS);

    const refused = JSON.parse(search.run({ query: '정규화', limit: null }));
    expect(refused.error).toContain(`도구 호출 상한(${MAX_TOOL_CALLS}회)`);
    expect(refused.error).toContain('지금까지 모은 정보만으로 계획을 완성해 주세요');
    expect(stats.refused).toBe(1);
    // 거절은 호출 수를 늘리지 않는다
    expect(stats.calls).toBe(MAX_TOOL_CALLS);
  });
});
