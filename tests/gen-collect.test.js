// 변형 문제 생성기의 **결과 수거** — Batch 결과 스트림을 생성물 항목으로 바꾸는 부분.
//
// Batch 결과는 **요청 순서를 보장하지 않는다.** 위치로 맞추면 조용히 어긋나므로
// `custom_id` 로만 되맞춘다. 여기 테스트는 일부러 순서를 섞어서 그것을 확인한다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { loadSource, clearContentCache } from '../lib/ai/content.js';
import { formatCustomId, collectVariantResults } from '../lib/ai/variants.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

const USAGE = { input_tokens: 900, output_tokens: 1_400 };

/** 성공한 결과 한 줄 — 실제 JSONL 과 같은 모양 (parsed_output 은 없다). */
function succeeded(customId, output, { stopReason = 'end_turn', usage = USAGE } = {}) {
  return {
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: {
        stop_reason: stopReason,
        content: [{ type: 'text', text: JSON.stringify(output) }],
        usage,
      },
    },
  };
}

function rawText(customId, text) {
  return {
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: USAGE },
    },
  };
}

const errored = (customId, message = '서버 오류') => ({
  custom_id: customId,
  result: { type: 'errored', error: { type: 'error', error: { type: 'api_error', message } } },
});

const expired = (customId) => ({ custom_id: customId, result: { type: 'expired' } });
const canceled = (customId) => ({ custom_id: customId, result: { type: 'canceled' } });

/** 결과 배열을 비동기 이터러블로 (SDK 의 JSONLDecoder 와 같은 소비 방식) */
async function* stream(rows) {
  for (const row of rows) yield row;
}

const cid = (id, variant, source = 'quiz100') => formatCustomId({ source, id, variant });

const shortAnswer = (question, answer) => ({ question, answer });

