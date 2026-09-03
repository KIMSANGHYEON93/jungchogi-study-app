// AI 엔드포인트 공용 SSE 전송 계층.
//
// EventSource 는 GET 만 보내므로 쓸 수 없다. fetch + ReadableStream 리더로
// text/event-stream 을 직접 파싱한다. 프레임 payload 의 모양(해설의 `delta`,
// 플래너의 `phase`)만 엔드포인트마다 다르고, 청크 경계·CRLF·다중 `data:` 줄·
// 취소는 모두 같아서 여기 한 곳에 둔다.
//
// 헤더 처리와 오류 정규화는 스트리밍 여부와 무관하므로 `aiTransport.js` 가 맡는다 —
// 단발 JSON 인 채점(§4.2)도 같은 것을 쓴다.

import { AiRequestError, buildAiHeaders, isAbortError, toResponseError } from './aiTransport';

export { AiRequestError };

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

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildAiHeaders(),
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
