// AI 엔드포인트의 요청측 경계 — 접근 제어 · 레이트리밋 · body 검증 · 오류 응답 계약.
//
// 블루프린트 §7-2 확정 사항:
//   - 레이트리밋은 **항상** 적용한다.
//   - `AI_ACCESS_CODE` 환경변수가 설정돼 있을 때만 `x-access-code` 헤더를 요구한다.
//     (미설정이면 코드 검사를 건너뛴다 — 1차 게이트는 Vercel 배포 보호)
//
// ⚠️ 레이트리밋의 한계: 아래 카운터는 **함수 인스턴스의 메모리**에 산다.
//   Vercel 서버리스는 인스턴스가 언제든 새로 뜨고(콜드 스타트) 동시에 여러 개가
//   병렬로 살아 있으므로, N 개 인스턴스가 떠 있으면 실제 허용량은 최대 N 배가 된다.
//   즉 이 구현은 **정확한 분산 한도가 아니라 남용 억제용 최선 노력**이다.
//   정확한 한도가 필요해지면 Vercel KV / Upstash 같은 공유 저장소나
//   Vercel Firewall 의 레이트리밋으로 옮겨야 한다 (이번 범위 밖).

import { createHash, timingSafeEqual } from 'node:crypto';

/** 계약된 오류 코드 → HTTP 상태코드 */
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  BAD_REQUEST: 400,
  UPSTREAM: 502,
};

/** IP 당 분당 허용 호출 수 (기본값 — 환경변수로 덮어쓸 수 있다) */
export const DEFAULT_RATE_LIMIT = {
  max: Number(process.env.AI_RATE_LIMIT_PER_MIN) || 10,
  windowMs: 60_000,
};

/** 한 인스턴스가 추적하는 최대 IP 수 — 메모리 폭주 방지 */
const MAX_TRACKED_KEYS = 5_000;

export const MAX_USER_ANSWER_LENGTH = 2_000;
export const MAX_HISTORY_TURNS = 10;

/** source 별 허용 id 형식. 화이트리스트 밖의 값은 파일 접근 전에 걸러진다. */
const ID_PATTERN = {
  quiz100: /^\d{3}$/, // 단답형 100선: 001 ~ 100
  codedrill: /^[CJPS]-\d{2}$/, // 코드트레이싱 드릴: C-01 ~ S-10
  bogang: /^B\d{2,3}$/, // 보강 암기: B01 ~
};

export const ALLOWED_SOURCES = Object.keys(ID_PATTERN);

/**
 * 계약된 오류 JSON 응답을 만든다.
 * @param {'UNAUTHORIZED'|'RATE_LIMITED'|'BAD_REQUEST'|'UPSTREAM'} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra] error 객체에 합칠 추가 필드
 * @returns {Response}
 */
