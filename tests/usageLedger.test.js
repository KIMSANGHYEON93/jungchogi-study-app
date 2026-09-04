// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  USAGE_LEDGER_KEY,
  USAGE_EXPORT_SCHEMA,
  MAX_LEDGER_ENTRIES,
  LEDGER_RETENTION_DAYS,
  LEDGER_BYTE_BUDGET,
  normalizeCostEntry,
  recordUsage,
  getUsageEntries,
  clearUsageLedger,
  summarizeUsage,
  getUsageSummaries,
  buildUsageExport,
  parseUsageExport,
  downloadUsageLedger,
} from '../src/utils/usageLedger.js';
import { saveProgress, loadProgress } from '../src/utils/storage.js';

const STORAGE_KEY = `jungchogi_${USAGE_LEDGER_KEY}`;
const DAY = 24 * 60 * 60 * 1000;

/** 서버 계약(BLUEPRINT §5 Phase 5)이 보내는 완전한 cost 객체 */
function fullCost(overrides = {}) {
  return {
    ts: '2026-09-04T12:00:00.000Z',
    endpoint: 'tutor',
    model: 'claude-opus-5',
    effort: 'medium',
    inputTokens: 3120,
    outputTokens: 540,
    cacheReadTokens: 24800,
    cacheCreationTokens: 0,
    costUsd: 0.0123,
    latencyMs: 8421,
    ok: true,
    errorCode: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizeCostEntry — cost 가 없거나 망가진 경우', () => {
  it('cost 가 undefined 면 null 을 준다 (서버가 아직 안 보내는 상태)', () => {
    expect(normalizeCostEntry(undefined, { endpoint: 'tutor' })).toBeNull();
  });

  it('cost 가 null 이면 null 을 준다', () => {
    expect(normalizeCostEntry(null, { endpoint: 'tutor' })).toBeNull();
  });

  it('cost 가 객체가 아니면 null 을 준다', () => {
    expect(normalizeCostEntry('0.01', { endpoint: 'tutor' })).toBeNull();
    expect(normalizeCostEntry(0.01, { endpoint: 'tutor' })).toBeNull();
    expect(normalizeCostEntry(true, { endpoint: 'tutor' })).toBeNull();
  });

  it('cost 가 배열이면 null 을 준다', () => {
    expect(normalizeCostEntry([], { endpoint: 'tutor' })).toBeNull();
    expect(normalizeCostEntry([fullCost()], { endpoint: 'tutor' })).toBeNull();
  });

  it('빈 객체도 기록으로 받아들인다 — 호출은 실제로 일어났다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:30:00.000Z'));
    const entry = normalizeCostEntry({}, { endpoint: 'grade' });
    expect(entry).toEqual({
      ts: '2026-09-04T00:30:00.000Z',
      endpoint: 'grade',
      model: null,
      effort: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      latencyMs: null,
      ok: true,
      errorCode: null,
    });
  });
});

describe('normalizeCostEntry — 정상 계약', () => {
  it('완전한 cost 를 필드 그대로 옮긴다', () => {
    expect(normalizeCostEntry(fullCost(), { endpoint: 'tutor' })).toEqual(fullCost());
  });

  it('ok:false 와 errorCode 를 보존한다 — 실패한 호출도 원장에 남는다', () => {
    const entry = normalizeCostEntry(fullCost({ ok: false, errorCode: 'RATE_LIMITED' }), {
      endpoint: 'tutor',
    });
    expect(entry.ok).toBe(false);
    expect(entry.errorCode).toBe('RATE_LIMITED');
  });

  it('effort 는 null 이 허용된 값이다', () => {
    expect(normalizeCostEntry(fullCost({ effort: null }), {}).effort).toBeNull();
  });
});

