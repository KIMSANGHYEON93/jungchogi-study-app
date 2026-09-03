// 플래너 에이전트 도구 5종 (블루프린트 §4.3).
//
// 도구는 SDK Tool Runner 가 실행한다. 그래서 각 도구는
//   - `name` / `description` / `input_schema` (모델이 읽는 계약)
//   - `run(input)` → 문자열 (도구 결과)
// 를 갖는다. 여기서는 SDK 없이 `run` 을 직접 불러 동작을 고정한다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createPlannerTools, MAX_TOOL_CALLS } from '../lib/ai/tools/index.js';
import { clearContentCache } from '../lib/ai/content.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-02T15:00:00.000Z').getTime();

const baseSnapshot = () => ({
  examDate: '2026-10-18',
  wrongNotes: [
    // 데이터베이스 2문항 중 1문항이 오답 (mastered 아님)
    { source: 'quiz100', id: '001', question: '', category: '', reviewCount: 0, mastered: false, addedAt: NOW - 10 * DAY, lastReviewed: 0 },
    // 소프트웨어공학 1문항 오답, 이미 마스터 → 약점 계산에서 오답으로 세지 않는다
    { source: 'quiz100', id: '026', question: '', category: '', reviewCount: 3, mastered: true, addedAt: NOW - 40 * DAY, lastReviewed: NOW - 30 * DAY },
    // 아직 복습 시기가 아닌 오답
    { source: 'codedrill', id: 'C-01', question: '', category: '', reviewCount: 0, mastered: false, addedAt: 0, lastReviewed: NOW - 0.5 * DAY },
  ],
  quizResults: { '002': 'answered', 'S-01': 'answered' },
  studyTime: { '2026-09-01': 90 },
  dayChecks: { 1: true },
  availableMinutes: 90,
});

/** 도구 이름 → 도구 객체 */
function toolMap(tools) {
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

function setup(overrides = {}) {
  const events = [];
  const { tools, stats } = createPlannerTools({
    snapshot: baseSnapshot(),
    now: NOW,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { tools: toolMap(tools), list: tools, stats, events };
}

/** 도구 결과 문자열을 JSON 으로 되돌린다 */
const parse = (text) => JSON.parse(text);

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

describe('도구 정의', () => {
  it('블루프린트 §4.3 의 5종을 그 이름 그대로 만든다', () => {
    const { list } = setup();

    expect(list.map((t) => t.name)).toEqual([
      'search_content',
      'get_section',
      'list_problems',
      'get_weak_categories',
      'get_due_reviews',
    ]);
  });

  it('모든 도구가 strict 스키마를 갖는다', () => {
    const { list } = setup();

    for (const tool of list) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.run).toBe('function');
    }
  });

  it('strict 스키마의 모든 속성이 required 에 들어 있다 (선택 인자는 null 허용으로 표현)', () => {
    const { list } = setup();

    for (const tool of list) {
      const properties = Object.keys(tool.input_schema.properties ?? {});
      expect([...tool.input_schema.required].sort()).toEqual(properties.sort());
    }
  });
});

describe('search_content', () => {
  it('질의와 관련된 섹션 목록을 돌려준다', () => {
    const { tools } = setup();
    const result = parse(tools.search_content.run({ query: '정규화 단계', limit: 2 }));

    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.length).toBeLessThanOrEqual(2);
    expect(Object.keys(result.sections[0]).sort()).toEqual(['excerpt', 'file', 'heading']);
    expect(result.sections[0].heading).toContain('정규화');
  });

  it('limit 이 null 이면 기본값을 쓰고, 범위를 벗어나면 조인다', () => {
    const { tools } = setup();

    expect(parse(tools.search_content.run({ query: '정규화', limit: null })).sections.length)
      .toBeLessThanOrEqual(3);
    expect(parse(tools.search_content.run({ query: '정규화', limit: 999 })).sections.length)
      .toBeLessThanOrEqual(8);
  });

  it('맞는 섹션이 없으면 빈 목록', () => {
    const { tools } = setup();

    expect(parse(tools.search_content.run({ query: 'ZZZ존재하지않는용어', limit: 3 })).sections)
      .toEqual([]);
  });

  it('빈 질의는 오류 결과를 돌려준다 (예외를 던지지 않는다)', () => {
    const { tools, events } = setup();
    const result = parse(tools.search_content.run({ query: '   ', limit: 3 }));

    expect(result.error).toBeTruthy();
    expect(events.at(-1)).toEqual({ phase: 'tool_result', tool: 'search_content', ok: false });
  });
});

