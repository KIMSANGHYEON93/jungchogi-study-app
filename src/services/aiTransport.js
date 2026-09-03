// AI 엔드포인트 공용 전송 원시 계층.
//
// 스트리밍(해설·플래너)이든 단발 JSON(채점)이든 똑같이 필요한 것들만 모은다:
// 접근 코드 헤더, 오류 응답 → `AiRequestError` 정규화, 취소 판정.
// 프레임 파싱처럼 SSE 에만 있는 것은 `sseClient.js` 가 이어서 맡는다.
//
// 화면은 `AiRequestError.code` 하나만 보고 안내 문구를 고른다. 그래서
// **모든 엔드포인트가 같은 코드 집합으로 실패해야** 하고, 그 보장이 이 파일이다.

/** 서버가 쓰는 코드 + 클라이언트에서만 나는 두 가지(NETWORK, PROTOCOL) */
const KNOWN_CODES = ['UNAUTHORIZED', 'RATE_LIMITED', 'BAD_REQUEST', 'UPSTREAM', 'NETWORK', 'PROTOCOL'];

const STATUS_TO_CODE = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'UNAUTHORIZED',
  429: 'RATE_LIMITED',
};

const DEFAULT_MESSAGE = {
  UNAUTHORIZED: '접근 코드가 필요하거나 올바르지 않습니다.',
  RATE_LIMITED: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  BAD_REQUEST: '요청 내용이 올바르지 않습니다.',
  UPSTREAM: 'AI 응답을 받지 못했습니다.',
  NETWORK: '서버에 연결하지 못했습니다.',
  PROTOCOL: '서버 응답 형식이 올바르지 않습니다.',
};

/**
 * 오류 응답(JSON)과 스트림 중간 error 프레임을 같은 형태로 모은 오류.
 * 훅과 UI 는 `code` 만 보고 안내 문구를 고른다.
 */
export class AiRequestError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {{status?: number, partialText?: string}} [meta]
   */
  constructor(code, message, meta = {}) {
    const normalized = KNOWN_CODES.includes(code) ? code : 'UPSTREAM';
    super(message || DEFAULT_MESSAGE[normalized]);
    this.name = 'AiRequestError';
    this.code = normalized;
    this.status = meta.status ?? null;
    this.partialText = meta.partialText ?? '';
  }
}

// Vite 는 VITE_ 접두사 환경변수를 번들에 문자열로 그대로 박아 넣는다.
// 즉 이 값은 브라우저에서 누구나 읽을 수 있는 공개 값이며 비밀이 아니다.
// 검색엔진에 걸린 URL 을 우연히 눌러 들어온 사람이 AI 비용을 태우는 것만 막는
// 수준의 방벽이다. 실제 방어는 서버의 레이트리밋과 배포 보호가 담당한다.
function getAccessCode() {
  const raw = import.meta.env?.VITE_AI_ACCESS_CODE;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** 모든 AI 요청이 쓰는 헤더. 접근 코드가 없으면 헤더 자체를 붙이지 않는다. */
export function buildAiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  // 서버가 AI_ACCESS_CODE 를 안 걸었으면 헤더를 요구하지 않는다 → 아예 생략한다.
  const accessCode = getAccessCode();
  if (accessCode) headers['x-access-code'] = accessCode;
  return headers;
}

export function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || err.code === 20);
}

/** 오류 응답을 AiRequestError 로 정규화한다. */
export async function toResponseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // 프록시가 끼어들어 HTML 을 돌려주는 경우가 있다 — 상태 코드로 대체한다.
  }
  const error = payload?.error;
  const code = error?.code || STATUS_TO_CODE[response.status] || 'UPSTREAM';
  return new AiRequestError(code, error?.message, { status: response.status });
}

/**
 * AI 엔드포인트에 JSON 을 POST 하고 JSON 응답 하나를 받는다.
 *
 * 채점(§4.2)처럼 스트리밍이 아닌 엔드포인트용이다. 취소는 오류가 아니다 —
 * `{ aborted: true }` 로 정상 종료하고, 그 밖의 실패는 `AiRequestError` 로 던진다.
 *
 * @param {string} endpoint
 * @param {object} body
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{data: object|null, aborted: boolean}>}
 */
export async function postAiJson(endpoint, body, options = {}) {
  const { signal } = options;
  if (signal?.aborted) return { data: null, aborted: true };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildAiHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return { data: null, aborted: true };
    throw new AiRequestError('NETWORK', err?.message);
  }

  if (!response.ok) throw await toResponseError(response);

  try {
    return { data: await response.json(), aborted: false };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return { data: null, aborted: true };
    throw new AiRequestError('PROTOCOL', '응답을 JSON 으로 읽지 못했습니다.');
  }
}
