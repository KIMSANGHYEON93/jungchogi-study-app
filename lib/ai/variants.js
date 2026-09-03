// 변형 문제 생성 (블루프린트 §4.4 · §5 Phase 4) 의 **순수 로직**.
//
// 여기에는 SDK 호출이 없다. 원본 문항을 골라 Batch 요청 배열을 만들고, 돌아온 결과를
// `custom_id` 로 되맞춰 생성물 항목으로 바꾸는 일만 한다. SDK 를 부르는 쪽은
// `lib/ai/batchRunner.js`, 파일로 굳히는 쪽은 `lib/ai/generated.js` 다.
// 문항 로드·파싱은 Phase 1 의 `lib/ai/content.js` 를 그대로 쓴다 (규칙을 두 번 쓰지 않는다).
//
// Phase 1~3 에서 실측으로 확인한 규칙을 그대로 따른다:
//   · 모델은 `claude-opus-5`. `thinking` 은 **생략**한다 (Opus 5 기본 adaptive,
//     `budget_tokens` 는 400).
//   · `effort` 는 `output_config` **안에** 넣는다.
//   · 구조화 출력의 포맷 객체는 `{type, schema}` 두 필드뿐이다 — `strict` 는 도구 쪽 필드다.
//   · 구조화 출력은 `minimum`/`maximum`/`multipleOf` 를 지원하지 않는다.
//   · 서버측 폴백(`fallbacks`)은 **Batch API 에서 거부된다** — 넣지 않는다.

import { MODEL } from './client.js';
import { loadSource } from './content.js';

/** 블루프린트 §7-1 의 effort 사다리에서 생성은 채점과 같은 자리(medium)에 둔다. */
export const VARIANT_EFFORT = 'medium';

/**
 * 변형 하나의 출력은 길지 않지만(지문+정답), Opus 5 는 thinking 토큰도 `max_tokens`
 * 를 함께 쓴다. 드릴 변형은 추적표를 쓰게 하므로 여유를 둔다.
 * 절단(`stop_reason: 'max_tokens'`)은 `collectVariantResults` 가 실패로 잡아 보고한다.
 */
export const VARIANT_MAX_TOKENS = 8_000;

/** 기본 변형 개수 (CLI `--variants`) */
export const DEFAULT_VARIANTS = 2;

/** Opus 5 정가 (skill 캐시 2026-06-24 기준, $/1M tokens) */
export const PRICE_INPUT_PER_MTOK = 5;
export const PRICE_OUTPUT_PER_MTOK = 25;
/** Batch API 는 모든 토큰 사용량에 50% 할인 */
export const BATCH_DISCOUNT = 0.5;

/**
 * 문자 수 → 토큰 수 근사.
 *
 * `messages.count_tokens` 를 쓰면 정확하지만 요청 K건마다 네트워크 왕복이 생기고,
 * 여기서 필요한 건 "돌리기 전에 자릿수를 알려주는" 값이다. 한글은 영문·코드보다
 * 토큰당 글자 수가 적으므로 둘을 나눠 센다. **±50% 는 어긋날 수 있는 추정치**이고,
 * 실제 사용량은 배치가 끝난 뒤 결과의 `usage` 로 확인한다.
 */
const HANGUL_CHARS_PER_TOKEN = 1.3;
const OTHER_CHARS_PER_TOKEN = 3.6;

/**
 * source 별 출력 토큰 추정치. **thinking 토큰이 지배적**이라 실제 지문·정답 길이보다
 * 훨씬 크게 잡는다 (Opus 5 는 thinking 이 기본으로 켜져 있고 출력 토큰으로 과금된다).
 */
const OUTPUT_TOKEN_ESTIMATE = {
  quiz100: 1_500,
  bogang: 1_500,
  codedrill: 2_800,
};

/** 드릴이 허용하는 언어 — 파서의 Part 매핑과 같아야 한다 (`src/utils/parseCodeDrill.js`) */
export const ALLOWED_LANGS = ['c', 'java', 'python', 'sql'];

