// AI 사용 원장 (BLUEPRINT §5 Phase 5 — "평가·운영: usage 로깅, 비용 리포트").
//
// 이 앱은 **사용자 본인의 API 키**로 돈다. 해설·플래너·채점을 부를 때마다
// 사용자의 지갑에서 돈이 나가는데, 지금까지 그걸 볼 방법이 없었다.
// 서버가 응답에 실어 보내는 `cost` 객체를 로컬에 쌓아 두고 화면에서 합쳐 보여 준다.
//
// ── 이 파일이 지키는 두 가지 ──
//
// 1. **원장은 학습 데이터보다 우선순위가 낮다.** 진도·오답노트가 저장 못 하는 상황을
//    원장이 만들면 안 된다. 그래서 상한을 두고(아래), 그래도 용량이 부족하면
//    원장이 스스로 줄어들고 마지막에는 키째 물러난다 (`writeLedger`).
// 2. **기록 실패가 학습 흐름을 막지 않는다.** `recordUsage` 는 어떤 경우에도 던지지 않는다.
//    해설이 잘 나왔는데 원장 때문에 화면이 깨지는 쪽이 훨씬 나쁘다.
//
// `storage.js` 는 다른 작업에서 수정 중이라 손대지 않고 공개 함수만 가져다 쓴다.

import { saveProgress, loadProgress, clearProgress, toLocalDateKey } from './storage';

/** `jungchogi_` 접두사 뒤에 붙는 키 이름 (실제 키: `jungchogi_usage_ledger`) */
export const USAGE_LEDGER_KEY = 'usage_ledger';

/** 내보내기 파일의 형식 표식. 소비하는 쪽(`scripts/usage-report.mjs`)이 이걸 보고 판별한다. */
export const USAGE_EXPORT_SCHEMA = 'jungchogi.usage-ledger.v1';

/**
 * 원장이 써도 되는 저장 용량 상한.
 *
 * 대시보드 "데이터 관리"가 `jungchogi_` 전체를 **5 MB** 기준으로 표시하고
 * 80% 를 넘으면 경고를 띄운다. 원장은 부수적인 관측 데이터이므로 그 표시의
 * **5% 미만**만 쓴다 — 원장이 다 차 있어도 학습 데이터에게 95% 가 남는다.
 */
export const LEDGER_BYTE_BUDGET = Math.floor(5 * 1024 * 1024 * 0.05); // 262,144 B

/**
 * 보관 건수 상한.
 *
 * 기록 한 건의 JSON 은 최악(모든 필드가 다 찬 실패 기록)에도 약 255자 = 510 B(UTF-16)다.
 * 500건 × 510 B ≈ 250 KB 로 위 예산(262,144 B) 안에 든다. 상한을 건수로 잡는 이유는
 * 저장 전에 값을 재지 않고도 최악을 계산할 수 있어서다 — 정규화가 필드와 문자열 길이를
 * 모두 고정하므로 건수가 곧 용량 상한이 된다.
 */
export const MAX_LEDGER_ENTRIES = 500;

/**
 * 보관 기간 상한(일).
 *
 * 시험 준비 한 주기(D-Day 카운터 + 14일 체크리스트)를 넉넉히 덮으면서,
 * 몇 달 전 다른 시험 회차의 비용이 "전체" 합계에 섞여 지금의 지출을
 * 부풀려 보이게 하지 않는 선. 건수 상한과 함께 **둘 중 먼저 걸리는 쪽**이 적용된다.
 */
export const LEDGER_RETENTION_DAYS = 90;

/** 서버가 보내는 엔드포인트 이름 (계약 고정) */
export const USAGE_ENDPOINTS = ['tutor', 'plan', 'grade', 'generate'];

/** 계약 밖 값이 왔을 때 쓰는 자리표시 — `byEndpoint` 맵이 무한정 넓어지지 않게 한다 */
const UNKNOWN_ENDPOINT = 'unknown';

const EFFORTS = ['low', 'medium', 'high'];
const MAX_MODEL_LENGTH = 64;
const MAX_ERROR_CODE_LENGTH = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 원장에 쌓이는 기록 한 건. 서버의 `cost` 객체와 필드가 같지만,
 * **모든 값이 정규화를 거쳐 타입이 보장된다** — 화면과 집계는 이 보장에 기댄다.
 *
 * @typedef {Object} UsageEntry
 * @property {string} ts ISO 8601 (UTC)
 * @property {string} endpoint `tutor`|`plan`|`grade`|`generate`|`unknown`
 * @property {string|null} model
 * @property {'low'|'medium'|'high'|null} effort
 * @property {number} inputTokens 캐시를 타지 않은 입력 토큰
 * @property {number} outputTokens
 * @property {number} cacheReadTokens 캐시에서 읽은 입력 토큰
 * @property {number} cacheCreationTokens 캐시를 만드느라 쓴 입력 토큰
 * @property {number} costUsd 서버가 계산한 **추정** 비용
 * @property {number|null} latencyMs 읽을 수 없으면 null (0ms 와 구분한다)
 * @property {boolean} ok
 * @property {string|null} errorCode
 */