describe('get_section', () => {
  it('섹션 본문 전체를 돌려준다', () => {
    const { tools } = setup();
    const result = parse(
      tools.get_section.run({ file: '정처기_Day06_소프트웨어공학.md', heading: '3-1. 정규화 단계' })
    );

    expect(result.body).toContain('BCNF');
    expect(result.file).toBe('정처기_Day06_소프트웨어공학.md');
  });

  it('없는 섹션은 오류 결과', () => {
    const { tools } = setup();
    const result = parse(tools.get_section.run({ file: '없는파일.md', heading: '무엇이든' }));

    expect(result.error).toBeTruthy();
  });
});

describe('list_problems', () => {
  it('문항 메타를 돌려준다', () => {
    const { tools } = setup();
    const result = parse(tools.list_problems.run({ source: 'quiz100', category: null, ids: null }));

    expect(result.problems.map((p) => p.id)).toEqual(['001', '002', '026']);
  });

  it('정답을 절대 흘리지 않는다', () => {
    const { tools } = setup();

    for (const source of ['quiz100', 'codedrill', 'bogang']) {
      const text = tools.list_problems.run({ source, category: null, ids: null });

      expect(text).not.toContain('추적표');
      expect(text).not.toContain('Atomicity');
      expect(text).not.toContain('answer');
      expect(text).not.toContain('expectedOutput');
      expect(text).not.toContain('pitfall');
      for (const problem of parse(text).problems) {
        expect(Object.keys(problem).sort()).toEqual(['category', 'id', 'lang', 'source', 'title']);
      }
    }
  });

  it('category 와 ids 로 거른다', () => {
    const { tools } = setup();

    expect(
      parse(tools.list_problems.run({ source: 'quiz100', category: '데이터베이스', ids: null }))
        .problems.map((p) => p.id)
    ).toEqual(['001', '002']);

    expect(
      parse(tools.list_problems.run({ source: 'quiz100', category: null, ids: ['026'] }))
        .problems.map((p) => p.id)
    ).toEqual(['026']);
  });

  it('화이트리스트 밖 source 는 오류 결과', () => {
    const { tools } = setup();
    const result = parse(tools.list_problems.run({ source: '../secrets', category: null, ids: null }));

    expect(result.error).toBeTruthy();
  });

  it('ids 가 너무 많으면 앞에서부터 잘라 쓴다', () => {
    const { tools } = setup();
    const many = Array.from({ length: 200 }, (_, i) => String(i).padStart(3, '0'));
    const result = parse(tools.list_problems.run({ source: 'quiz100', category: null, ids: many }));

    expect(result.truncated).toBe(true);
  });
});

describe('get_weak_categories', () => {
  it('카테고리별 정답률을 스냅샷에서 계산한다', () => {
    const { tools } = setup();
    const result = parse(tools.get_weak_categories.run({}));
    const byName = Object.fromEntries(result.categories.map((c) => [c.category, c]));

    // 데이터베이스: 001(오답) + 002(quizResults) → 시도 2, 오답 1
    expect(byName['데이터베이스']).toEqual({
      category: '데이터베이스',
      attempted: 2,
      wrong: 1,
      accuracy: 0.5,
    });
    // 소프트웨어공학: 026 은 오답노트에 있지만 mastered → 시도 1, 오답 0
    expect(byName['소프트웨어공학']).toEqual({
      category: '소프트웨어공학',
      attempted: 1,
      wrong: 0,
      accuracy: 1,
    });
    // 드릴은 언어를 카테고리로 쓴다: C-01(오답) → c, S-01(quizResults) → sql
    expect(byName['c']).toMatchObject({ attempted: 1, wrong: 1, accuracy: 0 });
    expect(byName['sql']).toMatchObject({ attempted: 1, wrong: 0, accuracy: 1 });
  });

  it('정답률이 낮은 순으로 정렬한다 (같으면 이름순 — 결정적)', () => {
    const { tools } = setup();
    const result = parse(tools.get_weak_categories.run({}));
    const accuracies = result.categories.map((c) => c.accuracy);

    expect(accuracies).toEqual([...accuracies].sort((a, b) => a - b));
    expect(result.categories[0].category).toBe('c');
  });

  it('스냅샷이 비어 있으면 빈 목록', () => {
    const { tools } = setup({
      snapshot: { examDate: null, wrongNotes: [], quizResults: {}, studyTime: {}, dayChecks: {}, availableMinutes: 60 },
    });

    expect(parse(tools.get_weak_categories.run({})).categories).toEqual([]);
  });

  it('교재에 없는 id 는 무시한다', () => {
    const { tools } = setup({
      snapshot: { ...baseSnapshot(), quizResults: { '999': 'answered' } },
    });
    const names = parse(tools.get_weak_categories.run({})).categories.map((c) => c.category);

    expect(names).not.toContain('999');
  });
});

