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

// ─── 플래너 스냅샷 상한 ───
//
// 스냅샷은 브라우저가 보내는 값이라 크기를 통제하지 않으면 그대로 토큰 비용이 된다.
// 두 겹으로 막는다: 개별 항목 개수 상한 + 직렬화 **바이트** 총량 상한.
// 바이트 상한을 따로 두는 이유는 "노트 1개"에 수십 KB 문자열을 담는 요청을
// 개수 상한만으로는 막을 수 없기 때문이다.

/** 직렬화한 스냅샷의 최대 바이트 (128 KiB) */
export const MAX_SNAPSHOT_BYTES = 128 * 1024;
/** 오답노트 최대 개수 (문항 총량이 340 문항 남짓이라 이보다 많을 수 없다) */
export const MAX_WRONG_NOTES = 400;
/** 스냅샷 안 자유 문자열의 최대 길이 */
export const MAX_SNAPSHOT_TEXT = 500;
/** 맵 형태 필드(quizResults/studyTime/dayChecks)의 최대 키 개수 */
export const MAX_SNAPSHOT_MAP_KEYS = 600;
export const MIN_AVAILABLE_MINUTES = 5;
export const MAX_AVAILABLE_MINUTES = 600;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * C0·C1 제어문자. **`\t`(09)·`\n`(0A)·`\r`(0D)는 남기고** 나머지를 지운다.
 *
 * 경계를 여기 그은 이유는 두 힘이 서로 반대로 당기기 때문이다.
 *   - 지워야 하는 쪽: 답안·스냅샷은 브라우저가 보내는 값이고 그대로 프롬프트에 실린다.
 *     NUL·ESC 가 섞이면 터미널 이스케이프가 서버 로그를 물들이고 프롬프트에는
 *     눈에 보이지 않는 바이트가 들어간다.
 *   - 남겨야 하는 쪽: **코드 트레이싱 채점은 탭·개행이 비교 대상이다.**
 *     출력값의 줄바꿈 위치와 들여쓰기가 곧 정답 여부라, 답안 원문을 한 글자라도
 *     바꾸면 채점 결과가 달라진다. `\r` 도 남긴다 — 윈도우 브라우저의 textarea 는
 *     `\r\n` 을 보내는데, `\r` 만 지우면 사용자가 적지 않은 답안을 서버가 만들어낸다.
 * 그 밖의 C0/C1 은 어느 답안에서도 의미를 갖지 않으므로 지운다.
 */
// eslint-disable-next-line no-control-regex -- 제어문자를 지우는 게 목적인 정규식이다
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

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

/**
 * 사용자 답안에서 제어문자만 걷어낸다 (위 `CONTROL_CHARS` 주석의 경계).
 * 길이는 여기서 자르지 않는다 — 상한 초과는 조용히 자르지 않고 400 으로 알리는 것이
 * 두 엔드포인트의 계약이고, 잘라 보내면 사용자가 못 본 답안이 채점된다.
 * @param {string} value
 * @returns {string}
 */
function sanitizeAnswer(value) {
  return value.replace(CONTROL_CHARS, '');
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

  const raw = userAnswer ?? '';
  if (typeof raw !== 'string') {
    return bad('userAnswer 는 문자열이어야 합니다.');
  }
  // 제어문자를 먼저 걷어내고 그 결과로 길이를 잰다. 상한은 **업스트림에 실리는
  // 문자열**에 대한 약속이고, 지워질 바이트를 길이로 세면 멀쩡한 답안이 400 이 된다.
  const answer = sanitizeAnswer(raw);
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

/** 채점 종류 (블루프린트 §4.2). code = 코드 트레이싱 출력값, short = 단답형 */
export const ALLOWED_GRADE_KINDS = ['code', 'short'];

/**
 * `POST /api/ai/grade` 요청 body 검증 (블루프린트 §4.2).
 *
 * 해설(`validateTutorBody`)과 다른 점 두 가지:
 *   - `kind` 가 있다 — 채점 기준이 종류마다 다르다.
 *   - `userAnswer` 가 **필수**다. 빈 답안은 채점할 내용이 없으므로 업스트림에 가기 전에 끊는다
 *     (해설은 "답을 안 쓰고 넘어갔다"도 설명할 거리가 되지만, 채점은 그렇지 않다).
 *
 * @param {unknown} body
 * @returns {{ok: true, value: {kind: string, source: string, id: string, userAnswer: string}}
 *          | {ok: false, code: 'BAD_REQUEST', message: string}}
 */
export function validateGradeBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('요청 body 는 JSON 객체여야 합니다.');
  }

  const { kind, source, id, userAnswer } = body;

  if (!ALLOWED_GRADE_KINDS.includes(kind)) {
    return bad(`kind 는 ${ALLOWED_GRADE_KINDS.join(' | ')} 중 하나여야 합니다.`);
  }
  if (!ALLOWED_SOURCES.includes(source)) {
    return bad(`source 는 ${ALLOWED_SOURCES.join(' | ')} 중 하나여야 합니다.`);
  }
  if (typeof id !== 'string' || !ID_PATTERN[source].test(id)) {
    return bad(`id 가 ${source} 의 형식(${ID_PATTERN[source].source})과 맞지 않습니다.`);
  }
  if (typeof userAnswer !== 'string') {
    return bad('userAnswer 는 문자열이어야 합니다.');
  }
  // 해설(`validateTutorBody`)과 같은 순서다 — 정리한 뒤에 비었는지·긴지를 본다.
  // 제어문자만 적힌 답안은 `trim()` 이 걸러 주지 못한다(NUL·ESC 는 공백이 아니다).
  // 정리 후에 재야 채점할 내용이 없는 요청이 업스트림에 가기 전에 끊긴다.
  const answer = sanitizeAnswer(userAnswer);
  if (answer.trim() === '') {
    return bad('userAnswer 가 비어 있습니다. 채점할 답안이 필요합니다.');
  }
  if (answer.length > MAX_USER_ANSWER_LENGTH) {
    return bad(`userAnswer 는 ${MAX_USER_ANSWER_LENGTH}자를 넘을 수 없습니다.`);
  }

  return { ok: true, value: { kind, source, id, userAnswer: answer } };
}

