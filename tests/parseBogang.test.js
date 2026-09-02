import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseBogang } from '../src/utils/parseBogang.js';

const sample = readFileSync(
  fileURLToPath(new URL('./fixtures/bogang-sample.md', import.meta.url)),
  'utf8'
);

describe('parseBogang — 실제 콘텐츠 형식', () => {
  it('`### 보강 N:` 헤딩을 가진 카드만 추출한다', () => {
    const cards = parseBogang(sample);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.id)).toEqual(['B01', 'B02']);
  });

  it('id 는 두 자리로 0 을 채운 `B` 접두사 형식이다', () => {
    const [first] = parseBogang('### 보강 7: 일곱\n### 보강 42: 마흔둘\n### 보강 119: 백열아홉\n');
    expect(first.id).toBe('B07');
    expect(parseBogang('### 보강 42: 마흔둘\n')[0].id).toBe('B42');
    expect(parseBogang('### 보강 119: 백열아홉\n')[0].id).toBe('B119');
  });

  it('question 은 `[암기 ...]` 대괄호 주석을 제거하고 `[보강]` 을 앞에 붙인다', () => {
    const [first] = parseBogang(sample);
    expect(first.question).toBe('[보강] C언어 서식문자열 & 제어문자');
  });

  it('answer 는 다음 `### 보강` 헤딩 직전까지 모은다', () => {
    const [first] = parseBogang(sample);
    expect(first.answer).toContain('%d  정수 10진수');
    expect(first.answer).toContain('**자주 나오는 함정**');
    expect(first.answer).not.toContain('연산자 우선순위');
  });

  it('answer 는 `## Part` 헤딩에서도 멈춘다', () => {
    const [card] = parseBogang(
      ['### 보강 1: 첫 카드', '본문 A', '', '## Part 3. 다음 파트', '다른 파트 본문'].join('\n')
    );
    expect(card.answer).toBe('본문 A');
  });

  it('question 키워드로 카테고리를 매핑한다', () => {
    const [first] = parseBogang(sample);
    expect(first.category).toBe('OS/기타'); // 'C언어' → OS/기타

    const map = (title) => parseBogang(`### 보강 1: ${title}\n내용\n`)[0].category;
    expect(map('UML 다이어그램 상세')).toBe('디자인패턴/UML');
    expect(map('인덱스 & 뷰 & 트랜잭션')).toBe('데이터베이스');
    expect(map('화이트박스 / 블랙박스 테스트 상세')).toBe('테스트');
    expect(map('DoS 공격 유형 상세')).toBe('보안/네트워크');
    expect(map('DFD 구성요소')).toBe('소프트웨어공학');
  });

  it('매핑되는 키워드가 없으면 기본 카테고리는 OS/기타 다', () => {
    const [card] = parseBogang('### 보강 1: 아무 키워드도 없는 제목\n내용\n');
    expect(card.category).toBe('OS/기타');
  });

  it('키워드가 여러 개 걸리면 categoryMap 선언 순서상 먼저 오는 것을 쓴다', () => {
    // 'C언어'(OS/기타) 가 '테스트'(테스트) 보다 먼저 선언되어 있다
    const [card] = parseBogang('### 보강 1: C언어 테스트\n내용\n');
    expect(card.category).toBe('OS/기타');
  });
});

describe('parseBogang — 엣지 케이스', () => {
  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(parseBogang('')).toEqual([]);
  });

  it('`### 보강` 헤딩이 없으면 빈 배열을 반환한다', () => {
    expect(parseBogang('# 제목\n\n## Part 1. 표만 있는 파트\n| a | b |\n')).toEqual([]);
  });

  it('제목 없이 `### 보강 N:` 만 있으면 카드로 보지 않는다', () => {
    expect(parseBogang('### 보강 1:\n내용\n')).toEqual([]);
  });

  it('본문이 없는 카드는 answer 가 빈 문자열이다', () => {
    const cards = parseBogang('### 보강 1: 본문 없음\n### 보강 2: 본문 있음\n내용\n');
    expect(cards[0].answer).toBe('');
    expect(cards[1].answer).toBe('내용');
  });

  it('본문 안의 `---` 구분선을 제거한다 (빈 줄은 남는다)', () => {
    const [card] = parseBogang('### 보강 1: 제목\n첫 줄\n\n---\n\n둘째 줄\n');
    expect(card.answer).not.toContain('---');
    expect(card.answer).toBe('첫 줄\n\n\n둘째 줄');
  });

  it('제목 전체가 대괄호면 question 이 `[보강]` 만 남는다', () => {
    const [card] = parseBogang('### 보강 1: [암기 001]\n내용\n');
    expect(card.question).toBe('[보강] ');
  });
});
