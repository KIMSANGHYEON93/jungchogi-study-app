// lib/ai/usage.js — 비용 계산의 단일 진실 원천 (블루프린트 §5 Phase 5 · §6).
//
// 여기서 못 박는 것:
//   1. 가격표는 **모델 id 로 키를 잡는다.** 모르는 모델이면 계산을 거부한다 —
//      조용히 틀린 비용을 보고하는 것이 가장 나쁘다.
//   2. **"모름" 과 "0" 은 다르다.** usage 필드가 없으면 0 으로 때우지 않고 null 로 남긴다.
//      하나라도 모르면 총액(usd)은 null 이고, 아는 항목만 더한 하한(usdAtLeast)만 준다.
//   3. 가격 상수는 이 테스트가 값 그대로 박아 둔다. 가격표를 고치면 여기가 깨져서
//      "가격이 바뀌었다" 는 사실이 CI 에 드러난다.
//
// API 키가 필요 없는 순수 계산이다.

import { describe, it, expect } from 'vitest';

import {
  PRICING,
  PRICING_AS_OF,
  PRICING_SOURCE,
  BATCH_MULTIPLIER,
  DEFAULT_MODEL,
  normalizeUsage,
  calculateCost,
  pricingAgeMonths,
} from '../lib/ai/usage.js';

const MODEL = 'claude-opus-5';

/** SDK 가 주는 usage 모양 (snake_case) */
const sdkUsage = (overrides = {}) => ({
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 2_000,
  ...overrides,
});

describe('가격표 — 2026-06 기준 Claude Opus 5', () => {
  it('$/1M 토큰 네 항목을 값 그대로 고정한다', () => {
    expect(PRICING[MODEL]).toEqual({
      input: 5.0,
      output: 25.0,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
  });

  it('캐시 읽기는 입력의 0.1배, 캐시 쓰기는 1.25배다', () => {
    const p = PRICING[MODEL];
    expect(p.cacheRead).toBeCloseTo(p.input * 0.1, 10);
    expect(p.cacheWrite).toBeCloseTo(p.input * 1.25, 10);
  });

  it('Batch 할인은 0.5배다', () => {
    expect(BATCH_MULTIPLIER).toBe(0.5);
  });

  it('기준일과 출처를 코드가 들고 있다 (수치의 출처를 따라갈 수 있게)', () => {
    expect(PRICING_AS_OF).toBe('2026-06');
    expect(PRICING_SOURCE).toMatch(/https?:\/\//);
  });

  it('기본 모델은 앱이 실제로 쓰는 모델과 같다', () => {
    expect(DEFAULT_MODEL).toBe(MODEL);
    expect(PRICING).toHaveProperty(DEFAULT_MODEL);
  });

  it('가격표의 나이를 개월 수로 알려 준다 (오래되면 리포트가 경고한다)', () => {
    expect(pricingAgeMonths(new Date('2026-06-15T00:00:00Z'))).toBe(0);
    expect(pricingAgeMonths(new Date('2026-09-04T00:00:00Z'))).toBe(3);
    expect(pricingAgeMonths(new Date('2027-06-01T00:00:00Z'))).toBe(12);
  });
});

describe('normalizeUsage — SDK usage 를 계약 필드로 옮긴다', () => {
  it('네 항목을 모두 읽는다', () => {
    expect(normalizeUsage(sdkUsage())).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 10_000,
      cacheCreationTokens: 2_000,
      unknownFields: [],
      coercedFields: [],
    });
  });

  it('명시된 0 은 "0" 이지 "모름" 이 아니다', () => {
    const tally = normalizeUsage(
      sdkUsage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    );
    expect(tally.cacheReadTokens).toBe(0);
    expect(tally.cacheCreationTokens).toBe(0);
    expect(tally.unknownFields).toEqual([]);
  });

  it('없는 필드는 0 이 아니라 null 이고 unknownFields 에 이름이 남는다', () => {
    const tally = normalizeUsage({ input_tokens: 100 });
    expect(tally.inputTokens).toBe(100);
    expect(tally.outputTokens).toBeNull();
    expect(tally.cacheReadTokens).toBeNull();
    expect(tally.cacheCreationTokens).toBeNull();
    expect(tally.unknownFields.sort()).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'outputTokens',
    ]);
  });

  it('usage 자체가 없으면 네 항목 전부 모름이다', () => {
    for (const missing of [undefined, null, 'nope', 42, []]) {
      const tally = normalizeUsage(missing);
      expect(tally.inputTokens).toBeNull();
      expect(tally.unknownFields).toHaveLength(4);
    }
  });

  it('usage 필드가 null 이면 모름으로 다룬다', () => {
    const tally = normalizeUsage(sdkUsage({ output_tokens: null }));
    expect(tally.outputTokens).toBeNull();
    expect(tally.unknownFields).toEqual(['outputTokens']);
  });

  it('문자열로 온 숫자는 받아들이되 coercedFields 에 기록한다', () => {
    const tally = normalizeUsage({
      input_tokens: '1200',
      output_tokens: '0',
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(tally.inputTokens).toBe(1_200);
    expect(tally.outputTokens).toBe(0);
    expect(tally.unknownFields).toEqual([]);
    expect(tally.coercedFields.sort()).toEqual(['inputTokens', 'outputTokens']);
  });

  it('숫자가 아닌 문자열은 모름이다 (0 으로 때우지 않는다)', () => {
    const tally = normalizeUsage(sdkUsage({ input_tokens: 'many' }));
    expect(tally.inputTokens).toBeNull();
    expect(tally.unknownFields).toEqual(['inputTokens']);
  });

  it('음수·NaN·Infinity 는 모름으로 막는다', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      const tally = normalizeUsage(sdkUsage({ output_tokens: bad }));
      expect(tally.outputTokens).toBeNull();
      expect(tally.unknownFields).toEqual(['outputTokens']);
    }
  });

  it('camelCase 로 온 기록(프론트 원장)도 그대로 읽는다', () => {
    const tally = normalizeUsage({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
    });
    expect(tally).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      unknownFields: [],
    });
  });
});