/**
 * 기간 합계.
 *
 * @typedef {Object} UsageSummary
 * @property {number} calls
 * @property {number} okCalls
 * @property {number} failedCalls
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheCreationTokens
 * @property {number} costUsd
 * @property {number|null} cacheHitRate 0~1. 입력 토큰이 하나도 없으면 null
 * @property {Record<string, UsageSummary>} byEndpoint 엔드포인트별 분해(중첩된 byEndpoint 는 비어 있다)
 */

// ─── 값 정규화 ───

/**
 * 유한한 0 이상 숫자로 읽는다. 숫자 문자열도 받아 준다.
 * 못 읽거나 음수면 fallback — 음수 비용·음수 토큰은 합계를 조용히 깎는다.
 */
function toCount(value, fallback = 0) {
  let parsed = NaN;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && value.trim() !== '') parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/** 0 이상 숫자 또는 null (latencyMs 처럼 "없음"과 0 을 구분해야 하는 값) */
function toNullableCount(value) {
  if (value === null || value === undefined) return null;
  const parsed = toCount(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoundedString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, maxLength);
}

/**
 * ISO 문자열만 시각으로 인정한다. 숫자를 `Date.parse` 에 넘기면 문자열로 강제 변환돼
 * `12345` 가 서기 12345년으로 읽히는 일이 생긴다.
 * @returns {number} ms 타임스탬프. 읽을 수 없으면 NaN
 */
