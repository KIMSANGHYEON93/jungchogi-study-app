// Anthropic SDK 클라이언트 초기화와 업스트림 오류 분류.
//
// 자격증명은 하드코딩하지 않는다. 인자 없이 만든 `new Anthropic()` 이
// `ANTHROPIC_API_KEY` 환경변수에서 키를 읽는다.

import Anthropic from '@anthropic-ai/sdk';

/** 모델 ID — 날짜 접미사를 붙이지 않는다 (그런 변형은 존재하지 않는다). */
export const MODEL = 'claude-opus-5';

/**
 * 서버측 폴백 (정책 거절 시 대체 모델로 자동 재실행).
 *
 * ⚠️ 이 리포에는 API 키가 없어 **실제 호출로 검증하지 못했다.**
 * 라이브 스모크 테스트(README 의 "라이브 검증" 절)에서 400 이 나면
 * 이 상수를 `false` 로 내리면 된다 — 나머지 요청 파라미터는 그대로 쓸 수 있다.
 */
export const USE_SERVER_FALLBACK = true;
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * 해설은 "문항 하나에 대한 짧은 설명"이라 길 이유가 없다.
 * 낮게 잡아 (1) 비용 상한을 두고 (2) Vercel 함수 실행 시간 안에 확실히 끝나게 한다.
 * 잘림이 관측되면 여기부터 올린다.
 */
export const TUTOR_MAX_TOKENS = 4000;

/** 블루프린트 §7-1: 해설은 low, 채점 medium, 플래너 high */
export const TUTOR_EFFORT = 'low';

/** 플래너는 도구 결과를 여러 번 읽고 계획을 쓴다 (블루프린트 §4.3) */
export const PLAN_MAX_TOKENS = 16_000;
export const PLAN_EFFORT = 'high';

/**
 * Tool Runner 의 반복(API 요청) 상한.
 *
 * 도구 **호출** 상한 12회는 `lib/ai/tools/index.js` 가 직접 센다 — 한 턴에 여러 도구를
 * 병렬로 부를 수 있어 "반복 수 = 호출 수" 가 아니기 때문이다. 여기 값은 그 위에
 * 덧씌우는 안전망이다: 호출이 거절된 뒤에도 모델이 계속 도구를 부르며 맴돌면
 * 여기서 끊는다. 12(호출) + 1(최종 응답) + 3(여유) = 16.
 */
export const PLAN_MAX_ITERATIONS = 16;

let client = null;

/** 테스트·재기동용 — 캐시된 클라이언트를 버린다. */
export function resetClient() {
  client = null;
}

/** 환경에 API 키가 있는지 (요청을 보내기 전 빠른 실패용) */
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * SDK 클라이언트를 지연 생성한다 (모듈 import 시점이 아니라 실제로 쓸 때 —
 * 그래야 키 없는 환경에서도 테스트가 돈다).
 *
 * 키가 비어 있으면 여기서 바로 던진다. SDK 는 빈 문자열을 "설정됨"으로 보고
 * 요청을 보낸 뒤 401 로 실패하는데, 그러면 원인이 서버 설정 누락인지
 * 키가 틀린 건지 구분이 안 된다.
 * @returns {Anthropic}
 */
export function getClient() {
  if (!hasApiKey()) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  client ??= new Anthropic();
  return client;
}

/**
 * 오답 해설 요청 파라미터를 만든다.
 *
 * - `thinking` 은 **넣지 않는다**: Opus 5 는 thinking 이 기본으로 켜져 있고
 *   생략하면 adaptive 로 돈다. `budget_tokens` 는 400 이라 절대 쓰지 않는다.
 *   기본 display 가 omitted 라 thinking 블록은 빈 텍스트로 와서 해설 스트림을 방해하지 않는다.
 * - assistant prefill 은 쓰지 않는다 (Opus 5 에서 400). 출력 형식은 시스템 프롬프트로 지시한다.
 * @param {{system: Array<object>, messages: Array<object>, useServerFallback?: boolean}} args
 * @returns {object}
 */