export function jsonError(code, message, extra) {
  return new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status: ERROR_STATUS[code] ?? 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * 프록시 헤더에서 클라이언트 IP 를 뽑는다.
 * @param {Headers} headers
 * @returns {string}
 */
export function getClientIp(headers) {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * 타이밍 안전 문자열 비교.
 * 길이가 다르면 `timingSafeEqual` 이 예외를 던지므로, 두 값을 먼저 SHA-256 으로
 * 고정 길이(32바이트)로 만든 뒤 비교한다. 길이 차이도 비교 시간에 드러나지 않는다.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * 접근 코드 검사. `AI_ACCESS_CODE` 가 설정된 경우에만 헤더를 요구한다.
 * @param {Headers} headers
 * @param {Record<string, string|undefined>} env
 * @returns {{ok: true} | {ok: false, code: 'UNAUTHORIZED', message: string}}
 */
export function checkAccessCode(headers, env) {
  const expected = (env?.AI_ACCESS_CODE ?? '').trim();
  if (!expected) return { ok: true }; // 미설정 → 코드 검사를 건너뛴다

  const provided = headers.get('x-access-code') ?? '';
  if (timingSafeEqualString(provided, expected)) return { ok: true };

  return {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'x-access-code 헤더가 없거나 올바르지 않습니다.',
  };
}

/** key → 창 안에서 허용된 호출들의 타임스탬프 (오름차순) */
const hits = new Map();

/** 테스트·재기동용 — 추적 상태를 비운다. */
export function resetRateLimits() {
  hits.clear();
}

/**
 * 슬라이딩 윈도우 레이트리밋. 거절된 호출은 창에 쌓지 않으므로
 * 공격 트래픽이 정상 사용자의 회복을 늦추지 않는다.
 * @param {string} key 보통 클라이언트 IP
 * @param {number} now `Date.now()` 값 (테스트에서 주입)
 * @param {{max?: number, windowMs?: number}} [options]
 * @returns {{ok: true, remaining: number}
 *          | {ok: false, code: 'RATE_LIMITED', message: string, retryAfterSeconds: number}}
 */
export function checkRateLimit(key, now, options) {
  const max = options?.max ?? DEFAULT_RATE_LIMIT.max;
  const windowMs = options?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs;

  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= max) {
    hits.set(key, recent);
    const retryAfterMs = recent[0] + windowMs - now;
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `분당 ${max}회 제한을 넘었습니다. 잠시 후 다시 시도하세요.`,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // 추적 대상이 너무 많아지면 가장 오래 전에 삽입된 키부터 버린다.
  // (Map 은 삽입 순서를 유지하므로 첫 키가 가장 오래된 항목이다)
  while (hits.size > MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value;
    hits.delete(oldest);
  }

  return { ok: true, remaining: max - recent.length };
}

/** 한 턴이 대화 이력으로 쓸 수 있는 형태인지 확인한다. */
function isValidTurn(turn) {
  return (
    turn !== null &&
    typeof turn === 'object' &&
    (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.content === 'string' &&
    turn.content.length <= MAX_USER_ANSWER_LENGTH
  );
}

const bad = (message) => ({ ok: false, code: 'BAD_REQUEST', message });

/**
 * `POST /api/ai/tutor` 요청 body 검증.
 * 계약에 있는 필드만 남기고 나머지는 버린다 (프롬프트 주입 표면 축소).
 * @param {unknown} body
 * @returns {{ok: true, value: {source: string, id: string, userAnswer: string,
 *            history: Array<{role: string, content: string}>}}
 *          | {ok: false, code: 'BAD_REQUEST', message: string}}
 */
export function validateTutorBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('요청 body 는 JSON 객체여야 합니다.');
  }

  const { source, id, userAnswer, history } = body;

  if (!ALLOWED_SOURCES.includes(source)) {
    return bad(`source 는 ${ALLOWED_SOURCES.join(' | ')} 중 하나여야 합니다.`);
  }
  if (typeof id !== 'string' || !ID_PATTERN[source].test(id)) {
    return bad(`id 가 ${source} 의 형식(${ID_PATTERN[source].source})과 맞지 않습니다.`);
  }

  const answer = userAnswer ?? '';
  if (typeof answer !== 'string') {
    return bad('userAnswer 는 문자열이어야 합니다.');
  }
  if (answer.length > MAX_USER_ANSWER_LENGTH) {
    return bad(`userAnswer 는 ${MAX_USER_ANSWER_LENGTH}자를 넘을 수 없습니다.`);
  }

  const turns = history ?? [];
  if (!Array.isArray(turns)) {
    return bad('history 는 배열이어야 합니다.');
  }
  if (turns.length > MAX_HISTORY_TURNS) {
    return bad(`history 는 ${MAX_HISTORY_TURNS}턴을 넘을 수 없습니다.`);
  }
  if (!turns.every(isValidTurn)) {
    return bad(
      `history 의 각 턴은 role(user|assistant)과 ${MAX_USER_ANSWER_LENGTH}자 이하의 content 를 가져야 합니다.`
    );
  }

  return {
    ok: true,
    value: {
      source,
      id,
      userAnswer: answer,
      history: turns.map((t) => ({ role: t.role, content: t.content })),
    },
  };
}