/** 단답형·보강의 변형 스키마. `id`·`category`·`variantOf` 는 코드가 채운다. */
const SHORT_ANSWER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        '변형 문항의 지문. 한국어 한 문장 또는 두 문장. 원본과 글자 그대로 같으면 안 된다.',
    },
    answer: {
      type: 'string',
      description:
        '변형 지문에서 직접 도출한 정답. 원본 정답의 형식·분량을 따른다 ' +
        '(원본이 항목 나열이면 나열로, 용어 하나면 용어 하나로).',
    },
  },
  required: ['question', 'answer'],
  additionalProperties: false,
});

/** 코드트레이싱 드릴의 변형 스키마. `lang` 은 원본 언어로 고정하므로 모델에게 맡기지 않는다. */
const CODE_DRILL_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string', description: '변형 문항의 제목. 무엇을 묻는지 짧게.' },
    context: {
      type: 'string',
      description:
        '코드를 읽기 위해 필요한 예제 테이블이나 조건 지문. 필요 없으면 빈 문자열.',
    },
    code: {
      type: 'string',
      description:
        '문제로 낼 코드 또는 SQL. 코드펜스 표시 없이 본문만. 실행 가능한 완결된 조각이어야 한다.',
    },
    answer: {
      type: 'string',
      description:
        '정답과 풀이. 변수 추적표를 남겨 채점자가 손으로 검산할 수 있게 쓴다.',
    },
    expectedOutput: {
      type: 'string',
      description:
        '코드를 한 줄씩 추적해 계산한 실행 결과. 출력이 없는 유형(빈칸 채우기 등)이면 빈 문자열.',
    },
    pitfall: { type: 'string', description: '이 문항이 노리는 함정 한 줄 요약.' },
  },
  required: ['title', 'context', 'code', 'answer', 'expectedOutput', 'pitfall'],
  additionalProperties: false,
});

const VARIANT_SCHEMAS = {
  quiz100: SHORT_ANSWER_SCHEMA,
  bogang: SHORT_ANSWER_SCHEMA,
  codedrill: CODE_DRILL_SCHEMA,
};

/** 생성기가 다루는 source 목록 */
export const VARIANT_SOURCES = Object.keys(VARIANT_SCHEMAS);

/**
 * source 의 구조화 출력 스키마.
 * @param {string} source
 * @returns {object}
 */
export function variantSchema(source) {
  const schema = VARIANT_SCHEMAS[source];
  if (!schema) throw new Error(`알 수 없는 source: ${source}`);
  return schema;
}

/**
 * 변형 각도 — 변형 번호마다 다른 축으로 비틀게 해서 같은 문항이 여러 벌 나오지 않게 한다.
 * 번호가 목록보다 크면 순환한다.
 */
const SHORT_ANSWER_ANGLES = [
  '같은 개념을 묻되 지문의 예시·상황·수치를 다른 것으로 바꾼다.',
  '묻는 방향을 뒤집는다 — 용어를 주고 뜻을 묻던 것은 뜻을 주고 용어를 묻는 식으로.',
  '혼동하기 쉬운 인접 개념을 함께 제시하고 둘을 구별하도록 묻는다.',
  '실무 상황 한두 줄을 제시하고 그 상황에 해당하는 것을 묻는다.',
  '원본이 항목 나열을 묻는다면 그중 하나의 역할을, 하나를 묻는다면 나열 전체를 묻는다.',
];

const CODE_DRILL_ANGLES = [
  '초기값·상수·반복 횟수를 바꾼다. 제어 흐름 구조와 함정은 그대로 둔다.',
  '같은 함정을 다른 문법으로 드러낸다 (for ↔ while, 배열 첨자 ↔ 포인터 산술, 서브쿼리 ↔ 조인 등).',
  '연산자나 조건을 한 군데 바꿔 결과가 달라지게 한다. 무엇이 달라지는지가 이 문항의 핵심이 된다.',
  '변수나 단계를 하나 더 두어 추적 단계를 한 칸 늘린다. 난이도가 크게 오르면 안 된다.',
  'SQL 이면 예제 테이블의 행과 값을 바꾸고 집계·조인 조건을 비튼다. 코드면 함수 호출을 한 겹 넣는다.',
];