export function buildTutorRequest({ system, messages, useServerFallback }) {
  const params = {
    model: MODEL,
    max_tokens: TUTOR_MAX_TOKENS,
    output_config: { effort: TUTOR_EFFORT }, // effort 는 output_config 안에 넣는다 (최상위 아님)
    system,
    messages,
  };

  const withFallback = useServerFallback ?? USE_SERVER_FALLBACK;
  if (withFallback) {
    params.betas = [SERVER_FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

/**
 * 오답 해설 스트림을 연다. 폴백을 쓰면 beta 네임스페이스를 타야 한다.
 * @param {{system: Array<object>, messages: Array<object>}} args
 * @returns {import('@anthropic-ai/sdk/lib/MessageStream').MessageStream}
 */
export function streamTutorMessage({ system, messages }) {
  const params = buildTutorRequest({ system, messages });
  const anthropic = getClient();
  return USE_SERVER_FALLBACK
    ? anthropic.beta.messages.stream(params)
    : anthropic.messages.stream(params);
}

/**
 * 학습 플래너(에이전트) 요청 파라미터를 만든다.
 *
 * - `thinking` 은 생략한다 (Opus 5 기본 adaptive). `budget_tokens` 는 400 이라 쓰지 않는다.
 * - `effort` 는 `output_config` **안에** 넣는다. 플래너는 `high` (§7-1).
 * - `output_config.format` 으로 구조화 출력을 건다. 도구 사용과 함께 쓸 때의
 *   금지 조합은 문서에 없다 (문서가 밝힌 비호환은 citations 와 prefill 뿐).
 * - `stream: true` — 플래너 턴은 길어서 스트리밍하지 않으면 HTTP 타임아웃 위험이 있다 (§3.2).
 * - `max_iterations` 는 SDK Tool Runner 의 파라미터다 (도구 루프 안전망).
 * @param {{system: Array<object>, messages: Array<object>, tools: Array<object>,
 *          schema: object, useServerFallback?: boolean}} args
 * @returns {object}
 */
export function buildPlanRequest({ system, messages, tools, schema, useServerFallback }) {
  const params = {
    model: MODEL,
    max_tokens: PLAN_MAX_TOKENS,
    output_config: {
      effort: PLAN_EFFORT,
      format: { type: 'json_schema', schema },
    },
    system,
    messages,
    tools,
    max_iterations: PLAN_MAX_ITERATIONS,
    stream: true,
  };

  const withFallback = useServerFallback ?? USE_SERVER_FALLBACK;
  if (withFallback) {
    params.betas = [SERVER_FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

/**
 * 플래너 Tool Runner 를 연다.
 *
 * Tool Runner 는 SDK 의 beta 헬퍼라 `client.beta.messages.toolRunner` 로만 접근한다
 * (해설과 달리 폴백 여부와 무관하게 beta 네임스페이스다).
 * @param {Parameters<typeof buildPlanRequest>[0]} args
 * @returns {import('@anthropic-ai/sdk/lib/tools/BetaToolRunner').BetaToolRunner<true>}
 */
export function runPlanner(args) {
  return getClient().beta.messages.toolRunner(buildPlanRequest(args));
}

/**
 * @typedef {object} UpstreamFailure
 * @property {'UPSTREAM'|'RATE_LIMITED'} code 클라이언트에 내려보낼 계약 코드
 * @property {string} message 사용자에게 보여줄 메시지 (업스트림 원문을 흘리지 않는다)
 * @property {boolean} retryable 같은 요청을 다시 보내볼 만한가
 * @property {number|undefined} status 업스트림 HTTP 상태 (로깅·디버깅용)
 */

/**
 * SDK 예외를 계약된 오류로 분류한다.
 *
 * 좁은 것부터 넓은 것 순으로 잡는다. JS SDK 에는 파이썬의 `APIStatusError` 가 없고,
 * `APIConnectionError` 가 `APIError` 의 **하위 클래스**라 반드시 먼저 걸러야 한다
 * (순서를 바꾸면 네트워크 오류가 상태코드 없는 APIError 로 빠진다).
 * @param {unknown} error
 * @returns {UpstreamFailure}
 */
export function classifyUpstreamError(error) {
  if (error instanceof Anthropic.NotFoundError) {
    return {
      code: 'UPSTREAM',
      message: '요청한 모델을 찾을 수 없습니다. 서버 설정을 확인해 주세요.',
      retryable: false,
      status: error.status,
    };
  }

  if (error instanceof Anthropic.RateLimitError) {
    return {
      code: 'RATE_LIMITED',
      message: 'AI 사용량 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
      status: error.status,
    };
  }

  // APIError 의 하위 클래스이므로 아래 분기보다 먼저 본다
  if (error instanceof Anthropic.APIConnectionError) {
    return {
      code: 'UPSTREAM',
      message: 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
      status: undefined,
    };
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable = typeof status === 'number' && status >= 500;
    return {
      code: 'UPSTREAM',
      message: retryable
        ? 'AI 서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : 'AI 요청이 거부되었습니다. 서버 설정을 확인해 주세요.',
      retryable,
      status,
    };
  }

  return {
    code: 'UPSTREAM',
    message: 'AI 해설을 만들지 못했습니다.',
    retryable: false,
    status: undefined,
  };
}
