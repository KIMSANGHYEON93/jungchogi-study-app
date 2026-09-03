import { describe, it, expect } from 'vitest';
import {
  GENERATED_CONTRACT_VERSION,
  GENERATED_SOURCES,
  acceptGeneratedFile,
  mergeGenerated,
  isGeneratedItem,
} from '../src/domain/generatedItems.js';

// 계약(BLUEPRINT §4.4)에 맞는 최소 파일을 만든다. 테스트마다 어긴 곳만 덮어쓴다.
function quizFile(overrides = {}) {
  return {
    version: GENERATED_CONTRACT_VERSION,
    source: 'quiz100',
    generatedAt: '2026-09-03T12:00:00.000Z',
    model: 'claude-opus-5',
    reviewed: true,
    items: [quizItem()],
    ...overrides,
  };
}

function quizItem(overrides = {}) {
  return {
    id: '001-v1',
    question: '트랜잭션의 격리성을 설명하시오.',
    answer: 'Isolation — 동시 실행 트랜잭션이 서로 간섭하지 않는 성질',
    category: '데이터베이스',
    variantOf: '001',
    generated: true,
    ...overrides,
  };
}

function drillItem(overrides = {}) {
  return {
    id: 'C-01-v1',
    title: '포인터 기본 변형',
    context: '',
    code: 'int a = 1;',
    lang: 'c',
    answer: '출력: 1',
    expectedOutput: '1',
    pitfall: '',
    variantOf: 'C-01',
    generated: true,
    ...overrides,
  };
}

const QUIZ_BASE = [
  { id: '001', question: 'q1', answer: 'a1', category: '데이터베이스' },
  { id: '002', question: 'q2', answer: 'a2', category: '데이터베이스' },
];

const DRILL_BASE = [
  { id: 'C-01', title: 't', context: '', code: 'c', lang: 'c', answer: 'a', expectedOutput: '', pitfall: '' },
];

describe('계약 상수', () => {
  it('앱이 아는 생성물 버전은 1이다', () => {
    expect(GENERATED_CONTRACT_VERSION).toBe(1);
  });

  it('생성물 source 는 교재 3종뿐이다', () => {
    expect(GENERATED_SOURCES).toEqual(['quiz100', 'codedrill', 'bogang']);
  });
});

describe('acceptGeneratedFile — 파일 단위 관문', () => {
  it('계약에 맞는 검수 완료 파일의 문항을 통과시킨다', () => {
    const { items, warnings } = acceptGeneratedFile(quizFile(), 'quiz100');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('001-v1');
    expect(warnings).toEqual([]);
  });

  // ★ 이 앱에서 가장 중요한 규칙 — 사람 검수를 통과하지 않은 생성물은 학습에 들어가지 않는다
  it('reviewed 가 false 면 문항을 하나도 내주지 않는다', () => {
    const { items, warnings } = acceptGeneratedFile(quizFile({ reviewed: false }), 'quiz100');
    expect(items).toEqual([]);
    expect(warnings.join(' ')).toContain('reviewed');
  });

  it('reviewed 필드가 아예 없으면 통과시키지 않는다', () => {
    const raw = quizFile();
    delete raw.reviewed;
    expect(acceptGeneratedFile(raw, 'quiz100').items).toEqual([]);
  });

  it('reviewed 가 문자열 "true" 여도 통과시키지 않는다', () => {
    // 느슨한 진리값 판정이면 통과해 버린다. 검수 통과는 정확히 boolean true 여야 한다.
    expect(acceptGeneratedFile(quizFile({ reviewed: 'true' }), 'quiz100').items).toEqual([]);
  });

  it('모르는 version 이면 통과시키지 않는다', () => {
    const { items, warnings } = acceptGeneratedFile(quizFile({ version: 2 }), 'quiz100');
    expect(items).toEqual([]);
    expect(warnings.join(' ')).toContain('version');
  });

  it('파일이 선언한 source 가 요청한 교재와 다르면 통과시키지 않는다', () => {
    const { items, warnings } = acceptGeneratedFile(quizFile({ source: 'bogang' }), 'quiz100');
    expect(items).toEqual([]);
    expect(warnings.join(' ')).toContain('source');
  });

  it('items 가 배열이 아니면 통과시키지 않는다', () => {
    expect(acceptGeneratedFile(quizFile({ items: null }), 'quiz100').items).toEqual([]);
  });

  it('파일 자체가 객체가 아니면 통과시키지 않는다', () => {
    expect(acceptGeneratedFile(null, 'quiz100').items).toEqual([]);
    expect(acceptGeneratedFile('[]', 'quiz100').items).toEqual([]);
  });
});