describe('normalizeCostEntry — 부분 필드 / 타입 어긋남', () => {
  it('일부 필드만 와도 나머지는 기본값으로 채운다', () => {
    const entry = normalizeCostEntry({ costUsd: 0.02, outputTokens: 300 }, { endpoint: 'plan' });
    expect(entry.costUsd).toBe(0.02);
    expect(entry.outputTokens).toBe(300);
    expect(entry.inputTokens).toBe(0);
    expect(entry.cacheReadTokens).toBe(0);
    expect(entry.endpoint).toBe('plan');
    expect(entry.ok).toBe(true);
  });

  it('숫자 자리에 온 숫자 문자열은 숫자로 읽는다', () => {
    const entry = normalizeCostEntry(
      { inputTokens: '1200', outputTokens: '40', costUsd: '0.5', latencyMs: '900' },
      { endpoint: 'grade' }
    );
    expect(entry.inputTokens).toBe(1200);
    expect(entry.outputTokens).toBe(40);
    expect(entry.costUsd).toBe(0.5);
    expect(entry.latencyMs).toBe(900);
  });

  it('숫자로 읽을 수 없는 문자열은 0 으로 접는다', () => {
    const entry = normalizeCostEntry(
      { inputTokens: '많음', outputTokens: '', costUsd: 'free' },
      { endpoint: 'grade' }
    );
    expect(entry.inputTokens).toBe(0);
    expect(entry.outputTokens).toBe(0);
    expect(entry.costUsd).toBe(0);
  });

  it('음수·NaN·Infinity 는 0 으로 접는다 — 합계를 조용히 깎으면 안 된다', () => {
    const entry = normalizeCostEntry(
      { inputTokens: -5, outputTokens: NaN, costUsd: Infinity, cacheReadTokens: -0.1 },
      { endpoint: 'tutor' }
    );
    expect(entry.inputTokens).toBe(0);
    expect(entry.outputTokens).toBe(0);
    expect(entry.costUsd).toBe(0);
    expect(entry.cacheReadTokens).toBe(0);
  });

  it('latencyMs 는 읽을 수 없으면 null 이다 (0ms 와 구분한다)', () => {
    expect(normalizeCostEntry({ latencyMs: 'x' }, {}).latencyMs).toBeNull();
    expect(normalizeCostEntry({ latencyMs: 0 }, {}).latencyMs).toBe(0);
  });

  it('ok 가 명시적으로 false 일 때만 실패로 본다', () => {
    expect(normalizeCostEntry({ ok: 'false' }, {}).ok).toBe(true);
    expect(normalizeCostEntry({ ok: 0 }, {}).ok).toBe(true);
    expect(normalizeCostEntry({ ok: false }, {}).ok).toBe(false);
  });

  it('모르는 endpoint 는 호출부가 아는 endpoint 로 되돌린다', () => {
    expect(normalizeCostEntry({ endpoint: 'summarize' }, { endpoint: 'tutor' }).endpoint).toBe('tutor');
    expect(normalizeCostEntry({ endpoint: 42 }, { endpoint: 'plan' }).endpoint).toBe('plan');
  });

  it('endpoint 를 양쪽 다 모르면 unknown 으로 둔다', () => {
    expect(normalizeCostEntry({}, {}).endpoint).toBe('unknown');
    expect(normalizeCostEntry({ endpoint: 'summarize' }, { endpoint: 'nope' }).endpoint).toBe('unknown');
  });

  it('계약 밖 effort 는 null 로 접는다', () => {
    expect(normalizeCostEntry({ effort: 'extreme' }, {}).effort).toBeNull();
    expect(normalizeCostEntry({ effort: 3 }, {}).effort).toBeNull();
  });

  it('읽을 수 없는 ts 는 지금 시각으로 대체한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:30:00.000Z'));
    expect(normalizeCostEntry({ ts: 'yesterday' }, {}).ts).toBe('2026-09-04T00:30:00.000Z');
    expect(normalizeCostEntry({ ts: 12345 }, {}).ts).toBe('2026-09-04T00:30:00.000Z');
  });

  it('model 문자열은 길이를 잘라 담는다 — 서버가 이상한 값을 보내도 원장이 붓지 않게', () => {
    const entry = normalizeCostEntry({ model: 'x'.repeat(500) }, {});
    expect(entry.model.length).toBeLessThanOrEqual(64);
  });

  it('model 이 문자열이 아니면 null 이다', () => {
    expect(normalizeCostEntry({ model: { name: 'opus' } }, {}).model).toBeNull();
    expect(normalizeCostEntry({ model: '   ' }, {}).model).toBeNull();
  });
});

describe('normalizeCostEntry — 모르는 미래 필드', () => {
  it('모르는 필드가 더 붙어도 기록은 정상으로 만든다', () => {
    const entry = normalizeCostEntry(
      fullCost({ serviceTier: 'batch', thinkingTokens: 900, region: 'us-east' }),
      { endpoint: 'tutor' }
    );
    expect(entry.costUsd).toBe(0.0123);
    expect(entry.inputTokens).toBe(3120);
  });

  it('모르는 필드는 원장에 담지 않는다 — 저장 용량은 계약이 정한 필드만 쓴다', () => {
    const entry = normalizeCostEntry(fullCost({ serviceTier: 'batch', blob: 'x'.repeat(5000) }), {
      endpoint: 'tutor',
    });
    expect(Object.keys(entry).sort()).toEqual(Object.keys(fullCost()).sort());
    expect(JSON.stringify(entry)).not.toContain('xxxx');
  });
});

