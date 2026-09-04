// scripts/usage-report.mjs — 비용 리포트 (블루프린트 §5 Phase 5 완료 조건).
//
// **API 키가 필요 없는 순수 계산이다.** 입력은 프론트 원장이 내보낸 JSON 이거나
// Vercel 로그를 긁은 JSONL 이고, 출력은 엔드포인트별·일자별 집계다.
//
// 여기서 덮는 경우의 수:
//   빈 입력 · 기록 1건(p50/p95) · 깨진 줄 섞임 · 여러 날짜·엔드포인트 혼재 ·
//   캐시 적중률 0%/100% · 비용을 모르는 기록 · 지연을 모르는 기록 ·
//   원장 내보내기 포맷(배열/래퍼)과 로그 프리픽스가 붙은 JSONL.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  parseRecords,
  percentile,
  seoulDate,
  summarize,
  formatReport,
  main,
  BLUEPRINT_ESTIMATES,
} from '../scripts/usage-report.mjs';

/** 계약된 사용 기록 하나 */
const rec = (overrides = {}) => ({
  ts: '2026-09-04T12:00:00.000Z',
  endpoint: 'tutor',
  model: 'claude-opus-5',
  effort: 'low',
  inputTokens: 1_000,
  outputTokens: 500,
  cacheReadTokens: 10_000,
  cacheCreationTokens: 2_000,
  costUsd: 0.035,
  latencyMs: 1_000,
  ok: true,
  errorCode: null,
  ...overrides,
});

const jsonl = (...records) => records.map((r) => JSON.stringify(r)).join('\n');