describe('calculateCost — 네 항목 조합', () => {
  const cost = (usage, options) => calculateCost(normalizeUsage(usage), options);

  it('네 항목을 각각의 단가로 더한다', () => {
    // 1000·5 + 500·25 + 10000·0.5 + 2000·6.25 (모두 /1e6)
    const result = cost(sdkUsage(), { model: MODEL });
    expect(result.usd).toBeCloseTo(0.005 + 0.0125 + 0.005 + 0.0125, 10);
    expect(result.usd).toBe(0.035);
    expect(result.known).toBe(true);
    expect(result.warning).toBeNull();
  });

  it('토큰이 전부 0 이면 비용도 0 이다 (null 이 아니다)', () => {
    const result = cost(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      { model: MODEL }
    );
    expect(result.usd).toBe(0);
    expect(result.known).toBe(true);
  });

  it('캐시 읽기만 있는 경우 (캐시 100% 적중)', () => {
    const result = cost(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 20_000,
        cache_creation_input_tokens: 0,
      },
      { model: MODEL }
    );
    expect(result.usd).toBe(0.01);
  });

  it('캐시 쓰기만 있는 경우 (첫 호출)', () => {
    const result = cost(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 16_000,
      },
      { model: MODEL }
    );
    expect(result.usd).toBe(0.1);
  });

  it('Batch 는 전체에 0.5배를 건다', () => {
    const plain = cost(sdkUsage(), { model: MODEL });
    const batch = cost(sdkUsage(), { model: MODEL, batch: true });
    expect(batch.usd).toBe(plain.usd * 0.5);
    expect(batch.batch).toBe(true);
    expect(plain.batch).toBe(false);
  });

  it('모델 인자를 생략하면 기본 모델로 계산한다', () => {
    expect(cost(sdkUsage(), {}).usd).toBe(0.035);
    expect(cost(sdkUsage()).model).toBe(DEFAULT_MODEL);
  });

  it('아주 큰 토큰 수도 정밀도를 잃지 않는다', () => {
    const result = cost(
      {
        input_tokens: 1_000_000_000,
        output_tokens: 1_000_000_000,
        cache_read_input_tokens: 1_000_000_000,
        cache_creation_input_tokens: 1_000_000_000,
      },
      { model: MODEL }
    );
    expect(result.usd).toBe(5_000 + 25_000 + 500 + 6_250);
    expect(Number.isFinite(result.usd)).toBe(true);
  });

  it('아주 작은 비용도 0 으로 뭉개지 않는다', () => {
    const result = cost(
      {
        input_tokens: 1,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      { model: MODEL }
    );
    expect(result.usd).toBe(0.000005);
    expect(result.usd).toBeGreaterThan(0);
  });

  it('부동소수 잔재를 남기지 않는다 (0.30000000000000004 같은 값)', () => {
    const result = cost(
      {
        input_tokens: 3,
        output_tokens: 3,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 3,
      },
      { model: MODEL }
    );
    expect(String(result.usd)).not.toMatch(/0{6}\d|9{6}\d/);
  });
});

