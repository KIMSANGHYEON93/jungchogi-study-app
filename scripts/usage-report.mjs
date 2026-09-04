#!/usr/bin/env node
// AI 사용량·비용 리포트 (블루프린트 §5 Phase 5 완료 조건 · §6).
//
// **API 키가 필요 없다.** 이미 남은 기록을 읽어 집계할 뿐이라 `npm test` 안에서
// 그대로 검증된다 (`tests/usage-report.test.js`).
//
// 입력 — 둘 다 받는다:
//   1) 프론트 원장이 내보낸 JSON  : 배열이거나 `{records:[…]}` / `{entries:[…]}` 래퍼
//   2) Vercel 로그를 긁은 JSONL   : 한 줄에 사용 기록 하나. 로그 수집기가 앞에 붙인
//                                   타임스탬프·레벨은 알아서 넘긴다.
//
// 사용법:
//   node scripts/usage-report.mjs claudedocs/usage-2026-09.jsonl
//   vercel logs --json | node scripts/usage-report.mjs          # stdin 도 받는다
//   node scripts/usage-report.mjs a.jsonl b.json --json --out claudedocs/usage.json
//
// 집계 원칙은 `lib/ai/usage.js` 와 같다 — **"모름" 을 0 으로 세지 않는다.**
// 비용을 모르는 기록은 총액에서 빼고 따로 세며, 아는 항목만 더한 하한을 함께 낸다.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  ENDPOINTS,
  PRICING,
  PRICING_AS_OF,
  PRICING_SOURCE,
  DEFAULT_MODEL,
  TOKEN_FIELDS,
  calculateCost,
  normalizeUsage,
  pricingAgeMonths,
} from '../lib/ai/usage.js';

/**
 * 블루프린트 §6 의 회당 비용 추정치 (**실측 전 추정치**).
 * 리포트는 이 값과 실측을 나란히 놓는다 — 추정이 틀렸다면 그게 가장 쓸모 있는 정보다.
 */
export const BLUEPRINT_ESTIMATES = Object.freeze({
  tutor: { usd: 0.01, label: '약 $0.01', note: '§6 오답 해설' },
  grade: { usd: 0.01, label: '약 $0.01', note: '§6 채점' },
  plan: { usd: 0.075, label: '약 $0.05–0.10', note: '§6 플래너(도구 6회 가정)' },
  // .env.example 17~20항: quiz100 100문항 × 변형 2 = 200건 ≈ $4 (Batch 할인 반영)
  generate: { usd: 0.02, label: '약 $0.02', note: '.env.example 변형 생성 추정' },
});

/** 달러 값의 부동소수 잔재를 없앤다 (lib/ai/usage.js 와 같은 자릿수) */
const roundUsd = (value) => {
  const scaled = value * 1e8;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) return value;
  return Math.round(scaled) / 1e8;
};

// ─────────────────────────────────────────────────────────────────────────────
// 입력 파싱
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사용 기록으로 볼 수 있는가.
 *
 * 다른 구조화 로그가 섞여 들어와도 걸러야 하므로 **계약된 endpoint** 와
 * **읽을 수 있는 ts** 를 요구한다. 일자별 집계가 ts 에 걸려 있어 ts 가 깨진 기록은
 * 조용히 오늘로 몰아넣는 것보다 버리는 편이 정직하다.
 * @param {unknown} value
 * @returns {string|null} 문제가 없으면 null, 있으면 이유
 */
export function usageRecordProblem(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return '사용 기록이 아닙니다 (객체가 아님).';
  }
  if (!ENDPOINTS.includes(value.endpoint)) {
    return `사용 기록이 아닙니다 (endpoint=${JSON.stringify(value.endpoint ?? null)}).`;
  }
  if (typeof value.ts !== 'string' || Number.isNaN(Date.parse(value.ts))) {
    return `사용 기록이 아닙니다 (ts=${JSON.stringify(value.ts ?? null)} 를 읽을 수 없음).`;
  }
  return null;
}