function anglesFor(source) {
  return source === 'codedrill' ? CODE_DRILL_ANGLES : SHORT_ANSWER_ANGLES;
}

const COMMON_RULES = [
  '# 역할',
  '당신은 정보처리기사 실기 문제를 내는 출제자입니다. 주어진 원본 문항 하나를 바탕으로',
  '**변형 문항 하나**를 만듭니다.',
  '',
  '# 같게 유지할 것',
  '- 측정하는 개념과 출제 의도',
  '- 난이도 — 원본보다 쉬워지거나 어려워지면 안 된다',
  '- 답안의 형식과 분량 — 원본이 용어 하나면 변형도 용어 하나, 나열이면 나열',
  '- 언어는 한국어',
  '',
  '# 바꿀 것',
  '- 지문의 표현, 예시, 수치, 변수명, 묻는 각도',
  '',
  '# 정답 규칙 (가장 중요)',
  '- 정답은 **당신이 만든 변형 지문에서 직접 도출**되어야 한다. 원본 정답을 옮겨 붙이지 않는다.',
  '- 지문을 바꿨는데 정답이 원본과 같다면 지문을 잘못 바꾼 것이다. 다시 만든다.',
  '- 확신이 서지 않는 사실은 쓰지 않는다. 교재에 없는 용어·수치를 지어내지 않는다.',
  '- 원본과 글자 그대로 같은 문항을 내지 않는다.',
  '- 정답이 여러 개로 갈릴 수 있는 지문은 내지 않는다. 답이 하나로 정해지게 쓴다.',
];

const CODE_DRILL_RULES = [
  '',
  '# 코드 문항 규칙',
  '- 코드는 그대로 컴파일·실행되는 완결된 조각이어야 한다 (필요한 선언·import 를 빠뜨리지 않는다).',
  '- `expectedOutput` 은 **코드를 한 줄씩 직접 추적해 계산한 값**이다. 추측해서 쓰지 않는다.',
  '- `answer` 에는 그 추적 과정(변수 추적표)을 남겨 채점자가 손으로 검산할 수 있게 한다.',
  '- 언어는 원본과 같은 언어를 쓴다.',
  '- SQL 이면 예제 테이블을 `context` 에, 쿼리를 `code` 에 나눠 담는다.',
  '  예제 테이블이 필요 없으면 `context` 는 빈 문자열로 둔다.',
];

/**
 * source 의 시스템 프롬프트 블록.
 *
 * 배치 안의 모든 요청이 **글자 그대로 같은** 프리픽스를 쓰도록 상수만으로 만든다
 * (날짜·난수가 섞이면 캐시가 적중하지 않는다). 캐시 브레이크포인트를 여기 건다.
 * @param {string} source
 * @returns {Array<object>}
 */
export function buildVariantSystem(source) {
  const lines = source === 'codedrill' ? [...COMMON_RULES, ...CODE_DRILL_RULES] : COMMON_RULES;
  return [{ type: 'text', text: lines.join('\n'), cache_control: { type: 'ephemeral' } }];
}

const fenced = (lang, body) => ['```' + lang, body, '```'].join('\n');

/**
 * 원본 문항 하나 + 변형 지시로 사용자 메시지를 만든다.
 * @param {{source: string, problem: object, variant: number, total: number}} args
 * @returns {string}
 */
export function buildVariantPrompt({ source, problem, variant, total }) {
  const angles = anglesFor(source);
  const angle = angles[(variant - 1) % angles.length];
  const lines = [`## 원본 문항 (source: ${source}, id: ${problem.id})`];

  if (source === 'codedrill') {
    lines.push(
      `언어: ${problem.lang ?? ''}`,
      '',
      '### 제목',
      problem.title ?? '',
      '',
      '### 예제 테이블·조건 지문',
      problem.context?.trim() ? fenced('', problem.context) : '(없음)',
      '',
      '### 문제 코드',
      fenced(problem.lang ?? '', problem.code ?? ''),
      '',
      '### 교재 정답·풀이',
      problem.answer ?? '',
      '',
      '### 기대 출력',
      problem.expectedOutput?.trim() ? problem.expectedOutput : '(없음)',
      '',
      '### 함정',
      problem.pitfall?.trim() ? problem.pitfall : '(없음)'
    );
  } else {
    lines.push(
      `카테고리: ${problem.category ?? ''}`,
      '',
      '### 지문',
      problem.question ?? '',
      '',
      '### 교재 정답',
      problem.answer ?? ''
    );
  }

  lines.push(
    '',
    `## 이번 변형 (${total}개 중 ${variant}번째)`,
    `변형 각도: ${angle}`,
    '',
    '위 각도로 원본을 비틀어 변형 문항 하나를 만드세요.'
  );

  return lines.join('\n');
}