describe('parseRecords — 입력 형식', () => {
  it('JSONL 한 줄씩 읽는다 (Vercel 로그를 긁은 경우)', () => {
    const { records, skipped } = parseRecords(jsonl(rec(), rec({ endpoint: 'grade' })));
    expect(records).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it('JSON 배열도 읽는다 (프론트 원장 내보내기)', () => {
    const { records } = parseRecords(JSON.stringify([rec(), rec()]));
    expect(records).toHaveLength(2);
  });

  it('{ records: [...] } 래퍼도 읽는다', () => {
    const { records } = parseRecords(JSON.stringify({ exportedAt: 'x', records: [rec()] }));
    expect(records).toHaveLength(1);
  });

  it('{ entries: [...] } 래퍼도 읽는다', () => {
    const { records } = parseRecords(JSON.stringify({ entries: [rec()] }));
    expect(records).toHaveLength(1);
  });

  it('로그 수집기가 앞에 붙인 타임스탬프를 넘기고 JSON 을 찾는다', () => {
    const line = `2026-09-04T12:00:00.123Z  INFO  ${JSON.stringify(rec())}`;
    const { records, skipped } = parseRecords(line);
    expect(records).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it('빈 입력은 기록 0건이고 오류가 아니다', () => {
    for (const empty of ['', '   ', '\n\n']) {
      const { records, skipped } = parseRecords(empty);
      expect(records).toEqual([]);
      expect(skipped).toEqual([]);
    }
  });

  it('깨진 줄은 건너뛰고 이유와 함께 남긴다', () => {
    const text = [JSON.stringify(rec()), '{ 이건 JSON 이 아니다', '', JSON.stringify(rec())].join(
      '\n'
    );
    const { records, skipped } = parseRecords(text);

    expect(records).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ line: 2 });
    expect(skipped[0].reason).toMatch(/JSON/);
  });

  it('사용 기록이 아닌 JSON 줄도 건너뛴다 (다른 구조화 로그가 섞여도)', () => {
    const text = [JSON.stringify({ level: 'info', msg: 'cold start' }), JSON.stringify(rec())].join(
      '\n'
    );
    const { records, skipped } = parseRecords(text);

    expect(records).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/사용 기록/);
  });

  it('endpoint 가 계약 밖이면 기록으로 보지 않는다', () => {
    const { records, skipped } = parseRecords(jsonl(rec({ endpoint: 'chat' })));
    expect(records).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('ts 가 없거나 읽을 수 없으면 기록으로 보지 않는다 (일자별 집계가 깨진다)', () => {
    const { records } = parseRecords(jsonl(rec({ ts: 'yesterday' }), rec({ ts: undefined })));
    expect(records).toHaveLength(0);
  });

  it('통째로 깨진 입력도 던지지 않고 skipped 로 알린다', () => {
    const { records, skipped } = parseRecords('<html>404</html>');
    expect(records).toEqual([]);
    expect(skipped.length).toBeGreaterThan(0);
  });
});

describe('percentile — 기록이 하나뿐일 때도 답이 있어야 한다', () => {
  it('한 건이면 p50 도 p95 도 그 값이다', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('빈 목록은 null 이다 (0 이 아니다)', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('정렬되지 않은 입력도 받는다', () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(20);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
  });

  it('두 건이면 p50 은 작은 쪽, p95 는 큰 쪽이다', () => {
    expect(percentile([10, 90], 50)).toBe(10);
    expect(percentile([10, 90], 95)).toBe(90);
  });
});

describe('seoulDate — 일자 버킷은 앱과 같은 한국 시간 기준', () => {
  it('UTC 15시는 한국의 다음 날이다', () => {
    expect(seoulDate('2026-09-04T15:30:00.000Z')).toBe('2026-09-05');
  });

  it('UTC 자정은 한국의 같은 날 오전 9시다', () => {
    expect(seoulDate('2026-09-04T00:00:00.000Z')).toBe('2026-09-04');
  });
});

describe('summarize — 빈 입력', () => {
  it('기록이 없으면 빈 집계를 낸다 (던지지 않는다)', () => {
    const summary = summarize([]);

    expect(summary.totals.calls).toBe(0);
    expect(summary.totals.costUsd).toBe(0);
    expect(summary.totals.cacheHitRate).toBeNull();
    expect(summary.totals.latency.p50).toBeNull();
    expect(summary.byEndpoint).toEqual({});
    expect(summary.byDate).toEqual({});
    expect(summary.span).toEqual({ from: null, to: null });
  });

  it('빈 집계도 리포트로 찍힌다', () => {
    const text = formatReport(summarize([]), { now: new Date('2026-09-04T00:00:00Z') });
    expect(text).toContain('기록이 없습니다');
  });
});

describe('summarize — 기록 1건', () => {
  const summary = summarize([rec({ latencyMs: 1_500 })]);

  it('p50 과 p95 가 같은 값이다', () => {
    expect(summary.totals.latency.p50).toBe(1_500);
    expect(summary.totals.latency.p95).toBe(1_500);
  });

  it('호출 수·비용·실패율을 낸다', () => {
    expect(summary.totals.calls).toBe(1);
    expect(summary.totals.costUsd).toBe(0.035);
    expect(summary.totals.failureRate).toBe(0);
  });

  it('엔드포인트별·일자별로도 같은 값이 잡힌다', () => {
    expect(summary.byEndpoint.tutor.calls).toBe(1);
    expect(summary.byDate['2026-09-04'].calls).toBe(1);
    expect(summary.span).toEqual({ from: '2026-09-04', to: '2026-09-04' });
  });
});

describe('summarize — 여러 날짜·엔드포인트 혼재', () => {
  const records = [
    rec({ ts: '2026-09-03T01:00:00.000Z', endpoint: 'tutor', latencyMs: 1_000 }),
    rec({ ts: '2026-09-03T02:00:00.000Z', endpoint: 'grade', latencyMs: 2_000, costUsd: 0.01 }),
    rec({ ts: '2026-09-04T03:00:00.000Z', endpoint: 'plan', latencyMs: 9_000, costUsd: 0.08 }),
    rec({
      ts: '2026-09-04T04:00:00.000Z',
      endpoint: 'plan',
      latencyMs: 11_000,
      costUsd: 0.12,
      ok: false,
      errorCode: 'UPSTREAM',
    }),
  ];
  const summary = summarize(records);

  it('엔드포인트별로 호출 수와 비용을 나눈다', () => {
    expect(summary.byEndpoint.plan.calls).toBe(2);
    expect(summary.byEndpoint.plan.costUsd).toBeCloseTo(0.2, 10);
    expect(summary.byEndpoint.grade.costUsd).toBe(0.01);
  });

  it('일자별로도 나눈다 (한국 시간 기준)', () => {
    expect(Object.keys(summary.byDate).sort()).toEqual(['2026-09-03', '2026-09-04']);
    expect(summary.byDate['2026-09-03'].calls).toBe(2);
    expect(summary.byDate['2026-09-04'].calls).toBe(2);
  });

  it('실패율은 엔드포인트별로 따로 센다', () => {
    expect(summary.byEndpoint.plan.failureRate).toBe(0.5);
    expect(summary.byEndpoint.plan.failed).toBe(1);
    expect(summary.byEndpoint.tutor.failureRate).toBe(0);
    expect(summary.totals.failureRate).toBe(0.25);
  });

  it('p50·p95 는 지연 분포에서 뽑는다', () => {
    expect(summary.totals.latency.p50).toBe(2_000);
    expect(summary.totals.latency.p95).toBe(11_000);
    expect(summary.totals.latency.count).toBe(4);
  });

  it('기간을 첫 날과 마지막 날로 잡는다', () => {
    expect(summary.span).toEqual({ from: '2026-09-03', to: '2026-09-04' });
  });
});

describe('summarize — 캐시 적중률', () => {
  it('캐시 읽기 / (캐시 읽기 + 입력) 로 센다', () => {
    const summary = summarize([rec({ inputTokens: 1_000, cacheReadTokens: 9_000 })]);
    expect(summary.totals.cacheHitRate).toBeCloseTo(0.9, 10);
  });

  it('캐시 적중 0% — 캐시를 하나도 못 읽은 경우', () => {
    const summary = summarize([rec({ inputTokens: 5_000, cacheReadTokens: 0 })]);
    expect(summary.totals.cacheHitRate).toBe(0);
  });

  it('캐시 적중 100% — 입력이 전부 캐시에서 온 경우', () => {
    const summary = summarize([rec({ inputTokens: 0, cacheReadTokens: 12_000 })]);
    expect(summary.totals.cacheHitRate).toBe(1);
  });

  it('분모가 0 이면 0% 가 아니라 null 이다 (잴 것이 없다)', () => {
    const summary = summarize([rec({ inputTokens: 0, cacheReadTokens: 0 })]);
    expect(summary.totals.cacheHitRate).toBeNull();
  });

  it('토큰을 모르는 기록은 적중률 계산에서 빼고 그 사실을 센다', () => {
    const summary = summarize([
      rec({ inputTokens: 1_000, cacheReadTokens: 9_000 }),
      rec({ inputTokens: null, cacheReadTokens: null }),
    ]);

    expect(summary.totals.cacheHitRate).toBeCloseTo(0.9, 10); // 아는 기록만으로 잰다
    expect(summary.totals.cacheHitSamples).toBe(1);
    expect(summary.totals.unknownTokenCalls).toBe(1);
  });
});

describe('summarize — "모름" 을 0 으로 세지 않는다', () => {
  const records = [
    rec({ costUsd: 0.035 }),
    rec({ costUsd: null, outputTokens: null }), // 스트림이 끊긴 요청
  ];
  const summary = summarize(records);

  it('총액은 아는 기록만 더한다', () => {
    expect(summary.totals.costUsd).toBe(0.035);
    expect(summary.totals.costKnownCalls).toBe(1);
    expect(summary.totals.costUnknownCalls).toBe(1);
  });

  it('모르는 기록의 아는 항목까지 더한 하한을 함께 낸다', () => {
    // 두 번째 기록: 입력 1000 + 캐시읽기 10000 + 캐시쓰기 2000 (출력만 모름)
    expect(summary.totals.costAtLeastUsd).toBeCloseTo(0.035 + 0.0225, 10);
    expect(summary.totals.costAtLeastUsd).toBeGreaterThan(summary.totals.costUsd);
  });

  it('평균 회당 비용은 아는 기록으로만 낸다', () => {
    expect(summary.totals.avgCostUsd).toBe(0.035);
  });

  it('아는 기록이 하나도 없으면 평균은 null 이다', () => {
    const only = summarize([rec({ costUsd: null })]);
    expect(only.totals.avgCostUsd).toBeNull();
    expect(only.totals.costUsd).toBe(0);
  });

  it('지연을 모르는 기록은 백분위 표본에서 뺀다', () => {
    const summary = summarize([rec({ latencyMs: null }), rec({ latencyMs: 500 })]);
    expect(summary.totals.latency.count).toBe(1);
    expect(summary.totals.latency.p50).toBe(500);
  });

  it('토큰 합계는 아는 값만 더하고 표본 수를 함께 남긴다', () => {
    const summary = summarize([rec({ inputTokens: 1_000 }), rec({ inputTokens: null })]);
    expect(summary.totals.tokens.inputTokens).toBe(2_000 - 1_000);
    expect(summary.totals.tokens.inputTokens).toBe(1_000);
  });

  it('가격표에 없는 모델이 섞이면 그 기록을 따로 센다', () => {
    const summary = summarize([rec(), rec({ model: 'claude-opus-6', costUsd: null })]);
    expect(summary.unknownModels).toEqual(['claude-opus-6']);
  });
});

describe('formatReport — 블루프린트 §6 추정치와 나란히', () => {
  const records = [
    rec({ endpoint: 'tutor', costUsd: 0.035, latencyMs: 1_000 }),
    rec({ endpoint: 'grade', costUsd: 0.012, latencyMs: 2_000 }),
    rec({ endpoint: 'plan', costUsd: 0.3, latencyMs: 20_000 }),
  ];
  const text = formatReport(summarize(records), { now: new Date('2026-09-04T00:00:00Z') });

  it('§6 추정치를 코드가 들고 있다', () => {
    expect(BLUEPRINT_ESTIMATES.tutor.usd).toBe(0.01);
    expect(BLUEPRINT_ESTIMATES.grade.usd).toBe(0.01);
    expect(BLUEPRINT_ESTIMATES.plan.usd).toBe(0.075);
  });

  it('추정과 실측을 같은 줄에 놓는다', () => {
    expect(text).toContain('추정');
    expect(text).toContain('실측');
  });

  it('추정이 크게 빗나가면 배율로 드러낸다', () => {
    // plan 은 추정 $0.075 인데 실측 $0.3 — 4배다
    expect(text).toMatch(/4\.0×|4\.00×|×4/);
  });

  it('엔드포인트별·일자별 절을 모두 낸다', () => {
    expect(text).toContain('엔드포인트별');
    expect(text).toContain('일자별');
  });

  it('캐시 적중률·지연·실패율을 낸다', () => {
    expect(text).toContain('캐시');
    expect(text).toContain('p95');
    expect(text).toContain('실패');
  });

  it('가격표 기준일을 머리글에 밝힌다', () => {
    expect(text).toContain('2026-06');
  });

  it('가격표가 오래되면 경고한다', () => {
    const stale = formatReport(summarize(records), { now: new Date('2027-06-01T00:00:00Z') });
    expect(stale).toMatch(/가격표.*(오래|개월)/);
  });

  it('깨진 줄이 있었다면 몇 줄을 버렸는지 밝힌다', () => {
    const withSkips = formatReport(summarize(records), {
      now: new Date('2026-09-04T00:00:00Z'),
      skipped: [{ line: 3, reason: 'JSON 이 아닙니다' }],
    });
    expect(withSkips).toMatch(/건너뛴 줄.*1|1.*건너뛰/);
  });

  it('비용을 모르는 기록이 있으면 하한을 함께 밝힌다', () => {
    const partial = formatReport(summarize([rec(), rec({ costUsd: null, outputTokens: null })]), {
      now: new Date('2026-09-04T00:00:00Z'),
    });
    expect(partial).toMatch(/모름|하한/);
  });
});

describe('CLI — 파일에서 읽어 리포트를 낸다', () => {
  const dirs = [];
  const workdir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-report-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('JSONL 파일을 읽어 stdout 으로 낸다', () => {
    const dir = workdir();
    const file = join(dir, 'usage.jsonl');
    writeFileSync(file, `${jsonl(rec(), rec({ endpoint: 'plan', costUsd: 0.08 }))}\n`, 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(main([file])).toBe(0);

    const text = log.mock.calls.map(([line]) => line).join('\n');
    expect(text).toContain('기록 2건');
    expect(text).toContain('엔드포인트별');
  });

  it('--json 은 집계를 그대로 JSON 으로 낸다', () => {
    const dir = workdir();
    const file = join(dir, 'usage.jsonl');
    writeFileSync(file, `${jsonl(rec())}\n`, 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(main([file, '--json'])).toBe(0);

    const parsed = JSON.parse(log.mock.calls[0][0]);
    expect(parsed.totals.calls).toBe(1);
    expect(parsed.skipped).toEqual([]);
  });

  it('--out 은 파일로 쓴다', () => {
    const dir = workdir();
    const file = join(dir, 'usage.jsonl');
    const out = join(dir, 'report.txt');
    writeFileSync(file, `${jsonl(rec())}\n`, 'utf8');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(main([file, '--out', out])).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('AI 사용량·비용 리포트');
  });

  it('없는 파일을 주면 던지지 않고 1 로 끝난다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(main([join(workdir(), 'nope.jsonl')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('입력을 읽지 못했습니다'));
  });
});