describe('collectVariantResults — custom_id 매칭', () => {
  it('결과가 섞여 와도 원본과 어긋나지 않는다', async () => {
    const rows = [
      succeeded(cid('026', 1), shortAnswer('요구사항 개발 변형', '도출-분석-명세-확인')),
      succeeded(cid('001', 1), shortAnswer('ACID 변형', '원자성/일관성/독립성/지속성')),
      succeeded(cid('002', 1), shortAnswer('정규화 변형', '1NF 원자값')),
    ];

    const { items, failures } = await collectVariantResults({
      results: stream(rows),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(failures).toEqual([]);
    const byVariantOf = Object.fromEntries(items.map((item) => [item.variantOf, item.question]));
    expect(byVariantOf['001']).toBe('ACID 변형');
    expect(byVariantOf['002']).toBe('정규화 변형');
    expect(byVariantOf['026']).toBe('요구사항 개발 변형');
  });

  it('도착 순서와 무관하게 원본 순서·변형 번호 순으로 정렬한다', async () => {
    const rows = [
      succeeded(cid('002', 2), shortAnswer('q22', 'a22')),
      succeeded(cid('001', 2), shortAnswer('q12', 'a12')),
      succeeded(cid('002', 1), shortAnswer('q21', 'a21')),
      succeeded(cid('001', 1), shortAnswer('q11', 'a11')),
    ];

    const { items } = await collectVariantResults({
      results: stream(rows),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(items.map((item) => item.id)).toEqual(['001-v1', '001-v2', '002-v1', '002-v2']);
  });

  it('모르는 custom_id 는 조용히 버리지 않고 실패로 남긴다', async () => {
    const rows = [
      succeeded(cid('001', 1), shortAnswer('q', 'a')),
      succeeded('엉뚱한-키', shortAnswer('q', 'a')),
      succeeded(cid('999', 1), shortAnswer('q', 'a')), // 원본에 없는 id
    ];

    const { items, failures } = await collectVariantResults({
      results: stream(rows),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(items).toHaveLength(1);
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.customId).sort()).toEqual(['quiz100__999__v1', '엉뚱한-키']);
  });
});

describe('collectVariantResults — 부분 실패', () => {
  it('errored·expired·canceled 가 섞여도 성공분은 그대로 남는다', async () => {
    const rows = [
      errored(cid('001', 1), '업스트림 500'),
      succeeded(cid('001', 2), shortAnswer('살아남은 변형', '정답')),
      expired(cid('002', 1)),
      canceled(cid('002', 2)),
    ];

    const { items, failures } = await collectVariantResults({
      results: stream(rows),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(items).toHaveLength(1);
    expect(items[0].question).toBe('살아남은 변형');

    const byType = Object.fromEntries(failures.map((f) => [f.type, f.customId]));
    expect(byType.errored).toBe(cid('001', 1));
    expect(byType.expired).toBe(cid('002', 1));
    expect(byType.canceled).toBe(cid('002', 2));
  });

  it('errored 실패에는 업스트림 메시지를 남긴다', async () => {
    const { failures } = await collectVariantResults({
      results: stream([errored(cid('001', 1), '한도 초과')]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });
    expect(failures[0].message).toContain('한도 초과');
  });

  it('max_tokens 로 잘린 응답은 실패로 잡는다', async () => {
    const { items, failures } = await collectVariantResults({
      results: stream([
        succeeded(cid('001', 1), shortAnswer('q', 'a'), { stopReason: 'max_tokens' }),
      ]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });
    expect(items).toEqual([]);
    expect(failures[0].type).toBe('truncated');
  });

  it('정책 거절(refusal)도 실패로 잡는다', async () => {
    const { failures } = await collectVariantResults({
      results: stream([
        succeeded(cid('001', 1), shortAnswer('q', 'a'), { stopReason: 'refusal' }),
      ]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });
    expect(failures[0].type).toBe('refusal');
  });

  it('JSON 이 깨진 응답은 실패로 잡는다', async () => {
    const { items, failures } = await collectVariantResults({
      results: stream([rawText(cid('001', 1), '{"question": "잘린')]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });
    expect(items).toEqual([]);
    expect(failures[0].type).toBe('invalid');
  });

  it('필수 필드가 비어 오면 실패로 잡는다', async () => {
    const { items, failures } = await collectVariantResults({
      results: stream([succeeded(cid('001', 1), { question: '지문만 있고', answer: '   ' })]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });
    expect(items).toEqual([]);
    expect(failures[0].type).toBe('invalid');
  });
});

describe('collectVariantResults — 생성물 항목 shape', () => {
  it('단답형 항목은 파서 출력 + variantOf/generated 다', async () => {
    const { items } = await collectVariantResults({
      results: stream([succeeded(cid('002', 3), shortAnswer('변형 지문', '변형 정답'))]),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(items[0]).toEqual({
      id: '002-v3',
      question: '변형 지문',
      answer: '변형 정답',
      category: '데이터베이스', // 원본에서 가져온다 — 모델이 지어내지 않는다
      variantOf: '002',
      generated: true,
    });
  });

  it('드릴 항목은 lang 을 원본에서 가져온다', async () => {
    const output = {
      title: '포인터 변형',
      context: '',
      code: 'int a = 1;',
      answer: '추적표…',
      expectedOutput: '1',
      pitfall: '주소 vs 값',
    };

    const { items } = await collectVariantResults({
      results: stream([succeeded(cid('C-01', 1, 'codedrill'), output)]),
      source: 'codedrill',
      originals: loadSource('codedrill'),
    });

    expect(items[0]).toEqual({
      id: 'C-01-v1',
      title: '포인터 변형',
      context: '',
      code: 'int a = 1;',
      lang: 'c',
      answer: '추적표…',
      expectedOutput: '1',
      pitfall: '주소 vs 값',
      variantOf: 'C-01',
      generated: true,
    });
  });

  it('드릴은 context·expectedOutput·pitfall 이 비어도 통과한다 (원본에도 빈 문항이 있다)', async () => {
    const output = {
      title: 'DDL 변형',
      context: '',
      code: 'CREATE TABLE t(a INT);',
      answer: '풀이',
      expectedOutput: '',
      pitfall: '',
    };

    const { items, failures } = await collectVariantResults({
      results: stream([succeeded(cid('S-05', 1, 'codedrill'), output)]),
      source: 'codedrill',
      originals: loadSource('codedrill'),
    });

    expect(failures).toEqual([]);
    expect(items).toHaveLength(1);
  });
});

describe('collectVariantResults — 사용량 집계', () => {
  it('성공분의 usage 를 합산해 실제 비용을 낼 수 있게 한다', async () => {
    const rows = [
      succeeded(cid('001', 1), shortAnswer('q', 'a'), {
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      succeeded(cid('002', 1), shortAnswer('q', 'a'), {
        usage: { input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 700 },
      }),
    ];

    const { usage } = await collectVariantResults({
      results: stream(rows),
      source: 'quiz100',
      originals: loadSource('quiz100'),
    });

    expect(usage.inputTokens).toBe(150);
    expect(usage.outputTokens).toBe(225);
    expect(usage.cacheReadInputTokens).toBe(700);
  });
});