const CUSTOM_ID_PATTERN = /^([a-z0-9]+)__(.+)__v(\d+)$/;

/**
 * Batch 결과는 **요청 순서를 보장하지 않는다.** 위치가 아니라 이 키로 되맞춘다.
 * @param {{source: string, id: string, variant: number}} args
 * @returns {string}
 */
export function formatCustomId({ source, id, variant }) {
  return `${source}__${id}__v${variant}`;
}

/**
 * @param {string} customId
 * @returns {{source: string, id: string, variant: number}|null} 형식이 아니면 null
 */
export function parseCustomId(customId) {
  const match = typeof customId === 'string' ? customId.match(CUSTOM_ID_PATTERN) : null;
  if (!match) return null;
  return { source: match[1], id: match[2], variant: Number(match[3]) };
}

/**
 * 변형을 만들 원본 문항을 고른다.
 *
 * `ids` 를 주면 **준 순서**를 지키고, 없는 id 가 하나라도 섞이면 던진다 —
 * 조용히 건너뛰면 "10개 달라고 했는데 8개가 나온" 이유를 나중에 못 찾는다.
 * 걸리는 문항이 0건이어도 던진다 (빈 배치를 만들 이유가 없다).
 *
 * 드릴에는 `category` 필드가 없어 언어(`lang`)를 카테고리로 쓴다 —
 * `listProblemMeta` 와 같은 규칙이다.
 *
 * @param {{source: string, ids?: string[]|null, category?: string|null}} args
 * @returns {Array<object>} 파서 출력 그대로
 */
export function selectProblems({ source, ids, category }) {
  variantSchema(source); // 알 수 없는 source 면 여기서 던진다

  const items = loadSource(source);
  if (items.length === 0) {
    throw new Error(`${source} 문항을 읽지 못했습니다. public/data 를 확인하세요.`);
  }

  let selected = items;

  if (Array.isArray(ids) && ids.length > 0) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new Error(`${source} 에 없는 id 입니다: ${missing.join(', ')}`);
    }
    selected = ids.map((id) => byId.get(id));
  }

  const wanted = typeof category === 'string' ? category.trim() : '';
  if (wanted) {
    selected = selected.filter(
      (item) => (item.category ?? item.lang ?? '').toLowerCase() === wanted.toLowerCase()
    );
  }

  if (selected.length === 0) {
    throw new Error(`조건에 걸리는 ${source} 문항이 없습니다 (category: ${category}).`);
  }
  return selected;
}

/**
 * Batch 요청 배열을 만든다 — 문항 N개 × 변형 M개 = 요청 N×M 건.
 * @param {{source: string, problems: Array<object>, variantsPerItem?: number}} args
 * @returns {Array<{custom_id: string, params: object}>}
 */
export function buildVariantRequests({ source, problems, variantsPerItem = DEFAULT_VARIANTS }) {
  const schema = variantSchema(source); // 알 수 없는 source 면 여기서 던진다

  const count = Number(variantsPerItem);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`variantsPerItem 은 1 이상의 정수여야 합니다: ${variantsPerItem}`);
  }

  const system = buildVariantSystem(source);
  const requests = [];

  for (const problem of problems) {
    for (let variant = 1; variant <= count; variant += 1) {
      requests.push({
        custom_id: formatCustomId({ source, id: problem.id, variant }),
        params: {
          model: MODEL,
          max_tokens: VARIANT_MAX_TOKENS,
          output_config: {
            effort: VARIANT_EFFORT,
            format: { type: 'json_schema', schema },
          },
          system,
          messages: [
            {
              role: 'user',
              content: buildVariantPrompt({ source, problem, variant, total: count }),
            },
          ],
        },
      });
    }
  }

  return requests;
}