describe('recordUsage', () => {
  it('cost 가 없으면 아무것도 남기지 않는다 — "기록 없음"이 정상 상태다', () => {
    expect(recordUsage(undefined, { endpoint: 'tutor' })).toBe(false);
    expect(recordUsage(null, { endpoint: 'tutor' })).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getUsageEntries()).toEqual([]);
  });

  it('jungchogi_ 접두사 키에 append 한다', () => {
    expect(recordUsage(fullCost(), { endpoint: 'tutor' })).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(USAGE_LEDGER_KEY)).toBeNull();
    expect(getUsageEntries()).toHaveLength(1);
  });

  it('여러 번 부르면 시간순으로 쌓인다', () => {
    recordUsage(fullCost({ ts: '2026-09-01T00:00:00.000Z', endpoint: 'tutor' }), {});
    recordUsage(fullCost({ ts: '2026-09-02T00:00:00.000Z', endpoint: 'grade' }), {});
    const entries = getUsageEntries();
    expect(entries.map((e) => e.endpoint)).toEqual(['tutor', 'grade']);
  });

  it('실패한 호출도 남긴다', () => {
    recordUsage(fullCost({ ok: false, errorCode: 'UPSTREAM', costUsd: 0 }), { endpoint: 'grade' });
    expect(getUsageEntries()[0]).toMatchObject({ ok: false, errorCode: 'UPSTREAM' });
  });

  it('저장값이 손상돼 있으면 빈 원장에서 다시 시작한다', () => {
    localStorage.setItem(STORAGE_KEY, '{ 이건 JSON 이 아니다');
    expect(recordUsage(fullCost(), { endpoint: 'tutor' })).toBe(true);
    expect(getUsageEntries()).toHaveLength(1);
  });

  it('저장값이 배열이 아니면 빈 원장에서 다시 시작한다', () => {
    saveProgress(USAGE_LEDGER_KEY, { entries: 'nope' });
    expect(recordUsage(fullCost(), { endpoint: 'tutor' })).toBe(true);
    expect(getUsageEntries()).toHaveLength(1);
  });

  it('localStorage 읽기가 던져도 예외를 밖으로 내보내지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => recordUsage(fullCost(), { endpoint: 'tutor' })).not.toThrow();
    expect(recordUsage(fullCost(), { endpoint: 'tutor' })).toBe(false);
  });

  it('localStorage 쓰기가 용량 초과가 아닌 예외로 던져도 밖으로 내보내지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => recordUsage(fullCost(), { endpoint: 'tutor' })).not.toThrow();
  });
});

describe('원장 상한', () => {
  it('상한은 5 MB 표시의 5% 안에 든다', () => {
    const entries = Array.from({ length: MAX_LEDGER_ENTRIES }, (_, i) =>
      normalizeCostEntry(fullCost({ ok: false, errorCode: 'RATE_LIMITED', latencyMs: 10000 + i }), {})
    );
    const bytes = JSON.stringify(entries).length * 2;
    expect(bytes).toBeLessThanOrEqual(LEDGER_BYTE_BUDGET);
    expect(LEDGER_BYTE_BUDGET).toBeLessThanOrEqual(5 * 1024 * 1024 * 0.05);
  });

  it(`건수가 ${MAX_LEDGER_ENTRIES} 를 넘으면 오래된 것부터 버린다`, () => {
    const stored = Array.from({ length: MAX_LEDGER_ENTRIES + 20 }, (_, i) =>
      fullCost({ ts: new Date(Date.now() - (MAX_LEDGER_ENTRIES + 20 - i) * 1000).toISOString(), latencyMs: i })
    );
    saveProgress(USAGE_LEDGER_KEY, stored);

    recordUsage(fullCost({ latencyMs: 999999 }), { endpoint: 'tutor' });

    const entries = getUsageEntries();
    expect(entries).toHaveLength(MAX_LEDGER_ENTRIES);
    expect(entries[entries.length - 1].latencyMs).toBe(999999);
    // 가장 오래된 21건(20 초과분 + 새 1건 자리)이 밀려났다
    expect(entries[0].latencyMs).toBe(21);
  });

  it(`${LEDGER_RETENTION_DAYS} 일보다 오래된 기록은 버린다`, () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    const old = new Date(Date.now() - (LEDGER_RETENTION_DAYS + 1) * DAY).toISOString();
    const fresh = new Date(Date.now() - 1 * DAY).toISOString();
    saveProgress(USAGE_LEDGER_KEY, [fullCost({ ts: old }), fullCost({ ts: fresh })]);

    recordUsage(fullCost(), { endpoint: 'tutor' });

    const entries = getUsageEntries();
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.ts === old)).toBe(false);
  });

  it('보존 기간 경계(정확히 상한일)는 남긴다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    const edge = new Date(Date.now() - LEDGER_RETENTION_DAYS * DAY + 1000).toISOString();
    saveProgress(USAGE_LEDGER_KEY, [fullCost({ ts: edge })]);
    recordUsage(fullCost(), { endpoint: 'tutor' });
    expect(getUsageEntries()).toHaveLength(2);
  });
});