// ─── 플래너 스냅샷 검증 ───

/**
 * 스냅샷 안의 자유 문자열을 정리한다.
 * 제어문자를 지우고(터미널 이스케이프·널 바이트) 길이를 상한까지 자른다.
 *
 * 자르는 자리가 서로게이트 페어 한가운데면 짝 잃은 상위 서로게이트가 남는다.
 * 그대로 JSON 으로 나가면 `\ud83d` 로 이스케이프돼 프롬프트에 깨진 글자로 실리므로
 * 마지막 한 글자를 더 떼어낸다 (이모지 반쪽보다 없는 편이 낫다).
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  const cut = value.replace(CONTROL_CHARS, '').slice(0, MAX_SNAPSHOT_TEXT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * `{키: 값}` 맵 필드를 검증·정규화한다.
 * @param {unknown} raw
 * @param {string} field 오류 메시지에 쓸 필드명
 * @param {(v: unknown) => boolean} isValidValue
 * @param {(v: unknown) => unknown} normalize
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, message: string}}
 */
function validateMap(raw, field, isValidValue, normalize) {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, message: `${field} 는 객체여야 합니다.` };

  const entries = Object.entries(raw);
  if (entries.length > MAX_SNAPSHOT_MAP_KEYS) {
    return { ok: false, message: `${field} 는 ${MAX_SNAPSHOT_MAP_KEYS}개를 넘을 수 없습니다.` };
  }

  // `value[key] = ...` 로 쓰면 안 된다. 키가 `__proto__` 일 때 대입이 프로토타입
  // 설정으로 새어 값이 **조용히 사라지고**, 값이 객체인 필드가 나중에 생기면
  // 그대로 프로토타입 오염이 된다. `Object.fromEntries` 는 자기 속성으로 정의하므로
  // 어떤 키 이름이 와도 데이터로만 남는다.
  const pairs = [];
  for (const [key, item] of entries) {
    if (!isValidValue(item)) {
      return { ok: false, message: `${field} 의 값 형식이 올바르지 않습니다 (키: ${sanitizeText(key)}).` };
    }
    pairs.push([sanitizeText(key), normalize(item)]);
  }
  return { ok: true, value: Object.fromEntries(pairs) };
}

/**
 * 오답노트 하나를 계약된 필드만 남겨 정규화한다.
 * 화이트리스트 방식이라 클라이언트가 끼워 넣은 임의 필드
 * (프롬프트 주입 문구가 들어올 자리)는 여기서 사라진다.
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ok: true, value: object} | {ok: false, message: string}}
 */