function parseTs(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function toIsoTimestamp(value, now) {
  const parsed = parseTs(value);
  return new Date(Number.isFinite(parsed) ? parsed : now).toISOString();
}

/**
 * 서버 `cost` 객체를 원장 기록으로 정규화한다.
 *
 * **모르는 필드는 버린다.** 서버가 나중에 필드를 더 붙여도 원장은 계약이 정한
 * 필드만 담는다 — 저장 용량 상한(건수 → 용량)이 그 고정에 기대고 있어서,
 * 모르는 값을 그대로 실어 두면 한 건의 크기가 예측 불가능해진다.
 *
 * @param {unknown} cost 서버가 보낸 `cost`. 없거나 객체가 아니면 null 을 준다.
 * @param {{endpoint?: string, now?: number}} [context] 호출부가 아는 값(엔드포인트 등)
 * @returns {UsageEntry|null}
 */
export function normalizeCostEntry(cost, context = {}) {
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return null;

  const now = context.now ?? Date.now();
  const fallbackEndpoint = USAGE_ENDPOINTS.includes(context.endpoint)
    ? context.endpoint
    : UNKNOWN_ENDPOINT;

  return {
    ts: toIsoTimestamp(cost.ts, now),
    endpoint: USAGE_ENDPOINTS.includes(cost.endpoint) ? cost.endpoint : fallbackEndpoint,
    model: toBoundedString(cost.model, MAX_MODEL_LENGTH),
    effort: EFFORTS.includes(cost.effort) ? cost.effort : null,
    inputTokens: toCount(cost.inputTokens),
    outputTokens: toCount(cost.outputTokens),
    cacheReadTokens: toCount(cost.cacheReadTokens),
    cacheCreationTokens: toCount(cost.cacheCreationTokens),
    costUsd: toCount(cost.costUsd),
    latencyMs: toNullableCount(cost.latencyMs),
    // 명시적으로 false 일 때만 실패로 본다. 계약 밖 값("false", 0)은 판단 근거가 못 된다.
    ok: cost.ok !== false,
    errorCode: toBoundedString(cost.errorCode, MAX_ERROR_CODE_LENGTH),
  };
}

// ─── 저장 ───

/**
 * 저장된 배열에서 기록으로 읽을 수 있는 것만 남긴다.
 *
 * **"저장소를 못 읽었다"와 "원장이 비었다"를 구분한다.** 사생활 보호 모드의
 * SecurityError 를 빈 원장으로 접어 버리면, 그 상태에서 한 건을 기록할 때
 * 멀쩡히 쌓여 있던 기록을 한 건짜리 배열로 덮어쓰게 된다.
 *
 * @returns {UsageEntry[]|null} 저장소를 읽지 못했으면 null. 없거나 손상됐으면 빈 배열
 */
function readEntries() {
  let raw;
  try {
    raw = loadProgress(USAGE_LEDGER_KEY, []);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return [];
  const entries = [];
  for (const item of raw) {
    const entry = normalizeCostEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 상한(건수·기간) 안으로 자른다. 최신이 배열 끝이다. */
function pruneEntries(entries, now) {
  const cutoff = now - LEDGER_RETENTION_DAYS * DAY_MS;
  const fresh = entries.filter((e) => {
    const at = parseTs(e.ts);
    // 읽을 수 없는 ts 는 정규화에서 이미 사라진다. 남아 있으면 버리지 않고 둔다.
    return !Number.isFinite(at) || at >= cutoff;
  });
  return fresh.length > MAX_LEDGER_ENTRIES ? fresh.slice(fresh.length - MAX_LEDGER_ENTRIES) : fresh;
}

/**
 * 원장을 쓴다. **용량이 모자라면 원장이 물러난다.**
 *
 * `saveProgress` 는 용량 초과에서 `false` 를 준다(그 밖의 예외는 전파). 여기서는
 * 절반씩 줄여 가며 다시 시도하고, 그래도 안 들어가면 키 자체를 지운다.
 * 원장이 차지하던 자리를 학습 데이터에 되돌려 주는 것이 이 함수의 존재 이유다.
 *
 * @returns {boolean} 무언가 저장했으면 true
 */
function writeLedger(entries) {
  if (saveProgress(USAGE_LEDGER_KEY, entries)) return true;

  let shrunk = entries;
  while (shrunk.length > 1) {
    shrunk = shrunk.slice(Math.ceil(shrunk.length / 2)); // 오래된 절반을 버린다
    if (saveProgress(USAGE_LEDGER_KEY, shrunk)) return true;
  }

  // 한 건도 못 담는다 → 원장은 포기하고 자리를 비운다.
  clearProgress(USAGE_LEDGER_KEY);
  return false;
}

/**
 * 서버가 보낸 `cost` 를 원장에 남긴다.
 *
 * **어떤 경우에도 던지지 않는다.** 학습 흐름(해설·채점·플래너)이 원장 때문에
 * 멈추면 안 된다. 실패는 반환값 `false` 로만 알린다.
 *
 * `cost` 가 없으면(서버가 아직 안 보내는 상태) 아무것도 남기지 않는다 —
 * 토큰도 비용도 모르는 기록을 0 으로 채워 넣으면 합계가 조용히 틀어진다.
 * 화면에는 "기록 없음"으로 보이는 것이 정직하다.
 *
 * @param {unknown} cost
 * @param {{endpoint?: string}} [context]
 * @returns {boolean} 기록했으면 true
 */
export function recordUsage(cost, context = {}) {
  try {
    const now = Date.now();
    const entry = normalizeCostEntry(cost, { ...context, now });
    if (!entry) return false;
    const existing = readEntries();
    // 읽지 못한 원장 위에 쓰면 기존 기록이 사라진다. 이번 한 건을 포기하는 쪽이 싸다.
    if (existing === null) return false;
    return writeLedger(pruneEntries([...existing, entry], now));
  } catch {
    // 사생활 보호 모드·확장 프로그램 간섭 등 예상 못 한 저장소 예외.
    return false;
  }
}

/**
 * 원장에 쌓인 기록을 시간순(오래된 것 먼저)으로 돌려준다.
 * @returns {UsageEntry[]}
 */
export function getUsageEntries() {
  return readEntries() ?? [];
}

/** 원장을 비운다. 학습 데이터는 건드리지 않는다. */
export function clearUsageLedger() {
  try {
    clearProgress(USAGE_LEDGER_KEY);
  } catch {
    // 지우지 못해도 알릴 것이 없다 — 다음 쓰기에서 상한이 다시 조인다.
  }
}

// ─── 집계 ───

function emptySummary() {
  return {
    calls: 0,
    okCalls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

function addTo(target, entry) {
  target.calls += 1;
  if (entry.ok) target.okCalls += 1;
  else target.failedCalls += 1;
  target.inputTokens += entry.inputTokens;
  target.outputTokens += entry.outputTokens;
  target.cacheReadTokens += entry.cacheReadTokens;
  target.cacheCreationTokens += entry.cacheCreationTokens;
  target.costUsd += entry.costUsd;
}

/**
 * 캐시 적중률 = 캐시에서 읽은 입력 / 전체 입력.
 *
 * Anthropic 의 세 입력 토큰(`input`·`cache_read`·`cache_creation`)은 서로 겹치지 않으므로
 * 셋의 합이 분모다. **캐시를 만드느라 쓴 토큰은 적중이 아니다** — 첫 호출은 비용을
 * 오히려 더 쓰고, 그걸 적중으로 세면 캐시가 듣는지 안 듣는지 알 수 없어진다.
 *
 * 입력이 하나도 없으면 `null` 이다. 0% 와 "잴 것이 없음"은 다른 상태다.
 */
function cacheHitRate(totals) {
  const denominator = totals.inputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;
  return denominator === 0 ? null : totals.cacheReadTokens / denominator;
}

/**
 * 기록을 기간으로 잘라 합계를 낸다.
 *
 * @param {UsageEntry[]} entries
 * @param {{since?: number, until?: number}} [range] ms 타임스탬프. 둘 다 포함(inclusive)
 * @returns {UsageSummary}
 */
export function summarizeUsage(entries, range = {}) {
  const totals = emptySummary();
  /** @type {Record<string, ReturnType<typeof emptySummary>>} */
  const byEndpoint = {};
  const { since, until } = range;
  const bounded = since !== undefined || until !== undefined;

  if (Array.isArray(entries)) {
    for (const raw of entries) {
      const entry = normalizeCostEntry(raw);
      if (!entry) continue;

      if (bounded) {
        // 정규화는 읽을 수 없는 ts 를 "지금"으로 고친다. 그 값으로 기간을 가르면
        // 깨진 기록이 조용히 오늘 칸에 들어가 오늘 비용을 부풀린다 — 원본으로 판단한다.
        const at = parseTs(raw.ts);
        if (!Number.isFinite(at)) continue;
        if (since !== undefined && at < since) continue;
        if (until !== undefined && at > until) continue;
      }

      addTo(totals, entry);
      if (!byEndpoint[entry.endpoint]) byEndpoint[entry.endpoint] = emptySummary();
      addTo(byEndpoint[entry.endpoint], entry);
    }
  }

  const decorated = {};
  for (const [name, bucket] of Object.entries(byEndpoint)) {
    decorated[name] = { ...bucket, cacheHitRate: cacheHitRate(bucket), byEndpoint: {} };
  }
  return { ...totals, cacheHitRate: cacheHitRate(totals), byEndpoint: decorated };
}

/** 로컬 날짜 기준 오늘 00:00 의 ms 타임스탬프 */
function startOfLocalDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 화면이 쓰는 세 기간 합계.
 *
 * "이번 주"는 대시보드의 주간 학습 시간(`getWeeklyStudyTime`)과 같은 창(오늘 포함 7일)이다 —
 * 같은 화면에서 두 개의 "이번 주"가 다른 뜻이면 안 된다.
 *
 * @param {{now?: number, entries?: UsageEntry[]}} [options]
 * @returns {{today: UsageSummary, week: UsageSummary, all: UsageSummary,
 *            hasRecords: boolean, entryCount: number, dateKey: string}}
 */
export function getUsageSummaries(options = {}) {
  const now = options.now ?? Date.now();
  const entries = options.entries ?? getUsageEntries();
  const todayStart = startOfLocalDay(now);

  return {
    today: summarizeUsage(entries, { since: todayStart }),
    week: summarizeUsage(entries, { since: todayStart - 6 * DAY_MS }),
    all: summarizeUsage(entries),
    hasRecords: entries.length > 0,
    entryCount: entries.length,
    dateKey: toLocalDateKey(new Date(now)),
  };
}

// ─── 내보내기 ───

/**
 * 내보내기 봉투를 만든다. `scripts/usage-report.mjs` 가 먹는 형식이다.
 *
 * @param {{now?: number}} [options]
 * @returns {{schema: string, exportedAt: string, entryCount: number, entries: UsageEntry[]}}
 */
export function buildUsageExport(options = {}) {
  const entries = getUsageEntries();
  return {
    schema: USAGE_EXPORT_SCHEMA,
    exportedAt: new Date(options.now ?? Date.now()).toISOString(),
    entryCount: entries.length,
    entries,
  };
}

/**
 * 내보낸 봉투(또는 맨 배열)를 다시 기록 배열로 읽는다.
 * 읽을 수 없으면 빈 배열 — 가져오기가 앱을 죽이면 안 된다.
 *
 * @param {unknown} input JSON 문자열 · 봉투 객체 · 기록 배열
 * @returns {UsageEntry[]}
 */
export function parseUsageExport(input) {
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(payload) ? payload : payload?.entries;
  if (!Array.isArray(list)) return [];
  const entries = [];
  for (const item of list) {
    const entry = normalizeCostEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * 원장을 JSON 파일로 내려받는다.
 * 대시보드 "학습 데이터 내보내기"와 같은 방식(Blob → object URL → 앵커 클릭)이다.
 *
 * @returns {string} 내려받은 파일 이름
 */
export function downloadUsageLedger() {
  const now = Date.now();
  const payload = buildUsageExport({ now });
  const filename = `jungchogi_usage_${toLocalDateKey(new Date(now))}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}
