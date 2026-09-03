// 채점 평가셋(`tests/eval/grading.json`)의 무결성.
//
// 평가셋은 API 키가 있는 환경에서만 실제로 돌릴 수 있다(`scripts/eval-grading.mjs`).
// 그래서 **키 없이도 확인 가능한 것**은 여기서 고정한다 — 문항이 실재하는지,
// 요청이 엔드포인트 계약을 통과하는지, 구성이 한쪽으로 쏠리지 않았는지.
// 이 테스트가 없으면 교재가 바뀌어 문항 id 가 사라져도 평가셋을 돌리기 전까지 모른다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { loadProblem } from '../lib/ai/content.js';
import { validateGradeBody, MAX_USER_ANSWER_LENGTH } from '../lib/ai/guard.js';

const EVAL_PATH = fileURLToPath(new URL('./eval/grading.json', import.meta.url));
const evalSet = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
const items = evalSet.items;

/** 카테고리 → 건수 */
const countByCategory = () =>
  items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {});

describe('평가셋 구성', () => {
  it('블루프린트 §5 가 요구한 30문항이다', () => {
    expect(items).toHaveLength(30);
  });

  it('선언한 카테고리만 쓰고, 모든 카테고리에 항목이 있다', () => {
    const declared = Object.keys(evalSet.categories).sort();

    expect(Object.keys(countByCategory()).sort()).toEqual(declared);
  });

  it('경계 사례를 넉넉히 담는다 (채점이 갈릴 만한 것)', () => {
    expect(countByCategory().boundary).toBeGreaterThanOrEqual(3);
  });

  it('code 와 short 를 둘 다 충분히 담는다', () => {
    const kinds = items.reduce((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {});

    expect(kinds.code).toBeGreaterThanOrEqual(10);
    expect(kinds.short).toBeGreaterThanOrEqual(10);
  });

  it('세 출처를 모두 건드린다', () => {
    expect([...new Set(items.map((i) => i.source))].sort()).toEqual([
      'bogang',
      'codedrill',
      'quiz100',
    ]);
  });

  it('모든 항목이 사람 판정과 그 근거(note)를 갖는다', () => {
    for (const item of items) {
      expect(['correct', 'partial', 'incorrect']).toContain(item.expected.verdict);
      expect(item.expected.note.length).toBeGreaterThan(10);
    }
  });

  it('경계 사례는 왜 갈리는지 길게 적는다', () => {
    for (const item of items.filter((i) => i.category === 'boundary')) {
      expect(item.expected.note.length).toBeGreaterThan(60);
    }
  });
});

describe('평가셋 항목이 실제 교재를 가리킨다', () => {
  it('모든 문항이 public/data 에 실재한다', () => {
    const missing = items
      .filter((item) => loadProblem(item.source, item.id) === null)
      .map((item) => `${item.source}/${item.id}`);

    expect(missing).toEqual([]);
  });

  it('채점 기준이 될 교재 정답이 비어 있지 않다', () => {
    const empty = items
      .filter((item) => (loadProblem(item.source, item.id)?.answer ?? '').trim() === '')
      .map((item) => `${item.source}/${item.id}`);

    expect(empty).toEqual([]);
  });
});

describe('평가셋 항목이 엔드포인트 계약을 통과한다', () => {
  const gradable = items.filter((item) => item.expected.error === undefined);

  it('빈 답 항목은 400 BAD_REQUEST 를 기대한다고 표시돼 있다', () => {
    const empties = items.filter((item) => item.userAnswer.trim() === '');

    expect(empties.length).toBeGreaterThan(0);
    for (const item of empties) {
      expect(item.expected.error).toBe('BAD_REQUEST');
    }
  });

  it('나머지 항목은 validateGradeBody 를 그대로 통과한다', () => {
    const rejected = gradable
      .map((item) => ({ item, result: validateGradeBody(item) }))
      .filter(({ result }) => !result.ok)
      .map(({ item, result }) => `${item.source}/${item.id}: ${result.message}`);

    expect(rejected).toEqual([]);
  });

  it('답안이 길이 상한 안에 있다', () => {
    for (const item of items) {
      expect(item.userAnswer.length).toBeLessThanOrEqual(MAX_USER_ANSWER_LENGTH);
    }
  });
});
