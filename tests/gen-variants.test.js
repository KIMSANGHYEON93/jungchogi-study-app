// 변형 문제 생성기의 **요청 조립** — Batch 요청 배열을 만드는 부분 (블루프린트 §5 Phase 4).
//
// 여기서 SDK 는 부르지 않는다. 순수 함수만 본다:
//   문항 N개 × 변형 M개 → 요청 K건 · custom_id 유일성 · 프롬프트 내용 · 스키마 · 비용 추정
//
// Batch 요청은 `client.messages.batches.create({requests:[{custom_id, params}]})` 의
// `params` 그대로이고, `params` 는 `MessageCreateParamsNonStreaming` 이다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MODEL } from '../lib/ai/client.js';
import { loadSource, clearContentCache } from '../lib/ai/content.js';
import {
  VARIANT_EFFORT,
  VARIANT_MAX_TOKENS,
  BATCH_DISCOUNT,
  PRICE_INPUT_PER_MTOK,
  PRICE_OUTPUT_PER_MTOK,
  variantSchema,
  formatCustomId,
  parseCustomId,
  buildVariantRequests,
  estimateVariantCost,
  selectProblems,
} from '../lib/ai/variants.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

describe('custom_id', () => {
  it('source·원본 id·변형 번호를 되읽을 수 있다', () => {
    const id = formatCustomId({ source: 'codedrill', id: 'C-01', variant: 2 });
    expect(parseCustomId(id)).toEqual({ source: 'codedrill', id: 'C-01', variant: 2 });
  });

  it('알 수 없는 형식이면 null 을 준다 (위치로 매칭하는 폴백을 두지 않는다)', () => {
    expect(parseCustomId('아무거나')).toBeNull();
    expect(parseCustomId('')).toBeNull();
    expect(parseCustomId(undefined)).toBeNull();
  });

  it('Batch API 의 custom_id 길이 상한(64자) 안에 든다', () => {
    const id = formatCustomId({ source: 'codedrill', id: 'C-01', variant: 9 });
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe('buildVariantRequests', () => {
  const problems = () => loadSource('quiz100');

  it('문항 3개 × 변형 2개 → 요청 6건', () => {
    const requests = buildVariantRequests({
      source: 'quiz100',
      problems: problems(),
      variantsPerItem: 2,
    });
    expect(problems()).toHaveLength(3);
    expect(requests).toHaveLength(6);
  });

  it('custom_id 는 요청마다 유일하다', () => {
    const requests = buildVariantRequests({
      source: 'quiz100',
      problems: problems(),
      variantsPerItem: 3,
    });
    const ids = requests.map((r) => r.custom_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('프롬프트에 원본 지문과 정답이 들어간다', () => {
    const [request] = buildVariantRequests({
      source: 'quiz100',
      problems: problems().filter((p) => p.id === '002'),
      variantsPerItem: 1,
    });
    const prompt = request.params.messages[0].content;
    expect(prompt).toContain('정규화 단계별 핵심을 쓰시오');
    expect(prompt).toContain('부분 함수 종속'); // 원본 정답 본문
    expect(prompt).toContain('데이터베이스'); // 카테고리
  });

  it('드릴 프롬프트에는 코드·기대출력·함정이 함께 들어간다', () => {
    const [request] = buildVariantRequests({
      source: 'codedrill',
      problems: loadSource('codedrill').filter((p) => p.id === 'C-01'),
      variantsPerItem: 1,
    });
    const prompt = request.params.messages[0].content;
    expect(prompt).toContain('int *p = &a;'); // 문제 코드
    expect(prompt).toContain('30 50'); // expectedOutput
    expect(prompt).toContain('함정'); // pitfall 라벨
    expect(prompt).toContain('c'); // lang
  });

  it('변형 번호마다 다른 변형 각도를 준다 (같은 문항이 두 번 나오지 않게)', () => {
    const requests = buildVariantRequests({
      source: 'quiz100',
      problems: problems().filter((p) => p.id === '001'),
      variantsPerItem: 3,
    });
    const prompts = requests.map((r) => r.params.messages[0].content);
    expect(new Set(prompts).size).toBe(3);
  });

  it('variantsPerItem 이 1 미만이면 거부한다', () => {
    expect(() =>
      buildVariantRequests({ source: 'quiz100', problems: problems(), variantsPerItem: 0 })
    ).toThrow();
  });

  it('알 수 없는 source 는 거부한다', () => {
    expect(() =>
      buildVariantRequests({ source: 'nope', problems: problems(), variantsPerItem: 1 })
    ).toThrow();
  });
});

describe('요청 파라미터 (Phase 1~3 에서 실측 확인한 규칙)', () => {
  const [request] = buildVariantRequests({
    source: 'quiz100',
    problems: [{ id: '001', question: '질문', answer: '정답', category: '데이터베이스' }],
    variantsPerItem: 1,
  });

  it('모델은 날짜 접미사 없는 claude-opus-5 다', () => {
    expect(request.params.model).toBe(MODEL);
  });

  it('effort 는 output_config 안에 넣는다 (최상위 아님)', () => {
    expect(request.params.output_config.effort).toBe(VARIANT_EFFORT);
    expect(request.params.effort).toBeUndefined();
  });

  it('thinking 은 생략한다 — budget_tokens 는 Opus 5 에서 400 이다', () => {
    expect(request.params.thinking).toBeUndefined();
    expect(JSON.stringify(request.params)).not.toContain('budget_tokens');
  });

  it('서버측 폴백은 Batch API 에서 거부되므로 넣지 않는다', () => {
    expect(request.params.fallbacks).toBeUndefined();
    expect(request.params.betas).toBeUndefined();
  });

  it('스트리밍하지 않는다 (Batch 는 비스트리밍 파라미터만 받는다)', () => {
    expect(request.params.stream).toBeUndefined();
  });

  it('max_tokens 는 thinking 토큰까지 감당할 만큼 잡는다', () => {
    expect(request.params.max_tokens).toBe(VARIANT_MAX_TOKENS);
    expect(VARIANT_MAX_TOKENS).toBeGreaterThanOrEqual(4000);
  });

  it('시스템 프롬프트에 캐시 브레이크포인트를 건다 (요청 K건이 같은 프리픽스를 쓴다)', () => {
    expect(request.params.system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('같은 source 의 요청은 시스템 프리픽스가 완전히 같다', () => {
    const requests = buildVariantRequests({
      source: 'quiz100',
      problems: loadSource('quiz100'),
      variantsPerItem: 2,
    });
    const rendered = requests.map((r) => JSON.stringify(r.params.system));
    expect(new Set(rendered).size).toBe(1);
  });
});

describe('구조화 출력 스키마', () => {
  it('quiz100 은 question·answer 만 모델에게 맡긴다 (id·category 는 코드가 채운다)', () => {
    const schema = variantSchema('quiz100');
    expect(Object.keys(schema.properties).sort()).toEqual(['answer', 'question']);
    expect(schema.required.sort()).toEqual(['answer', 'question']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('bogang 스키마는 quiz100 과 같다 (파서 출력 shape 이 같다)', () => {
    expect(variantSchema('bogang')).toEqual(variantSchema('quiz100'));
  });

  it('codedrill 은 title·context·code·answer·expectedOutput·pitfall 을 받는다 (lang 은 원본 고정)', () => {
    const schema = variantSchema('codedrill');
    expect(Object.keys(schema.properties).sort()).toEqual([
      'answer',
      'code',
      'context',
      'expectedOutput',
      'pitfall',
      'title',
    ]);
    expect(schema.properties.lang).toBeUndefined();
  });

  it('구조화 출력에 strict 플래그는 없다 (그건 도구 쪽 필드다)', () => {
    for (const source of ['quiz100', 'bogang', 'codedrill']) {
      expect(variantSchema(source).strict).toBeUndefined();
    }
    const [request] = buildVariantRequests({
      source: 'quiz100',
      problems: [{ id: '001', question: 'q', answer: 'a', category: 'c' }],
      variantsPerItem: 1,
    });
    expect(request.params.output_config.format).toEqual({
      type: 'json_schema',
      schema: variantSchema('quiz100'),
    });
    expect(request.params.output_config.format.strict).toBeUndefined();
  });

  it('minimum/maximum/multipleOf 를 쓰지 않는다 (구조화 출력이 지원하지 않는다)', () => {
    for (const source of ['quiz100', 'bogang', 'codedrill']) {
      const rendered = JSON.stringify(variantSchema(source));
      expect(rendered).not.toContain('minimum');
      expect(rendered).not.toContain('maximum');
      expect(rendered).not.toContain('multipleOf');
    }
  });
});

describe('estimateVariantCost', () => {
  const requests = () =>
    buildVariantRequests({
      source: 'quiz100',
      problems: loadSource('quiz100'),
      variantsPerItem: 2,
    });

  it('요청 건수를 그대로 센다', () => {
    expect(estimateVariantCost(requests()).requestCount).toBe(6);
  });

  it('Batch 50% 할인이 반영된다', () => {
    const estimate = estimateVariantCost(requests());
    const listPrice =
      (estimate.inputTokens * PRICE_INPUT_PER_MTOK +
        estimate.outputTokens * PRICE_OUTPUT_PER_MTOK) /
      1_000_000;
    expect(BATCH_DISCOUNT).toBe(0.5);
    expect(estimate.usd).toBeCloseTo(listPrice * BATCH_DISCOUNT, 10);
  });

  it('요청이 늘면 비용도 는다', () => {
    const two = estimateVariantCost(requests()).usd;
    const four = estimateVariantCost(
      buildVariantRequests({
        source: 'quiz100',
        problems: loadSource('quiz100'),
        variantsPerItem: 4,
      })
    ).usd;
    expect(four).toBeGreaterThan(two);
  });

  it('드릴은 추적 풀이를 쓰게 하므로 단답형보다 출력 토큰을 크게 잡는다', () => {
    const drill = estimateVariantCost(
      buildVariantRequests({
        source: 'codedrill',
        problems: loadSource('codedrill').slice(0, 1),
        variantsPerItem: 1,
      })
    );
    const quiz = estimateVariantCost(
      buildVariantRequests({
        source: 'quiz100',
        problems: loadSource('quiz100').slice(0, 1),
        variantsPerItem: 1,
      })
    );
    expect(drill.outputTokens).toBeGreaterThan(quiz.outputTokens);
  });
});

describe('selectProblems', () => {
  it('아무 조건이 없으면 source 전체를 준다', () => {
    expect(selectProblems({ source: 'quiz100' }).map((p) => p.id)).toEqual(['001', '002', '026']);
  });

  it('ids 를 주면 준 순서대로 준다', () => {
    expect(selectProblems({ source: 'quiz100', ids: ['026', '001'] }).map((p) => p.id)).toEqual([
      '026',
      '001',
    ]);
  });

  it('없는 id 가 섞이면 돈을 쓰기 전에 던진다', () => {
    expect(() => selectProblems({ source: 'quiz100', ids: ['001', '777'] })).toThrow(/777/);
  });

  it('category 로 거를 수 있다', () => {
    const picked = selectProblems({ source: 'quiz100', category: '소프트웨어공학' });
    expect(picked.map((p) => p.id)).toEqual(['026']);
  });

  it('드릴은 lang 을 category 로 쓴다 (파서에 category 가 없다)', () => {
    const picked = selectProblems({ source: 'codedrill', category: 'sql' });
    expect(picked.map((p) => p.id)).toEqual(['S-01', 'S-05']);
  });

  it('걸리는 문항이 없으면 던진다 (빈 배치를 만들지 않는다)', () => {
    expect(() => selectProblems({ source: 'quiz100', category: '없는분류' })).toThrow();
  });
});