/** 래퍼 객체에서 기록 배열을 꺼낸다 (프론트 원장 내보내기 형태가 아직 확정 전이라 넉넉히 받는다) */
function unwrap(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ['records', 'entries', 'usage', 'items', 'log']) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return null;
}

/**
 * 입력 텍스트에서 사용 기록을 뽑는다. **던지지 않는다** — 깨진 줄은 이유와 함께 남긴다.
 * @param {string} text
 * @returns {{records: object[], skipped: Array<{line: number, reason: string}>}}
 */
export function parseRecords(text) {
  const records = [];
  const skipped = [];
  const source = typeof text === 'string' ? text : '';

  if (source.trim() === '') return { records, skipped };

  // 1) 통째로 JSON 인가 (원장 내보내기 · pretty-print 된 배열)
  let whole = null;
  try {
    whole = JSON.parse(source);
  } catch {
    whole = undefined; // JSONL 로 다시 본다
  }

  if (whole !== undefined) {
    const list = unwrap(whole) ?? (whole !== null && typeof whole === 'object' ? [whole] : null);
    if (list === null) {
      skipped.push({ line: 1, reason: '사용 기록을 담은 JSON 이 아닙니다.' });
      return { records, skipped };
    }
    list.forEach((candidate, index) => {
      const problem = usageRecordProblem(candidate);
      if (problem) skipped.push({ line: index + 1, reason: problem });
      else records.push(candidate);
    });
    return { records, skipped };
  }

  // 2) JSONL — 한 줄에 기록 하나. 로그 수집기가 앞에 붙인 텍스트는 넘긴다.
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;

    const start = raw.indexOf('{');
    if (start === -1) {
      skipped.push({ line, reason: 'JSON 이 없는 줄입니다.' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.slice(start));
    } catch (error) {
      skipped.push({ line, reason: `JSON 으로 읽지 못했습니다: ${error.message}` });
      return;
    }

    const problem = usageRecordProblem(parsed);
    if (problem) skipped.push({ line, reason: problem });
    else records.push(parsed);
  });

  return { records, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// 집계
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 최근접 순위(nearest-rank) 백분위. 표본이 하나면 p50 도 p95 도 그 값이다.
 * @param {number[]} values
 * @param {number} p 0~100
 * @returns {number|null} 표본이 없으면 null (0 이 아니다)
 */
export function percentile(values, p) {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * 일자 버킷은 앱과 같은 **한국 시간** 기준이다
 * (학습 시간·계획 날짜가 전부 로컬 기준이라 UTC 로 자르면 하루가 어긋난다).
 * @param {string} ts ISO 8601
 * @returns {string} YYYY-MM-DD
 */
export function seoulDate(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/** 빈 집계 통 */
function emptyGroup() {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    failureRate: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    tokenSamples: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    unknownTokenCalls: 0,
    costUsd: 0,
    costAtLeastUsd: 0,
    costKnownCalls: 0,
    costUnknownCalls: 0,
    avgCostUsd: null,
    cacheReadForRate: 0,
    inputForRate: 0,
    cacheHitSamples: 0,
    cacheHitRate: null,
    latencies: [],
    latency: { p50: null, p95: null, count: 0 },
    errorCodes: {},
  };
}

/** 기록 하나를 계약 필드로 정리한다 (문자열 숫자·누락을 여기서 흡수한다) */
function normalizeRecord(raw) {
  const tally = normalizeUsage(raw);
  const model = typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model : DEFAULT_MODEL;
  const cost = calculateCost(tally, { model });

  return {
    ts: raw.ts,
    date: seoulDate(raw.ts),
    endpoint: raw.endpoint,
    model,
    effort: raw.effort ?? null,
    tally,
    costUsd: typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd) ? raw.costUsd : null,
    costAtLeastUsd: cost.usdAtLeast,
    latencyMs:
      typeof raw.latencyMs === 'number' && Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
    ok: raw.ok !== false,
    errorCode: typeof raw.errorCode === 'string' && raw.errorCode !== '' ? raw.errorCode : null,
  };
}

function addToGroup(group, record) {
  group.calls += 1;
  if (record.ok) group.ok += 1;
  else {
    group.failed += 1;
    const code = record.errorCode ?? 'UNKNOWN';
    group.errorCodes[code] = (group.errorCodes[code] ?? 0) + 1;
  }

  for (const field of TOKEN_FIELDS) {
    const value = record.tally[field];
    if (value === null) continue; // 모르는 값은 **더하지 않는다**
    group.tokens[field] += value;
    group.tokenSamples[field] += 1;
  }
  if (record.tally.unknownFields.length > 0) group.unknownTokenCalls += 1;

  if (record.costUsd === null) {
    group.costUnknownCalls += 1;
    group.costAtLeastUsd += record.costAtLeastUsd ?? 0;
  } else {
    group.costKnownCalls += 1;
    group.costUsd += record.costUsd;
    group.costAtLeastUsd += record.costUsd;
  }

  // 캐시 적중률은 입력·캐시읽기를 **둘 다 아는** 기록으로만 잰다
  if (record.tally.inputTokens !== null && record.tally.cacheReadTokens !== null) {
    group.inputForRate += record.tally.inputTokens;
    group.cacheReadForRate += record.tally.cacheReadTokens;
    group.cacheHitSamples += 1;
  }

  if (record.latencyMs !== null) group.latencies.push(record.latencyMs);
}

function finishGroup(group) {
  group.failureRate = group.calls === 0 ? 0 : group.failed / group.calls;
  group.costUsd = roundUsd(group.costUsd);
  group.costAtLeastUsd = roundUsd(group.costAtLeastUsd);
  group.avgCostUsd = group.costKnownCalls === 0 ? null : roundUsd(group.costUsd / group.costKnownCalls);

  const denominator = group.inputForRate + group.cacheReadForRate;
  group.cacheHitRate = denominator === 0 ? null : group.cacheReadForRate / denominator;

  group.latency = {
    p50: percentile(group.latencies, 50),
    p95: percentile(group.latencies, 95),
    count: group.latencies.length,
  };
  delete group.latencies;
  return group;
}

/**
 * 엔드포인트별·일자별 집계를 만든다.
 * @param {object[]} rawRecords `parseRecords` 가 낸 기록 (또는 같은 모양의 객체)
 * @returns {object}
 */
export function summarize(rawRecords) {
  const records = rawRecords.map(normalizeRecord);

  const totals = emptyGroup();
  /** @type {Record<string, object>} */
  const byEndpoint = {};
  /** @type {Record<string, object>} */
  const byDate = {};
  const unknownModels = new Set();

  for (const record of records) {
    if (!PRICING[record.model]) unknownModels.add(record.model);

    addToGroup(totals, record);
    byEndpoint[record.endpoint] ??= emptyGroup();
    addToGroup(byEndpoint[record.endpoint], record);
    byDate[record.date] ??= emptyGroup();
    addToGroup(byDate[record.date], record);
  }

  finishGroup(totals);
  for (const group of Object.values(byEndpoint)) finishGroup(group);
  for (const group of Object.values(byDate)) finishGroup(group);

  const dates = Object.keys(byDate).sort();

  return {
    totals,
    byEndpoint,
    byDate,
    span: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    unknownModels: [...unknownModels],
    pricingAsOf: PRICING_AS_OF,
    recordCount: records.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────────────────────────

const usd = (value) => {
  if (value === null) return '모름';
  if (value === 0) return '$0';
  return Math.abs(value) < 0.0001 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
};

const pct = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
const ms = (value) => (value === null ? '—' : `${Math.round(value).toLocaleString('en-US')}ms`);
const int = (value) => value.toLocaleString('en-US');

/**
 * 터미널에서 차지하는 칸 수. 한글·CJK 는 두 칸이라 `padEnd` 로는 표가 어긋난다.
 * @param {string} text
 * @returns {number}
 */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    width += WIDE_CHAR.test(ch) ? 2 : 1;
  }
  return width;
}

const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/** 열 너비를 맞춰 표 한 줄을 만든다 */
function row(cells, widths) {
  return cells.map((cell, i) => pad(String(cell), widths[i])).join('  ').trimEnd();
}

function groupTable(title, entries, keyLabel) {
  const widths = [12, 6, 8, 12, 12, 10, 10, 10];
  const lines = [
    `■ ${title}`,
    `  ${row([keyLabel, '호출', '실패율', '비용 합계', '회당 평균', '캐시적중', 'p50', 'p95'], widths)}`,
  ];

  for (const [key, group] of entries) {
    lines.push(
      `  ${row(
        [
          key,
          int(group.calls),
          pct(group.failureRate),
          usd(group.costUsd),
          usd(group.avgCostUsd),
          pct(group.cacheHitRate),
          ms(group.latency.p50),
          ms(group.latency.p95),
        ],
        widths
      )}`
    );
  }
  return lines;
}

/**
 * 사람이 읽는 리포트를 만든다.
 * @param {ReturnType<typeof summarize>} summary
 * @param {{now?: Date, skipped?: Array<{line: number, reason: string}>, sources?: string[]}} [options]
 * @returns {string}
 */
export function formatReport(summary, options = {}) {
  const now = options.now ?? new Date();
  const skipped = options.skipped ?? [];
  const age = pricingAgeMonths(now);

  const lines = [
    'jungchogi-app AI 사용량·비용 리포트',
    `가격표 기준일 ${PRICING_AS_OF} · ${PRICING_SOURCE}`,
  ];

  if (age >= 6) {
    lines.push(
      `⚠️ 가격표가 ${age}개월 전(${PRICING_AS_OF}) 기준입니다. ` +
        'lib/ai/usage.js 의 PRICING 을 확인하고 갱신하세요 — 오래된 단가로 낸 수치입니다.'
    );
  }
  if (options.sources?.length) lines.push(`입력: ${options.sources.join(', ')}`);

  if (summary.recordCount === 0) {
    lines.push('', '기록이 없습니다. 입력 파일에 사용 기록이 한 건도 없습니다.');
    if (skipped.length > 0) lines.push(`건너뛴 줄 ${skipped.length}건:`);
    for (const item of skipped.slice(0, 10)) lines.push(`  ${item.line}번째 줄 — ${item.reason}`);
    return lines.join('\n');
  }

  const { totals } = summary;
  lines.push(
    `기간 ${summary.span.from} ~ ${summary.span.to} · 기록 ${int(summary.recordCount)}건 · 건너뛴 줄 ${skipped.length}건`,
    ''
  );

  if (summary.unknownModels.length > 0) {
    lines.push(
      `⚠️ 가격표에 없는 모델이 섞여 있습니다: ${summary.unknownModels.join(', ')} — ` +
        '그 기록의 비용은 계산하지 않았습니다.',
      ''
    );
  }

  lines.push(
    '■ 전체',
    `  호출 ${int(totals.calls)} · 성공 ${int(totals.ok)} · 실패 ${int(totals.failed)} (${pct(totals.failureRate)})`,
    `  비용 합계 ${usd(totals.costUsd)} — 총액을 아는 기록 ${int(totals.costKnownCalls)}/${int(totals.calls)}건`,
    `  비용 하한 ${usd(totals.costAtLeastUsd)} — 모름인 항목을 뺀 값이라 실제는 이보다 크거나 같다`,
    `  회당 평균 ${usd(totals.avgCostUsd)}`,
    `  토큰 입력 ${int(totals.tokens.inputTokens)} · 출력 ${int(totals.tokens.outputTokens)} · ` +
      `캐시읽기 ${int(totals.tokens.cacheReadTokens)} · 캐시쓰기 ${int(totals.tokens.cacheCreationTokens)}`,
    `  캐시 적중률 ${pct(totals.cacheHitRate)} — 캐시읽기 / (캐시읽기 + 입력), ` +
      `입력·캐시읽기를 둘 다 아는 ${int(totals.cacheHitSamples)}/${int(totals.calls)}건으로 잰 값`,
    `  토큰 항목을 하나라도 모르는 기록 ${int(totals.unknownTokenCalls)}건`,
    `  지연 p50 ${ms(totals.latency.p50)} · p95 ${ms(totals.latency.p95)} (표본 ${int(totals.latency.count)}건)`,
    ''
  );

  if (Object.keys(totals.errorCodes).length > 0) {
    const codes = Object.entries(totals.errorCodes)
      .map(([code, count]) => `${code} ${count}`)
      .join(' · ');
    lines.push(`  실패 코드: ${codes}`, '');
  }

  const endpointOrder = ENDPOINTS.filter((name) => summary.byEndpoint[name]);
  lines.push(
    ...groupTable(
      '엔드포인트별',
      endpointOrder.map((name) => [name, summary.byEndpoint[name]]),
      '엔드포인트'
    ),
    ''
  );

  lines.push(
    ...groupTable(
      '일자별 (한국 시간)',
      Object.keys(summary.byDate)
        .sort()
        .map((date) => [date, summary.byDate[date]]),
      '날짜'
    ),
    ''
  );

  // 블루프린트 §6 추정치와 나란히 — 추정이 틀렸다면 그게 가장 쓸모 있는 정보다.
  lines.push('■ 블루프린트 §6 추정 대비 실측 (회당)');
  for (const name of endpointOrder) {
    const group = summary.byEndpoint[name];
    const estimate = BLUEPRINT_ESTIMATES[name];
    if (!estimate) {
      lines.push(`  ${pad(name, 9)} 추정 없음 · 실측 ${usd(group.avgCostUsd)}`);
      continue;
    }
    const measured = group.avgCostUsd;
    const ratio = measured === null || estimate.usd === 0 ? null : measured / estimate.usd;
    const verdict =
      ratio === null
        ? '실측 없음'
        : ratio >= 1
          ? `추정의 ${ratio.toFixed(1)}× — 추정보다 비싸다`
          : `추정의 ${ratio.toFixed(1)}× — 추정보다 싸다`;
    lines.push(
      `  ${pad(name, 9)} 추정 ${pad(estimate.label, 16)} 실측 ${pad(usd(measured), 12)} ${verdict}`
    );
  }
  lines.push('', `  (추정 출처: ${Object.values(BLUEPRINT_ESTIMATES)[0].note} 등 블루프린트 §6)`);

  if (skipped.length > 0) {
    lines.push('', `■ 건너뛴 줄 ${skipped.length}건`);
    for (const item of skipped.slice(0, 10)) lines.push(`  ${item.line}번째 줄 — ${item.reason}`);
    if (skipped.length > 10) lines.push(`  … 그 밖 ${skipped.length - 10}건`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{text: string, sources: string[], asJson: boolean, out: string|null}}
 */
export function readInputs(argv) {
  const files = [];
  let asJson = false;
  let out = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') asJson = true;
    else if (arg === '--out') out = argv[++i] ?? null;
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (!arg.startsWith('--')) files.push(arg);
  }

  const parts = files.map((file) => readFileSync(file, 'utf8'));
  return {
    text: files.length > 0 ? parts.join('\n') : readStdin(),
    sources: files.length > 0 ? files : ['(stdin)'],
    asJson,
    out,
  };
}

/**
 * @param {string[]} argv
 * @returns {number} 프로세스 종료 코드
 */
export function main(argv) {
  let input;
  try {
    input = readInputs(argv);
  } catch (error) {
    console.error(`입력을 읽지 못했습니다: ${error.message}`);
    return 1;
  }

  const { records, skipped } = parseRecords(input.text);
  const summary = summarize(records);

  const output = input.asJson
    ? JSON.stringify({ ...summary, skipped, sources: input.sources }, null, 2)
    : formatReport(summary, { skipped, sources: input.sources });

  if (input.out) {
    writeFileSync(input.out, `${output}\n`, 'utf8');
    console.log(`리포트를 ${input.out} 에 썼습니다.`);
  } else {
    console.log(output);
  }
  return 0;
}

// 직접 실행할 때만 돈다 (테스트가 import 해도 부작용이 없다).
// `pathToFileURL` 을 써야 Windows 드라이브 문자에서도 비교가 맞는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
