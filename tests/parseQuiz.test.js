import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseQuiz } from '../src/utils/parseQuiz.js';

const sample = readFileSync(
  fileURLToPath(new URL('./fixtures/quiz-sample.md', import.meta.url)),
  'utf8'
);

describe('parseQuiz — 실제 콘텐츠 형식', () => {
  it('`### NNN.` 헤딩을 가진 문항만 추출한다', () => {
    const questions = parseQuiz(sample);
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.id)).toEqual(['001', '002', '026']);
  });

  it('문항마다 id·question·answer·category 를 채운다', () => {
    const [first] = parseQuiz(sample);
    expect(first).toEqual({
      id: '001',
      question: '트랜잭션의 4가지 특성(ACID)을 쓰시오.',
      category: '데이터베이스',
      answer: [
        '- **A**tomicity (원자성): 전부 실행 또는 전부 취소',
        '- **C**onsistency (일관성): 실행 후 일관된 상태 유지',
        '- **I**solation (독립성/고립성): 동시 실행 시 상호 간섭 불가',
        '- **D**urability (지속성/영속성): 완료된 결과 영구 반영',
      ].join('\n'),
    });
  });

  it('`## A.`~`## F.` 섹션 문자를 한글 카테고리로 매핑한다', () => {
    const byId = Object.fromEntries(parseQuiz(sample).map((q) => [q.id, q.category]));
    expect(byId['002']).toBe('데이터베이스');
    expect(byId['026']).toBe('소프트웨어공학');
  });

  it('answer 는 details 블록 내부만 담고 앞뒤 공백을 제거한다', () => {
    const q026 = parseQuiz(sample).find((q) => q.id === '026');
    expect(q026.answer).toBe('**도출 → 분석 → 명세 → 확인** (도분명확)');
    expect(q026.answer).not.toContain('<summary>');
    expect(q026.answer).not.toContain('</details>');
  });
});

describe('parseQuiz — 엣지 케이스', () => {
  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(parseQuiz('')).toEqual([]);
  });

  it('문항 헤딩이 없는 문서는 빈 배열을 반환한다', () => {
    expect(parseQuiz('# 제목\n\n본문만 있고 문항은 없다.\n')).toEqual([]);
  });

  it('카테고리 섹션 앞에 나온 문항은 category 가 빈 문자열이다', () => {
    const [q] = parseQuiz('### 001. 섹션 없는 문항\n\n<details><summary>정답</summary>\n답\n</details>\n');
    expect(q.category).toBe('');
  });

  it('세 자리가 아닌 번호(`### 01.`, `### 0001.`)는 문항으로 보지 않는다', () => {
    expect(parseQuiz('### 01. 두 자리\n### 0001. 네 자리\n')).toEqual([]);
  });

  it('`####` 처럼 헤딩 레벨이 다르면 문항으로 보지 않는다', () => {
    expect(parseQuiz('#### 001. 레벨이 다르다\n')).toEqual([]);
  });

  it('details 가 닫히지 않으면 문서 끝까지를 answer 로 삼는다', () => {
    const [q] = parseQuiz('### 001. 미완성 문항\n\n<details><summary>정답</summary>\n답 첫 줄\n답 둘째 줄\n');
    expect(q.answer).toBe('답 첫 줄\n답 둘째 줄');
  });
});