describe('mergeGenerated — 문항 단위 관문', () => {
  it('원본 뒤에 변형을 덧붙인다', () => {
    const { items } = mergeGenerated(QUIZ_BASE, [quizItem()], 'quiz100');
    expect(items.map((i) => i.id)).toEqual(['001', '002', '001-v1']);
  });

  it('원본의 순서와 위치를 그대로 둔다', () => {
    const { items } = mergeGenerated(
      QUIZ_BASE,
      [quizItem({ id: '002-v1', variantOf: '002' }), quizItem()],
      'quiz100'
    );
    // 원본은 앞쪽 인덱스를 그대로 지킨다 — 변형을 켜도 기존 문항 번호가 밀리지 않는다
    expect(items.slice(0, QUIZ_BASE.length)).toEqual(QUIZ_BASE);
    // 변형끼리도 받은 순서를 지킨다
    expect(items.slice(QUIZ_BASE.length).map((i) => i.id)).toEqual(['002-v1', '001-v1']);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const base = [...QUIZ_BASE];
    mergeGenerated(base, [quizItem()], 'quiz100');
    expect(base).toEqual(QUIZ_BASE);
  });

  it('생성물이 없으면 원본을 그대로 돌려준다', () => {
    const { items, warnings } = mergeGenerated(QUIZ_BASE, [], 'quiz100');
    expect(items).toEqual(QUIZ_BASE);
    expect(warnings).toEqual([]);
  });

  it('id 가 원본과 충돌하면 버리고 경고한다', () => {
    // 같은 id 를 두 문항이 나눠 쓰면 flashcard_known·quiz_results 가 서로를 덮어쓴다
    const { items, warnings } = mergeGenerated(QUIZ_BASE, [quizItem({ id: '001' })], 'quiz100');
    expect(items).toEqual(QUIZ_BASE);
    expect(warnings.join(' ')).toContain('001');
  });

  it('생성물끼리 id 가 겹치면 뒤엣것을 버리고 경고한다', () => {
    const { items, warnings } = mergeGenerated(
      QUIZ_BASE,
      [quizItem(), quizItem({ question: '다른 질문' })],
      'quiz100'
    );
    expect(items.filter((i) => i.id === '001-v1')).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });

  it('generated 표시가 없는 문항은 버리고 경고한다', () => {
    // 표시가 없으면 화면이 배지를 못 붙여 교재 문항으로 오인된다
    const raw = quizItem();
    delete raw.generated;
    const { items, warnings } = mergeGenerated(QUIZ_BASE, [raw], 'quiz100');
    expect(items).toEqual(QUIZ_BASE);
    expect(warnings.join(' ')).toContain('generated');
  });

  it('variantOf 가 원본 덱에 없으면 버리고 경고한다', () => {
    // 교재가 바뀐 뒤 다시 생성하지 않은 낡은 파일을 걸러낸다
    const { items, warnings } = mergeGenerated(
      QUIZ_BASE,
      [quizItem({ id: '099-v1', variantOf: '099' })],
      'quiz100'
    );
    expect(items).toEqual(QUIZ_BASE);
    expect(warnings.join(' ')).toContain('variantOf');
  });

  it('answer 가 비면 버린다', () => {
    const { items } = mergeGenerated(QUIZ_BASE, [quizItem({ answer: '' })], 'quiz100');
    expect(items).toEqual(QUIZ_BASE);
  });

  it('quiz100 변형에 question 이 없으면 버린다', () => {
    const { items } = mergeGenerated(QUIZ_BASE, [quizItem({ question: '' })], 'quiz100');
    expect(items).toEqual(QUIZ_BASE);
  });

  it('codedrill 변형에 code 가 없으면 버린다', () => {
    const { items } = mergeGenerated(DRILL_BASE, [drillItem({ code: '' })], 'codedrill');
    expect(items).toEqual(DRILL_BASE);
  });

  it('codedrill 변형의 lang 이 교재 4종 밖이면 버린다', () => {
    const { items, warnings } = mergeGenerated(DRILL_BASE, [drillItem({ lang: 'rust' })], 'codedrill');
    expect(items).toEqual(DRILL_BASE);
    expect(warnings.join(' ')).toContain('lang');
  });

  it('계약에 맞는 codedrill 변형은 통과시킨다', () => {
    const { items } = mergeGenerated(DRILL_BASE, [drillItem()], 'codedrill');
    expect(items.map((i) => i.id)).toEqual(['C-01', 'C-01-v1']);
    expect(items[1].lang).toBe('c');
  });

  it('한 항목이 계약을 어겨도 나머지는 통과시킨다', () => {
    const { items, warnings } = mergeGenerated(
      QUIZ_BASE,
      [quizItem({ id: '001-v1' }), quizItem({ id: '002-v1', variantOf: '002', answer: '' })],
      'quiz100'
    );
    expect(items.map((i) => i.id)).toEqual(['001', '002', '001-v1']);
    expect(warnings).toHaveLength(1);
  });

  it('경고에는 문제가 된 문항 id 가 들어간다', () => {
    const { warnings } = mergeGenerated(QUIZ_BASE, [quizItem({ id: '002-v9', answer: '' })], 'quiz100');
    expect(warnings[0]).toContain('002-v9');
  });
});

describe('isGeneratedItem', () => {
  it('generated 표시가 있으면 변형으로 본다', () => {
    expect(isGeneratedItem({ id: '001-v1', generated: true })).toBe(true);
  });

  it('교재 문항은 변형이 아니다', () => {
    expect(isGeneratedItem({ id: '001' })).toBe(false);
    expect(isGeneratedItem({ id: 'C-01' })).toBe(false);
    expect(isGeneratedItem({ id: 'B01' })).toBe(false);
  });

  it('표시가 없어도 변형 id 모양이면 변형으로 본다', () => {
    // Phase 4 이전에 저장된 오답노트에는 generated 필드가 없다.
    // 그 항목으로 서버 API 를 부르면 400 이므로 id 모양으로도 걸러야 한다.
    expect(isGeneratedItem({ id: '001-v1' })).toBe(true);
    expect(isGeneratedItem({ id: 'C-01-v12' })).toBe(true);
  });

  it('빈 값은 변형이 아니다', () => {
    expect(isGeneratedItem(null)).toBe(false);
    expect(isGeneratedItem(undefined)).toBe(false);
    expect(isGeneratedItem({})).toBe(false);
  });
});