describe('calculateCost — 모르는 모델', () => {
  it('가격표에 없는 모델이면 계산을 거부한다', () => {
    const result = calculateCost(normalizeUsage(sdkUsage()), { model: 'claude-opus-6' });
    expect(result.usd).toBeNull();
    expect(result.usdAtLeast).toBeNull();
    expect(result.known).toBe(false);
    expect(result.warning).toBe('UNKNOWN_MODEL');
    expect(result.model).toBe('claude-opus-6');
  });

  it('모델 id 가 비어 있어도 조용히 기본 모델로 넘어가지 않는다', () => {
    for (const bad of ['', '   ', null, 123]) {
      const result = calculateCost(normalizeUsage(sdkUsage()), { model: bad });
      expect(result.usd).toBeNull();
      expect(result.warning).toBe('UNKNOWN_MODEL');
    }
  });

  it('경고에 기준일을 함께 실어 어떤 가격표로 판단했는지 남긴다', () => {
    const result = calculateCost(normalizeUsage(sdkUsage()), { model: 'claude-opus-6' });
    expect(result.pricingAsOf).toBe(PRICING_AS_OF);
  });
});

describe('calculateCost — usage 가 일부만 오거나 아예 없을 때', () => {
  it('한 항목이라도 모르면 총액은 null 이다 (과소보고 방지)', () => {
    const result = calculateCost(normalizeUsage({ input_tokens: 1_000 }), { model: MODEL });
    expect(result.usd).toBeNull();
    expect(result.known).toBe(false);
    expect(result.warning).toBe('PARTIAL_USAGE');
  });

  it('아는 항목만 더한 하한을 함께 준다 ("최소 이만큼은 썼다")', () => {
    const result = calculateCost(
      normalizeUsage({ input_tokens: 1_000, output_tokens: 500 }),
      { model: MODEL }
    );
    expect(result.usdAtLeast).toBe(0.0175);
    expect(result.usd).toBeNull();
    expect(result.unknownFields.sort()).toEqual(['cacheCreationTokens', 'cacheReadTokens']);
  });

  it('usage 가 통째로 없으면 하한도 0 이고 NO_USAGE 로 표시한다', () => {
    const result = calculateCost(normalizeUsage(undefined), { model: MODEL });
    expect(result.usd).toBeNull();
    expect(result.usdAtLeast).toBe(0);
    expect(result.warning).toBe('NO_USAGE');
    expect(result.unknownFields).toHaveLength(4);
  });

  it('모르는 모델 경고가 usage 누락 경고보다 앞선다', () => {
    const result = calculateCost(normalizeUsage(undefined), { model: 'claude-opus-6' });
    expect(result.warning).toBe('UNKNOWN_MODEL');
  });

  it('문자열 숫자를 받아들인 사실을 비용 객체에도 남긴다', () => {
    const result = calculateCost(
      normalizeUsage({
        input_tokens: '1000',
        output_tokens: 500,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 2_000,
      }),
      { model: MODEL }
    );
    expect(result.usd).toBe(0.035);
    expect(result.coercedFields).toEqual(['inputTokens']);
  });

  it('tally 대신 원시 usage 를 그대로 줘도 같은 결과를 낸다', () => {
    expect(calculateCost(sdkUsage(), { model: MODEL }).usd).toBe(0.035);
  });
});
