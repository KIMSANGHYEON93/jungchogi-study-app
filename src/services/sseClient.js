// AI 엔드포인트 공용 SSE 전송 계층.
//
// EventSource 는 GET 만 보내므로 쓸 수 없다. fetch + ReadableStream 리더로
// text/event-stream 을 직접 파싱한다. 프레임 payload 의 모양(해설의 `delta`,
// 플래너의 `phase`)만 엔드포인트마다 다르고, 청크 경계·CRLF·다중 `data:` 줄·
// 취소·오류 정규화는 모두 같아서 여기 한 곳에 둔다.

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

function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || err.code === 20);
}

/** 스트림 시작 전 오류 응답을 AiRequestError 로 정규화한다. */
async function toResponseError(response) {
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
 * SSE 프레임 하나에서 data 필드를 뽑아 JSON 으로 읽는다.
 * data 줄이 여러 개면 SSE 규격대로 개행으로 잇는다.
 * @returns {object|null} 파싱 불가하면 null (건너뛴다)
 */
function parseFrame(frame) {
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue; // 주석(:), event/id 필드는 버린다
    dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} SseResult
 * @property {object|null} done 마지막 `{"done":true,...}` 프레임의 payload. 못 받았으면 null
 * @property {boolean} aborted 사용자가 취소해 중간에 끝났는지
 */

/**
 * AI 엔드포인트에 JSON 을 POST 하고 SSE 응답을 끝까지 읽는다.
 *
 * `{"error":...}` 프레임과 스트림 시작 전 오류는 `AiRequestError` 로 던지고,
 * `{"done":true,...}` 프레임을 만나면 즉시 멈춘다. 그 밖의 프레임은
 * `onPayload` 로 넘겨 엔드포인트별 해석을 맡긴다.
 *
 * 취소는 오류가 아니다 — `{ aborted: true }` 로 정상 종료한다.
 *
 * @param {string} endpoint
 * @param {object} body
 * @param {{onPayload?: (payload: object) => void, signal?: AbortSignal,
 *          getPartialText?: () => string}} [options]
 * @returns {Promise<SseResult>}
 */
export async function postSseStream(endpoint, body, options = {}) {
  const { onPayload, signal, getPartialText } = options;
  const partial = () => getPartialText?.() ?? '';

  if (signal?.aborted) return { done: null, aborted: true };

  const headers = { 'Content-Type': 'application/json' };
  const accessCode = getAccessCode();
  // 서버가 AI_ACCESS_CODE 를 안 걸었으면 헤더를 요구하지 않는다 → 아예 생략한다.
  if (accessCode) headers['x-access-code'] = accessCode;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return { done: null, aborted: true };
    throw new AiRequestError('NETWORK', err?.message);
  }

  if (!response.ok) throw await toResponseError(response);
  if (!response.body) throw new AiRequestError('PROTOCOL', '응답 본문이 비어 있습니다.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // 청크 경계는 프레임 경계와 무관하다. 한 프레임이 여러 청크에 걸쳐 오기도 하고
  // 한 청크에 여러 프레임이 들어오기도 하므로, 버퍼에 이어붙였다가
  // 빈 줄(\n\n) 경계로만 잘라 처리한다.
  let buffer = '';
  let donePayload = null;
  let streamError = null;
  let finished = false;

  // 버퍼에서 완결된 프레임만 꺼내 처리한다. done/error 를 만나면 즉시 멈춘다.
  const drain = (flush) => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      let frame;
      if (boundary >= 0) {
        frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
      } else if (flush && buffer.trim() !== '') {
        frame = buffer;
        buffer = '';
      } else {
        return;
      }

      const payload = parseFrame(frame);
      if (!payload) continue;

      if (payload.error) {
        streamError = new AiRequestError(payload.error.code, payload.error.message, {
          partialText: partial(),
        });
        finished = true;
        return;
      }
      if (payload.done) {
        donePayload = payload;
        finished = true;
        return;
      }
      onPayload?.(payload);
    }
  };

  // 취소 응답성은 본문 스트림에 기대지 않는다.
  // 실제 fetch 는 abort 시 본문을 AbortError 로 터뜨리지만, 그걸 기다리는 사이
  // 화면이 "생성 중"에 붙잡혀 있으면 안 된다 — read 와 abort 를 경주시킨다.
  const ABORTED = Symbol('aborted');
  const abortRace = signal
    ? new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
      })
    : null;

  try {
    while (!finished) {
      const chunk = abortRace ? await Promise.race([reader.read(), abortRace]) : await reader.read();
      if (chunk === ABORTED) return { done: null, aborted: true };
      const { value, done: streamDone } = chunk;
      if (streamDone) {
        // CRLF 를 쓰는 서버가 있어 프레임 경계 판정 전에 \n 으로 통일한다.
        buffer = buffer.replace(/\r\n/g, '\n');
        drain(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      drain(false);
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return { done: null, aborted: true };
    throw new AiRequestError('UPSTREAM', err?.message, { partialText: partial() });
  } finally {
    // done 이후 남은 본문은 읽지 않는다. 이미 닫힌 스트림이면 조용히 실패한다.
    reader.cancel().catch(() => {});
  }

  if (streamError) throw streamError;
  return { done: donePayload, aborted: false };
}