describe('get_due_reviews', () => {
  it('간격 반복 규칙으로 대기 목록을 만든다', () => {
    const { tools } = setup();
    const result = parse(tools.get_due_reviews.run({}));

    // 001: 10일 전 등록·미복습(reviewCount 0 → 1일) → 대기
    // 026: mastered → 제외
    // C-01: 0.5일 전 복습(reviewCount 0 → 1일) → 아직
    expect(result.due.map((d) => d.id)).toEqual(['001']);
  });

  it('대기 항목에 교재 메타를 붙이되 정답은 붙이지 않는다', () => {
    const { tools } = setup();
    const [item] = parse(tools.get_due_reviews.run({})).due;

    expect(item).toEqual({
      source: 'quiz100',
      id: '001',
      title: '트랜잭션의 4가지 특성(ACID)을 쓰시오.',
      category: '데이터베이스',
      reviewCount: 0,
      daysSince: 10,
    });
  });

  it('대기가 없으면 빈 목록', () => {
    const { tools } = setup({
      snapshot: { ...baseSnapshot(), wrongNotes: [] },
    });

    expect(parse(tools.get_due_reviews.run({})).due).toEqual([]);
  });
});

describe('진행 이벤트와 호출 상한', () => {
  it('호출마다 tool / tool_result 이벤트를 낸다', () => {
    const { tools, events } = setup();
    tools.get_due_reviews.run({});

    expect(events).toEqual([
      { phase: 'tool', tool: 'get_due_reviews', input: {} },
      { phase: 'tool_result', tool: 'get_due_reviews', ok: true },
    ]);
  });

  it('상한은 12회다', () => {
    expect(MAX_TOOL_CALLS).toBe(12);
  });

  it('상한을 넘으면 실행하지 않고 "그만 쓰라"는 결과를 돌려준다', () => {
    const { tools, stats } = setup();

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      const result = parse(tools.get_due_reviews.run({}));
      expect(result.error).toBeUndefined();
    }
    expect(stats.calls).toBe(MAX_TOOL_CALLS);

    const overflow = parse(tools.get_due_reviews.run({}));
    expect(overflow.error).toContain('상한');
    expect(stats.calls).toBe(MAX_TOOL_CALLS);
    expect(stats.refused).toBe(1);
  });

  it('상한 초과는 도구 종류와 무관하게 합산한다', () => {
    const { tools, stats } = setup();

    for (let i = 0; i < MAX_TOOL_CALLS; i++) tools.get_weak_categories.run({});
    const overflow = parse(tools.search_content.run({ query: '정규화', limit: 3 }));

    expect(overflow.error).toContain('상한');
    expect(stats.calls).toBe(MAX_TOOL_CALLS);
  });

  it('도구가 던져도 예외가 새어 나가지 않고 오류 결과가 된다', () => {
    const { tools, events } = setup();
    // 스키마가 막지 못한 형태(문자열 대신 객체)를 흘려 넣는다
    const result = parse(tools.get_section.run({ file: { evil: true }, heading: 42 }));

    expect(result.error).toBeTruthy();
    expect(events.at(-1).ok).toBe(false);
  });
});
