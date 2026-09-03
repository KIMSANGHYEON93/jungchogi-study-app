// 플래너 에이전트 도구 5종을 SDK Tool Runner 가 쓸 수 있는 형태로 조립한다.
//
// SDK 헬퍼(`betaTool`)는 `{type:'custom', name, description, input_schema, run, parse}` 를 만든다.
// 여기에 두 가지를 덧붙인다:
//   - `strict: true` — 도구 인자가 스키마를 정확히 지키게 한다 (헬퍼가 받지 않는 필드라 뒤에 얹는다)
//   - 실행 래퍼 — 진행 이벤트 발행 · 호출 상한 · 예외 흡수
//
// **strict 스키마와 선택 인자**: strict 모드는 `additionalProperties:false` 와 `required` 를
// 요구한다. "모든 속성을 required 에 넣되 선택 인자는 null 을 허용" 하는 형태로 쓰면
// 어떤 해석에서도 유효하다. 그래서 `category?` 는 `anyOf: [string, null]` + required 다.

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';

import { runSearchContent, runGetSection, runListProblems, MAX_SEARCH_LIMIT } from './contentTools.js';
import { runGetWeakCategories, runGetDueReviews } from './snapshotTools.js';

/** 한 요청에서 허용하는 도구 호출 총량 (블루프린트 §4.3) */
export const MAX_TOOL_CALLS = 12;

/** 선택 인자를 strict 스키마로 쓰기 위한 "타입 또는 null" */
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

/**
 * @typedef {object} PlannerToolEvent
 * @property {'tool'|'tool_result'} phase
 * @property {string} tool
 * @property {object} [input]  phase='tool' 일 때
 * @property {boolean} [ok]    phase='tool_result' 일 때
 */

/**
 * 플래너 도구 5종을 만든다.
 *
 * @param {object} args
 * @param {object} args.snapshot 검증을 통과한 스냅샷 (`validatePlanBody` 의 결과)
 * @param {number} args.now 기준 시각 (`Date.now()`) — 요청당 한 번만 읽어 판정이 흔들리지 않게
 * @param {(event: PlannerToolEvent) => void} [args.onEvent] 진행 이벤트 (SSE 프레임으로 나간다)
 * @returns {{tools: Array<object>, stats: {calls: number, refused: number}}}
 */
export function createPlannerTools({ snapshot, now, onEvent }) {
  const stats = { calls: 0, refused: 0 };
  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };

  /**
   * 도구 하나를 실행 래퍼로 감싼다.
   * 결과는 언제나 JSON 문자열이다 — 실패해도 예외를 던지지 않고 `{error}` 를 돌려주어
   * 모델이 다른 방법을 시도할 수 있게 한다 (루프가 죽는 것보다 낫다).
   */
  const wrap = (name, handler) => (input) => {
    const safeInput = input && typeof input === 'object' ? input : {};
    emit({ phase: 'tool', tool: name, input: safeInput });

    if (stats.calls >= MAX_TOOL_CALLS) {
      stats.refused += 1;
      emit({ phase: 'tool_result', tool: name, ok: false });
      return JSON.stringify({
        error: `도구 호출 상한(${MAX_TOOL_CALLS}회)에 도달했습니다. 더 이상 도구를 쓸 수 없습니다. 지금까지 모은 정보만으로 계획을 완성해 주세요.`,
      });
    }
    stats.calls += 1;

    let result;
    try {
      result = handler(safeInput);
    } catch (error) {
      console.error(`[ai/plan] 도구 ${name} 실행 실패`, error);
      result = { error: `${name} 실행 중 오류가 발생했습니다.` };
    }

    emit({ phase: 'tool_result', tool: name, ok: !result?.error });
    return JSON.stringify(result);
  };

  const tools = [
    {
      ...betaTool({
        name: 'search_content',
        description:
          '교재(Day01~14 · 합격전략)에서 질의와 관련된 섹션을 찾는다. 개념 이름이나 짧은 구절을 주면 관련 섹션의 file·heading·발췌를 돌려준다. 본문 전체가 필요하면 결과의 file·heading 을 get_section 에 그대로 넘긴다.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '찾을 개념·구절 (예: "결합도 응집도")' },
            limit: nullable({
              type: 'integer',
              description: `돌려받을 섹션 수 (1~${MAX_SEARCH_LIMIT}, 기본 3). 모르면 null.`,
            }),
          },
          required: ['query', 'limit'],
          additionalProperties: false,
        },
        run: wrap('search_content', runSearchContent),
      }),
      strict: true,
    },
    {
      ...betaTool({
        name: 'get_section',
        description:
          '교재 섹션의 본문을 읽는다. file 과 heading 은 search_content 결과의 값을 그대로 쓴다.',
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '교재 파일명 (예: "정처기_Day06_소프트웨어공학.md")' },
            heading: { type: 'string', description: '섹션 헤딩 (예: "3-1. 정규화 단계")' },
          },
          required: ['file', 'heading'],
          additionalProperties: false,
        },
        run: wrap('get_section', runGetSection),
      }),
      strict: true,
    },
    {
      ...betaTool({
        name: 'list_problems',
        description:
          '문항 목록을 본다. 정답은 돌려주지 않는다 — 계획을 세우는 데 정답은 필요 없다. source 는 quiz100(단답형 100선) · codedrill(코드트레이싱 드릴) · bogang(보강 암기 119선). codedrill 은 언어(c·java·python·sql)를 카테고리로 쓴다.',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['quiz100', 'codedrill', 'bogang'],
              description: '문항 출처',
            },
            category: nullable({ type: 'string', description: '카테고리로 거를 때. 전체면 null.' }),
            ids: nullable({
              type: 'array',
              items: { type: 'string' },
              description: '특정 문항만 볼 때의 id 목록. 전체면 null.',
            }),
          },
          required: ['source', 'category', 'ids'],
          additionalProperties: false,
        },
        run: wrap('list_problems', runListProblems),
      }),
      strict: true,
    },
    {
      ...betaTool({
        name: 'get_weak_categories',
        description:
          '학습자의 카테고리별 정답률을 낮은 순으로 돌려준다. 오답노트와 퀴즈 기록에서 계산한 값이며, 어떤 영역을 먼저 다룰지 정할 때 쓴다.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        run: wrap('get_weak_categories', () => runGetWeakCategories(snapshot)),
      }),
      strict: true,
    },
    {
      ...betaTool({
        name: 'get_due_reviews',
        description:
          '간격 반복(1·3·7일) 규칙으로 오늘 복습해야 할 오답 목록을 돌려준다. daysSince 가 클수록 오래 밀린 항목이다.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        run: wrap('get_due_reviews', () => runGetDueReviews(snapshot, now)),
      }),
      strict: true,
    },
  ];

  return { tools, stats };
}