describe('getUsageEntries', () => {
  it('빈 상태에서 빈 배열을 준다', () => {
    expect(getUsageEntries()).toEqual([]);
  });

  it('손상된 저장값에서 빈 배열을 준다', () => {
    localStorage.setItem(STORAGE_KEY, '[[[');
    expect(getUsageEntries()).toEqual([]);
  });

  it('배열 안에 기록이 아닌 값이 섞여 있으면 걸러낸다', () => {
    saveProgress(USAGE_LEDGER_KEY, [fullCost(), null, 'x', 42, [], fullCost({ endpoint: 'grade' })]);
    const entries = getUsageEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.endpoint)).toEqual(['tutor', 'grade']);
  });

  it('읽기가 던져도 빈 배열을 준다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(getUsageEntries()).toEqual([]);
  });
});

describe('clearUsageLedger', () => {
  it('원장 키만 지운다 — 학습 데이터는 건드리지 않는다', () => {
    saveProgress('wrong_notes', [{ source: 'quiz100', id: '001' }]);
    recordUsage(fullCost(), { endpoint: 'tutor' });

    clearUsageLedger();

    expect(getUsageEntries()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadProgress('wrong_notes')).toEqual([{ source: 'quiz100', id: '001' }]);
  });

  it('비어 있을 때 불러도 던지지 않는다', () => {
    expect(() => clearUsageLedger()).not.toThrow();
  });
});

describe('summarizeUsage — 집계', () => {
  it('기록 0건이면 모두 0 이고 캐시 적중률은 null 이다', () => {
    const s = summarizeUsage([]);
    expect(s.calls).toBe(0);
    expect(s.okCalls).toBe(0);
    expect(s.failedCalls).toBe(0);
    expect(s.costUsd).toBe(0);
    expect(s.inputTokens).toBe(0);
    expect(s.cacheHitRate).toBeNull();
    expect(s.byEndpoint).toEqual({});
  });

  it('기록 1건을 그대로 합계로 낸다', () => {
    const s = summarizeUsage([normalizeCostEntry(fullCost(), {})]);
    expect(s.calls).toBe(1);
    expect(s.okCalls).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.0123, 10);
    expect(s.inputTokens).toBe(3120);
    expect(s.outputTokens).toBe(540);
    expect(s.cacheReadTokens).toBe(24800);
    expect(s.byEndpoint.tutor.calls).toBe(1);
  });

  it('부동소수 합계가 어긋나지 않는다', () => {
    const entries = Array.from({ length: 3 }, () => normalizeCostEntry(fullCost({ costUsd: 0.1 }), {}));
    expect(summarizeUsage(entries).costUsd).toBeCloseTo(0.3, 10);
  });

  it('엔드포인트별로 나눈다', () => {
    const entries = [
      normalizeCostEntry(fullCost({ endpoint: 'tutor', costUsd: 0.01 }), {}),
      normalizeCostEntry(fullCost({ endpoint: 'tutor', costUsd: 0.02 }), {}),
      normalizeCostEntry(fullCost({ endpoint: 'grade', costUsd: 0.005 }), {}),
      normalizeCostEntry(fullCost({ endpoint: 'plan', costUsd: 0.08, ok: false, errorCode: 'UPSTREAM' }), {}),
    ];
    const s = summarizeUsage(entries);
    expect(s.calls).toBe(4);
    expect(s.byEndpoint.tutor.calls).toBe(2);
    expect(s.byEndpoint.tutor.costUsd).toBeCloseTo(0.03, 10);
    expect(s.byEndpoint.grade.calls).toBe(1);
    expect(s.byEndpoint.plan.failedCalls).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.115, 10);
  });

  it('여러 날 기록을 기간으로 자른다', () => {
    const base = Date.parse('2026-09-04T09:00:00.000Z');
    const entries = [
      normalizeCostEntry(fullCost({ ts: new Date(base - 3 * DAY).toISOString(), costUsd: 1 }), {}),
      normalizeCostEntry(fullCost({ ts: new Date(base - 1 * DAY).toISOString(), costUsd: 2 }), {}),
      normalizeCostEntry(fullCost({ ts: new Date(base).toISOString(), costUsd: 4 }), {}),
    ];
    expect(summarizeUsage(entries).costUsd).toBe(7);
    expect(summarizeUsage(entries, { since: base - 2 * DAY }).costUsd).toBe(6);
    expect(summarizeUsage(entries, { since: base - 2 * DAY, until: base - 1 }).costUsd).toBe(2);
  });

  it('읽을 수 없는 ts 를 가진 기록은 기간 필터에서 빠진다', () => {
    const entries = [{ ...normalizeCostEntry(fullCost(), {}), ts: 'nope', costUsd: 9 }];
    expect(summarizeUsage(entries, { since: 0 }).calls).toBe(0);
    // 기간을 안 주면 전부 센다
    expect(summarizeUsage(entries).calls).toBe(1);
  });

  it('기록이 아닌 값이 섞여 들어와도 무시한다', () => {
    const s = summarizeUsage([null, 'x', normalizeCostEntry(fullCost(), {})]);
    expect(s.calls).toBe(1);
  });

  it('입력이 배열이 아니면 빈 집계를 준다', () => {
    expect(summarizeUsage(null).calls).toBe(0);
    expect(summarizeUsage(undefined).calls).toBe(0);
    expect(summarizeUsage({}).calls).toBe(0);
  });
});