/**
 * 문자 수로 토큰 수를 어림한다 (위 상수 주석 참조 — 추정치다).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const value = String(text ?? '');
  const hangul = (value.match(/[가-힣㄰-㆏]/g) ?? []).length;
  const other = value.length - hangul;
  return Math.ceil(hangul / HANGUL_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN);
}

/**
 * @typedef {object} CostEstimate
 * @property {number} requestCount 보낼 요청 건수
 * @property {number} inputTokens  추정 입력 토큰 합
 * @property {number} outputTokens 추정 출력 토큰 합 (thinking 포함)
 * @property {number} usd          Batch 50% 할인 반영 추정 비용
 */

/**
 * 돌리기 전에 자릿수를 알려주기 위한 비용 추정.
 * @param {Array<{custom_id: string, params: object}>} requests
 * @returns {CostEstimate}
 */
export function estimateVariantCost(requests) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const request of requests) {
    const system = (request.params.system ?? []).map((block) => block.text ?? '').join('\n');
    const user = (request.params.messages ?? []).map((message) => message.content).join('\n');
    inputTokens += estimateTokens(system) + estimateTokens(user);

    const parsed = parseCustomId(request.custom_id);
    outputTokens += OUTPUT_TOKEN_ESTIMATE[parsed?.source] ?? OUTPUT_TOKEN_ESTIMATE.quiz100;
  }

  const listUsd =
    (inputTokens * PRICE_INPUT_PER_MTOK + outputTokens * PRICE_OUTPUT_PER_MTOK) / 1_000_000;

  return {
    requestCount: requests.length,
    inputTokens,
    outputTokens,
    usd: listUsd * BATCH_DISCOUNT,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 수거
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모델이 채워야 하고 **비어 있으면 안 되는** 필드.
 *
 * 드릴의 `context`·`expectedOutput`·`pitfall` 은 원본에도 비어 있는 문항이 있으므로
 * (예제 테이블이 없는 코드 문항, 출력이 없는 DDL 문항) 여기 넣지 않는다.
 */
const REQUIRED_NONEMPTY = {
  quiz100: ['question', 'answer'],
  bogang: ['question', 'answer'],
  codedrill: ['title', 'code', 'answer'],
};

const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * 생성물 항목의 id — 원본과 충돌하지 않아야 한다 (`042` → `042-v1`).
 * @param {string} originalId
 * @param {number} variant
 * @returns {string}
 */
export function variantId(originalId, variant) {
  return `${originalId}-v${variant}`;
}

/**
 * 모델 출력 + 원본 → 생성물 항목.
 *
 * **기존 파서 출력과 같은 shape** 에 `variantOf`·`generated` 두 필드만 더한다
 * (블루프린트 §4.4 의 고정 계약). `category`·`lang` 은 원본에서 가져온다 —
 * 모델이 지어내면 화면의 분류가 조용히 어긋난다.
 * @param {{source: string, original: object, output: object, variant: number}} args
 * @returns {object}
 */
export function variantItemFromOutput({ source, original, output, variant }) {
  const id = variantId(original.id, variant);

  if (source === 'codedrill') {
    return {
      id,
      title: output.title,
      context: output.context ?? '',
      code: output.code,
      lang: original.lang,
      answer: output.answer,
      expectedOutput: output.expectedOutput ?? '',
      pitfall: output.pitfall ?? '',
      variantOf: original.id,
      generated: true,
    };
  }

  return {
    id,
    question: output.question,
    answer: output.answer,
    category: original.category,
    variantOf: original.id,
    generated: true,
  };
}

/** 메시지 content 에서 첫 text 블록의 본문 */
function textOf(message) {
  const block = (message?.content ?? []).find((entry) => entry?.type === 'text');
  return block?.text ?? '';
}

/** errored 결과의 사람이 읽을 메시지 (SDK ErrorResponse 는 중첩돼 있다) */
function errorMessageOf(result) {
  const error = result?.error;
  return error?.error?.message ?? error?.message ?? JSON.stringify(error ?? {});
}

/**
 * @typedef {object} VariantFailure
 * @property {string} customId
 * @property {string|null} id 원본 문항 id (custom_id 를 읽을 수 있었을 때)
 * @property {number|null} variant
 * @property {'errored'|'canceled'|'expired'|'truncated'|'refusal'|'invalid'|'unknown'} type
 * @property {string} message
 */

/**
 * Batch 결과 스트림을 생성물 항목으로 바꾼다.
 *
 * - 결과는 **요청 순서를 보장하지 않으므로** `custom_id` 로만 되맞춘다.
 * - 한 건이 실패해도 나머지는 살린다 (24시간짜리 배치를 부분 실패 하나로 버릴 수 없다).
 * - 실패는 조용히 삼키지 않고 전부 `failures` 로 돌려준다.
 *
 * @param {{results: AsyncIterable<object>|Iterable<object>, source: string,
 *          originals: Array<object>}} args
 * @returns {Promise<{items: Array<object>, failures: VariantFailure[],
 *                    usage: {inputTokens: number, outputTokens: number,
 *                            cacheReadInputTokens: number}}>}
 */
export async function collectVariantResults({ results, source, originals }) {
  const required = REQUIRED_NONEMPTY[source];
  if (!required) throw new Error(`알 수 없는 source: ${source}`);

  const byId = new Map(originals.map((item) => [item.id, item]));
  const order = new Map(originals.map((item, index) => [item.id, index]));

  const collected = [];
  const failures = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };

  const fail = (customId, parsed, type, message) => {
    failures.push({
      customId,
      id: parsed?.id ?? null,
      variant: parsed?.variant ?? null,
      type,
      message,
    });
  };

  for await (const row of results) {
    const customId = row?.custom_id;
    const parsed = parseCustomId(customId);
    const original = parsed ? byId.get(parsed.id) : undefined;

    if (!parsed || parsed.source !== source || !original) {
      fail(customId, parsed, 'unknown', '이 배치의 원본 문항과 맞는 custom_id 가 아닙니다.');
      continue;
    }

    const type = row?.result?.type;
    if (type !== 'succeeded') {
      const message =
        type === 'errored'
          ? errorMessageOf(row.result)
          : type === 'expired'
            ? '24시간 안에 처리되지 않아 만료되었습니다. 다시 제출해야 합니다.'
            : type === 'canceled'
              ? '배치가 취소되었습니다.'
              : `알 수 없는 결과 종류: ${type}`;
      fail(customId, parsed, type === 'canceled' || type === 'expired' || type === 'errored' ? type : 'unknown', message);
      continue;
    }

    const message = row.result.message;
    usage.inputTokens += message?.usage?.input_tokens ?? 0;
    usage.outputTokens += message?.usage?.output_tokens ?? 0;
    usage.cacheReadInputTokens += message?.usage?.cache_read_input_tokens ?? 0;

    if (message?.stop_reason === 'max_tokens') {
      fail(customId, parsed, 'truncated', 'max_tokens 에 걸려 응답이 잘렸습니다.');
      continue;
    }
    if (message?.stop_reason === 'refusal') {
      fail(customId, parsed, 'refusal', '모델이 요청을 거절했습니다.');
      continue;
    }

    let output;
    try {
      output = JSON.parse(textOf(message));
    } catch {
      fail(customId, parsed, 'invalid', '응답이 JSON 이 아닙니다.');
      continue;
    }

    const missing = required.filter((field) => !isFilled(output?.[field]));
    if (missing.length > 0) {
      fail(customId, parsed, 'invalid', `필수 필드가 비었습니다: ${missing.join(', ')}`);
      continue;
    }

    collected.push({
      sortKey: [order.get(parsed.id) ?? Number.MAX_SAFE_INTEGER, parsed.variant],
      item: variantItemFromOutput({ source, original, output, variant: parsed.variant }),
    });
  }

  collected.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1]);

  return { items: collected.map((entry) => entry.item), failures, usage };
}
