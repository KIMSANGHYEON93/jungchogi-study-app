// 사용 기록의 **고정 계약** (블루프린트 §5 Phase 5).
//
// 프론트 원장(`src/utils/usageLedger.js`)·서버 로그·리포트 스크립트가 모두 이 모양을
// 공유한다. 임의로 필드를 늘리거나 이름을 바꾸면 세 곳이 한꺼번에 어긋나므로
// 여기서 **키 집합 자체**를 못 박는다.
//
//   { ts, endpoint, model, effort,
//     inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
//     costUsd, latencyMs, ok, errorCode }
//
// 그리고 하나 더 — **개인 학습 데이터는 여기에 들어오지 못한다.**
// 기록은 열거된 항목만으로 조립되므로 답안·문항 내용은 구조적으로 새어 나갈 수 없다.

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  buildUsageRecord,
  logUsage,
  toCostPayload,
  USAGE_RECORD_FIELDS,
} from '../lib/ai/usage.js';

const USAGE = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 2_000,
};

const args = (overrides = {}) => ({
  endpoint: 'tutor',
  model: 'claude-opus-5',
  effort: 'low',
  usage: USAGE,
  latencyMs: 1_234,
  ok: true,
  errorCode: null,
  ts: '2026-09-04T12:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildUsageRecord — 계약된 열두 필드', () => {
  it('계약 그대로의 기록을 만든다', () => {
    const { record } = buildUsageRecord(args());

    expect(record).toEqual({
      ts: '2026-09-04T12:00:00.000Z',
      endpoint: 'tutor',
      model: 'claude-opus-5',
      effort: 'low',
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 10_000,
      cacheCreationTokens: 2_000,
      costUsd: 0.035,
      latencyMs: 1_234,
      ok: true,
      errorCode: null,
    });
  });

  it('키 집합은 계약에 없는 것을 하나도 더하지 않는다', () => {
    const { record } = buildUsageRecord(args());
    expect(Object.keys(record).sort()).toEqual([...USAGE_RECORD_FIELDS].sort());
  });

  it('비용 계산 결과를 기록과 함께 돌려준다 (응답에 실을 cost 객체)', () => {
    const { cost } = buildUsageRecord(args());
    expect(cost).toMatchObject({
      usd: 0.035,
      known: true,
      model: 'claude-opus-5',
      batch: false,
      warning: null,
    });
  });

  it('ts 를 주지 않으면 지금 시각을 ISO 문자열로 찍는다', () => {
    const { record } = buildUsageRecord(args({ ts: undefined }));
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('Date 객체로 준 ts 도 받는다', () => {
    const { record } = buildUsageRecord(args({ ts: new Date('2026-01-02T03:04:05.678Z') }));
    expect(record.ts).toBe('2026-01-02T03:04:05.678Z');
  });
});

describe('buildUsageRecord — "모름" 을 0 으로 때우지 않는다', () => {
  it('usage 가 통째로 없으면 토큰 네 항목과 비용이 모두 null 이다', () => {
    const { record, cost } = buildUsageRecord(args({ usage: undefined }));

    expect(record.inputTokens).toBeNull();
    expect(record.outputTokens).toBeNull();
    expect(record.cacheReadTokens).toBeNull();
    expect(record.cacheCreationTokens).toBeNull();
    expect(record.costUsd).toBeNull();
    expect(cost.warning).toBe('NO_USAGE');
    expect(cost.usdAtLeast).toBe(0);
  });

  it('일부만 와도 총액은 null 이고 아는 항목은 그대로 남는다', () => {
    const { record, cost } = buildUsageRecord(
      args({ usage: { input_tokens: 1_000, output_tokens: 500 } })
    );

    expect(record.inputTokens).toBe(1_000);
    expect(record.cacheReadTokens).toBeNull();
    expect(record.costUsd).toBeNull();
    expect(cost.usdAtLeast).toBe(0.0175);
    expect(cost.warning).toBe('PARTIAL_USAGE');
  });

  it('모르는 모델이면 비용을 null 로 두고 경고한다', () => {
    const { record, cost } = buildUsageRecord(args({ model: 'claude-opus-6' }));

    expect(record.model).toBe('claude-opus-6');
    expect(record.costUsd).toBeNull();
    expect(cost.warning).toBe('UNKNOWN_MODEL');
  });

  it('토큰이 실제로 0 이면 비용도 0 으로 기록한다 (null 이 아니다)', () => {
    const { record } = buildUsageRecord(
      args({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      })
    );
    expect(record.costUsd).toBe(0);
  });
});

describe('buildUsageRecord — 실패한 요청도 기록한다', () => {
  it('ok:false 와 errorCode 를 남긴다', () => {
    const { record } = buildUsageRecord(
      args({ ok: false, errorCode: 'UPSTREAM', usage: undefined })
    );
    expect(record.ok).toBe(false);
    expect(record.errorCode).toBe('UPSTREAM');
  });

  it('실패했지만 토큰을 쓴 경우도 그대로 계산한다', () => {
    const { record } = buildUsageRecord(args({ ok: false, errorCode: 'UPSTREAM' }));
    expect(record.costUsd).toBe(0.035);
    expect(record.ok).toBe(false);
  });

  it('errorCode 가 문자열이 아니면 null 로 정리한다', () => {
    expect(buildUsageRecord(args({ errorCode: 42 })).record.errorCode).toBeNull();
    expect(buildUsageRecord(args({ errorCode: '' })).record.errorCode).toBeNull();
  });

  it('ok 는 언제나 불리언이다', () => {
    expect(buildUsageRecord(args({ ok: 1 })).record.ok).toBe(true);
    expect(buildUsageRecord(args({ ok: undefined })).record.ok).toBe(false);
  });
});

describe('buildUsageRecord — 값 정리', () => {
  it('endpoint 는 계약된 넷 중 하나여야 한다', () => {
    expect(() => buildUsageRecord(args({ endpoint: 'chat' }))).toThrow(/endpoint/);
    for (const endpoint of ['tutor', 'plan', 'grade', 'generate']) {
      expect(buildUsageRecord(args({ endpoint })).record.endpoint).toBe(endpoint);
    }
  });

  it('effort 는 low|medium|high 아니면 null 이다', () => {
    expect(buildUsageRecord(args({ effort: 'high' })).record.effort).toBe('high');
    expect(buildUsageRecord(args({ effort: 'turbo' })).record.effort).toBeNull();
    expect(buildUsageRecord(args({ effort: undefined })).record.effort).toBeNull();
  });

  it('latencyMs 는 음이 아닌 정수로 조인다', () => {
    expect(buildUsageRecord(args({ latencyMs: 1_234.7 })).record.latencyMs).toBe(1_235);
    expect(buildUsageRecord(args({ latencyMs: -5 })).record.latencyMs).toBe(0);
    expect(buildUsageRecord(args({ latencyMs: 'slow' })).record.latencyMs).toBeNull();
    expect(buildUsageRecord(args({ latencyMs: undefined })).record.latencyMs).toBeNull();
  });

  it('Batch 할인은 비용에만 반영되고 기록의 형태는 그대로다', () => {
    const { record, cost } = buildUsageRecord(args({ endpoint: 'generate', batch: true }));
    expect(record.costUsd).toBe(0.0175);
    expect(cost.batch).toBe(true);
    expect(Object.keys(record).sort()).toEqual([...USAGE_RECORD_FIELDS].sort());
  });
});

describe('buildUsageRecord — 개인 학습 데이터가 새지 않는다', () => {
  it('열거되지 않은 인자는 기록에 들어오지 못한다', () => {
    const { record } = buildUsageRecord({
      ...args(),
      userAnswer: '정규화는 원자값으로 쪼개는 것',
      snapshot: { wrongNotes: [{ id: '002', question: '트랜잭션의 ACID' }] },
      source: 'quiz100',
      id: '002',
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('정규화');
    expect(serialized).not.toContain('quiz100');
    expect(serialized).not.toContain('002');
    expect(record).not.toHaveProperty('userAnswer');
    expect(record).not.toHaveProperty('source');
  });
});

describe('logUsage — 기계가 파싱할 한 줄', () => {
  it('stdout 에 JSON 한 줄만 찍는다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { record } = buildUsageRecord(args());

    logUsage(record);

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0];
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual(record);
  });

  it('모르는 모델을 만나면 별도의 경고를 함께 남긴다', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { record, cost } = buildUsageRecord(args({ model: 'claude-opus-6' }));

    logUsage(record, cost);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-opus-6'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2026-06'));
  });

  it('정상 비용에는 경고를 붙이지 않는다', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { record, cost } = buildUsageRecord(args());

    logUsage(record, cost);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('toCostPayload — 응답에 싣는 cost 객체', () => {
  it('계약된 열두 필드를 그대로 담는다 (프론트 원장이 이 이름으로 읽는다)', () => {
    const { record, cost } = buildUsageRecord(args());
    const payload = toCostPayload(record, cost);

    for (const field of USAGE_RECORD_FIELDS) {
      expect(payload[field]).toEqual(record[field]);
    }
  });

  it('토큰 수를 함께 실어 원장이 다시 계산하지 않아도 되게 한다', () => {
    const payload = toCostPayload(...Object.values(buildUsageRecord(args())));
    expect(payload.inputTokens).toBe(1_000);
    expect(payload.outputTokens).toBe(500);
    expect(payload.cacheReadTokens).toBe(10_000);
    expect(payload.cacheCreationTokens).toBe(2_000);
  });

  it('가격 판단의 근거를 함께 싣는다', () => {
    const { record, cost } = buildUsageRecord(args());
    const payload = toCostPayload(record, cost);

    expect(payload).toMatchObject({
      usd: 0.035,
      usdAtLeast: 0.035,
      known: true,
      unknownFields: [],
      batch: false,
      pricingAsOf: '2026-06',
      warning: null,
    });
  });

  it('usd 와 costUsd 는 같은 값이다 (이름만 둘)', () => {
    const { record, cost } = buildUsageRecord(args());
    const payload = toCostPayload(record, cost);
    expect(payload.usd).toBe(payload.costUsd);
  });

  it('총액을 모르면 두 이름 모두 null 이고 하한만 값이 있다', () => {
    const { record, cost } = buildUsageRecord(args({ usage: { input_tokens: 1_000 } }));
    const payload = toCostPayload(record, cost);

    expect(payload.costUsd).toBeNull();
    expect(payload.usd).toBeNull();
    expect(payload.usdAtLeast).toBe(0.005);
    expect(payload.warning).toBe('PARTIAL_USAGE');
  });

  it('여기에도 개인 학습 데이터는 없다', () => {
    const { record, cost } = buildUsageRecord(args());
    const serialized = JSON.stringify(toCostPayload(record, cost));

    expect(serialized).not.toContain('quiz100');
    expect(serialized).not.toContain('정규화');
  });
});