describe('summarizeUsage — 캐시 적중률', () => {
  it('캐시 읽기가 0 이면 0% 다', () => {
    const s = summarizeUsage([
      normalizeCostEntry(fullCost({ inputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0 }), {}),
    ]);
    expect(s.cacheHitRate).toBe(0);
  });

  it('입력이 전부 캐시 읽기면 100% 다', () => {
    const s = summarizeUsage([
      normalizeCostEntry(fullCost({ inputTokens: 0, cacheReadTokens: 5000, cacheCreationTokens: 0 }), {}),
    ]);
    expect(s.cacheHitRate).toBe(1);
  });

  it('캐시 생성 토큰도 분모에 넣는다 — 첫 호출은 적중이 아니다', () => {
    const s = summarizeUsage([
      normalizeCostEntry(fullCost({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 4000 }), {}),
    ]);
    expect(s.cacheHitRate).toBe(0);
  });

  it('입력 토큰이 하나도 없으면 null 이다 (0% 와 구분한다)', () => {
    const s = summarizeUsage([
      normalizeCostEntry(fullCost({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }), {}),
    ]);
    expect(s.cacheHitRate).toBeNull();
  });

  it('섞인 경우 비율을 낸다', () => {
    const s = summarizeUsage([
      normalizeCostEntry(fullCost({ inputTokens: 1000, cacheReadTokens: 3000, cacheCreationTokens: 0 }), {}),
    ]);
    expect(s.cacheHitRate).toBeCloseTo(0.75, 10);
  });
});

describe('summarizeUsage — 실패만 있는 경우', () => {
  it('ok:false 만 있으면 호출 수는 세고 성공은 0 이다', () => {
    const entries = [
      normalizeCostEntry(fullCost({ ok: false, errorCode: 'RATE_LIMITED', costUsd: 0 }), {}),
      normalizeCostEntry(fullCost({ ok: false, errorCode: 'UPSTREAM', costUsd: 0.001 }), {}),
    ];
    const s = summarizeUsage(entries);
    expect(s.calls).toBe(2);
    expect(s.okCalls).toBe(0);
    expect(s.failedCalls).toBe(2);
    expect(s.costUsd).toBeCloseTo(0.001, 10);
  });
});