function validateWrongNote(raw, index) {
  const at = `wrongNotes[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, message: `${at} 는 객체여야 합니다.` };

  if (!ALLOWED_SOURCES.includes(raw.source)) {
    return { ok: false, message: `${at}.source 는 ${ALLOWED_SOURCES.join(' | ')} 중 하나여야 합니다.` };
  }
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    return { ok: false, message: `${at}.id 는 비어 있지 않은 문자열이어야 합니다.` };
  }

  return {
    ok: true,
    value: {
      source: raw.source,
      id: sanitizeText(raw.id),
      question: sanitizeText(raw.question),
      category: sanitizeText(raw.category),
      // 간격 반복 판정은 이 세 값만 쓴다. 숫자가 아니면 0/undefined 로 떨어뜨려
      // `selectDueReviews` 의 "정보가 없으면 즉시 대기" 규칙에 맡긴다.
      reviewCount: isFiniteNumber(raw.reviewCount) ? raw.reviewCount : 0,
      mastered: raw.mastered === true,
      addedAt: isFiniteNumber(raw.addedAt) ? raw.addedAt : 0,
      lastReviewed: isFiniteNumber(raw.lastReviewed) ? raw.lastReviewed : 0,
    },
  };
}

/**
 * `POST /api/ai/plan` 요청 body 검증.
 *
 * 스냅샷은 신뢰할 수 없는 입력이다. 순서대로:
 *   1. 직렬화 **바이트** 총량 (정규화 전 원본 기준 — 잘라서 통과시키지 않는다)
 *   2. 필수 필드 존재·타입
 *   3. 개수 상한
 *   4. 계약된 필드만 남기고 문자열 정리
 *
 * @param {unknown} body
 * @returns {{ok: true, value: {snapshot: object}}
 *          | {ok: false, code: 'BAD_REQUEST', message: string}}
 */
export function validatePlanBody(body) {
  if (!isPlainObject(body)) {
    return bad('요청 body 는 JSON 객체여야 합니다.');
  }

  const raw = body.snapshot;
  if (!isPlainObject(raw)) {
    return bad('snapshot 은 JSON 객체여야 합니다.');
  }

  // 1) 크기 — 상한을 넘으면 파싱·정규화에 들어가기 전에 끊는다
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    return bad('snapshot 을 직렬화하지 못했습니다.');
  }
  if (bytes > MAX_SNAPSHOT_BYTES) {
    return bad(`snapshot 크기가 상한(${MAX_SNAPSHOT_BYTES}바이트)을 넘었습니다.`);
  }

  // 2) availableMinutes — 유일한 필수 필드. 계획의 총량을 정하는 값이라 기본값을 두지 않는다.
  if (!isFiniteNumber(raw.availableMinutes)) {
    return bad('availableMinutes 는 숫자여야 합니다.');
  }
  if (
    raw.availableMinutes < MIN_AVAILABLE_MINUTES ||
    raw.availableMinutes > MAX_AVAILABLE_MINUTES
  ) {
    return bad(
      `availableMinutes 는 ${MIN_AVAILABLE_MINUTES}~${MAX_AVAILABLE_MINUTES} 사이여야 합니다.`
    );
  }

  // 3) examDate — 없으면 D-Day 미설정으로 본다
  if (raw.examDate !== undefined && raw.examDate !== null) {
    if (typeof raw.examDate !== 'string' || !DATE_PATTERN.test(raw.examDate)) {
      return bad('examDate 는 YYYY-MM-DD 형식의 문자열이어야 합니다.');
    }
  }

  // 4) wrongNotes
  const rawNotes = raw.wrongNotes ?? [];
  if (!Array.isArray(rawNotes)) {
    return bad('wrongNotes 는 배열이어야 합니다.');
  }
  if (rawNotes.length > MAX_WRONG_NOTES) {
    return bad(`wrongNotes 는 ${MAX_WRONG_NOTES}개를 넘을 수 없습니다.`);
  }
  const wrongNotes = [];
  for (const [index, note] of rawNotes.entries()) {
    const checked = validateWrongNote(note, index);
    if (!checked.ok) return bad(checked.message);
    wrongNotes.push(checked.value);
  }

  // 5) 맵 형태 필드
  const quizResults = validateMap(
    raw.quizResults,
    'quizResults',
    (v) => typeof v === 'string',
    sanitizeText
  );
  if (!quizResults.ok) return bad(quizResults.message);

  const studyTime = validateMap(raw.studyTime, 'studyTime', isFiniteNumber, (v) => v);
  if (!studyTime.ok) return bad(studyTime.message);

  const dayChecks = validateMap(
    raw.dayChecks,
    'dayChecks',
    (v) => typeof v === 'boolean',
    (v) => v
  );
  if (!dayChecks.ok) return bad(dayChecks.message);

  return {
    ok: true,
    value: {
      snapshot: {
        examDate: raw.examDate ?? null,
        wrongNotes,
        quizResults: quizResults.value,
        studyTime: studyTime.value,
        dayChecks: dayChecks.value,
        availableMinutes: raw.availableMinutes,
      },
    },
  };
}