describe('getUsageSummaries — 오늘/이번 주/전체', () => {
  it('기록이 없으면 세 기간 모두 0 건이다', () => {
    const s = getUsageSummaries();
    expect(s.today.calls).toBe(0);
    expect(s.week.calls).toBe(0);
    expect(s.all.calls).toBe(0);
    expect(s.hasRecords).toBe(false);
  });

  it('오늘·이번 주·전체를 로컬 날짜 기준으로 가른다', () => {
    vi.useFakeTimers();
    // 한국 시간 2026-09-04 09:00 (테스트 TZ 는 vite.config 에서 Asia/Seoul 고정)
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    const now = Date.now();
    saveProgress(USAGE_LEDGER_KEY, [
      fullCost({ ts: new Date(now - 40 * DAY).toISOString(), costUsd: 1 }), // 전체에만
      fullCost({ ts: new Date(now - 3 * DAY).toISOString(), costUsd: 2 }), // 이번 주
      fullCost({ ts: new Date(now - 1 * 60 * 60 * 1000).toISOString(), costUsd: 4 }), // 오늘
    ]);

    const s = getUsageSummaries();
    expect(s.hasRecords).toBe(true);
    expect(s.today.costUsd).toBe(4);
    expect(s.week.costUsd).toBe(6);
    expect(s.all.costUsd).toBe(7);
  });

  it('오늘 자정 직전 기록은 오늘에 들어간다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T14:00:00.000Z')); // KST 2026-09-04 23:00
    saveProgress(USAGE_LEDGER_KEY, [fullCost({ ts: new Date(Date.now() - 1000).toISOString(), costUsd: 3 })]);
    expect(getUsageSummaries().today.costUsd).toBe(3);
  });

  it('어제 기록은 오늘에 들어가지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:30:00.000Z')); // KST 2026-09-04 09:30
    saveProgress(USAGE_LEDGER_KEY, [
      fullCost({ ts: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), costUsd: 5 }), // KST 전날 21:30
    ]);
    const s = getUsageSummaries();
    expect(s.today.calls).toBe(0);
    expect(s.week.calls).toBe(1);
  });
});

describe('내보내기', () => {
  it('봉투에 스키마·시각·건수·기록을 담는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:30:00.000Z'));
    recordUsage(fullCost(), { endpoint: 'tutor' });

    const payload = buildUsageExport();
    expect(payload.schema).toBe(USAGE_EXPORT_SCHEMA);
    expect(payload.exportedAt).toBe('2026-09-04T00:30:00.000Z');
    expect(payload.entryCount).toBe(1);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toEqual(fullCost());
  });

  it('기록이 없어도 빈 봉투를 만든다', () => {
    const payload = buildUsageExport();
    expect(payload.entryCount).toBe(0);
    expect(payload.entries).toEqual([]);
  });

  it('내보내고 다시 읽으면 같은 기록이다 (왕복)', () => {
    recordUsage(fullCost({ endpoint: 'tutor', costUsd: 0.01 }), {});
    recordUsage(fullCost({ endpoint: 'grade', costUsd: 0.02, ok: false, errorCode: 'UPSTREAM' }), {});

    const text = JSON.stringify(buildUsageExport());
    expect(parseUsageExport(text)).toEqual(getUsageEntries());
  });

  it('봉투 객체를 그대로 넣어도 읽는다', () => {
    recordUsage(fullCost(), {});
    expect(parseUsageExport(buildUsageExport())).toEqual(getUsageEntries());
  });

  it('맨 배열도 읽는다 — 다른 도구가 entries 만 넘길 수 있다', () => {
    expect(parseUsageExport([fullCost()])).toEqual([fullCost()]);
  });

  it('읽을 수 없는 입력은 빈 배열이다', () => {
    expect(parseUsageExport('{{{')).toEqual([]);
    expect(parseUsageExport(null)).toEqual([]);
    expect(parseUsageExport(42)).toEqual([]);
    expect(parseUsageExport({ schema: 'other', entries: 'nope' })).toEqual([]);
  });

  it('왕복 과정에서 기록이 아닌 값은 걸러진다', () => {
    expect(parseUsageExport({ entries: [fullCost(), null, 'x'] })).toHaveLength(1);
  });
});

describe('downloadUsageLedger', () => {
  it('기존 데이터 내보내기와 같은 방식으로 JSON 파일을 내려받는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:30:00.000Z'));
    recordUsage(fullCost(), { endpoint: 'tutor' });

    const createObjectURL = vi.fn(() => 'blob:usage');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const filename = downloadUsageLedger();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/json');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:usage');
    expect(filename).toBe('jungchogi_usage_2026-09-04.json');
  });

  it('기록이 없어도 내려받기가 던지지 않는다', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(() => downloadUsageLedger()).not.toThrow();
  });
});
