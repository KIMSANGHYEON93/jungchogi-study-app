// @vitest-environment jsdom
//
// 간격 반복 판정의 **동치성 고정 테스트**.
//
// 화면(`src/utils/storage.js` 의 `getSpacedRepetitionDue`)과 플래너 서버
// (`lib/ai/spacedRepetition.js` 의 `selectDueReviews`)가 같은 오답노트에 대해
// 언제나 같은 답을 내야 한다. 규칙이 갈리면 "오늘의 계획"이 화면의 복습 대기 목록과
// 어긋나 학습자가 무엇을 믿어야 할지 모르게 된다.
//
// `src/` 는 브라우저 전역(localStorage)에 묶여 있어 서버에서 그대로 쓸 수 없다.
// 그래서 서버에 같은 규칙을 별도로 구현하고, **같은 입력 → 같은 출력**을 여기서 못 박는다.
// 규칙을 한쪽만 고치면 이 파일이 깨진다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getSpacedRepetitionDue } from '../src/utils/storage.js';
import { selectDueReviews, SPACED_INTERVAL_DAYS } from '../lib/ai/spacedRepetition.js';

const DAY = 24 * 60 * 60 * 1000;
/** 고정 기준 시각 (2026-09-03 00:00 KST) */
const NOW = new Date('2026-09-02T15:00:00.000Z').getTime();

/** 오답노트 한 건. `daysAgo` 는 마지막 복습(없으면 등록) 시점까지의 경과일. */
function note(id, overrides = {}) {
  return { source: 'quiz100', id, question: `문항 ${id}`, reviewCount: 0, mastered: false, ...overrides };
}

/** 화면 쪽 함수가 읽는 localStorage 에 오답노트를 심는다. */
function seed(notes) {
  localStorage.setItem('jungchogi_wrong_notes', JSON.stringify(notes));
}

/** 두 구현에 같은 입력을 주고 결과 id 목록을 비교한다. */
function bothAgree(notes) {
  seed(notes);
  const browser = getSpacedRepetitionDue().map((n) => n.id);
  const server = selectDueReviews(notes, NOW).map((n) => n.id);
  return { browser, server };
}

describe('selectDueReviews — src/utils/storage.js 의 getSpacedRepetitionDue 와 동치', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('간격은 1/3/7일이다', () => {
    expect(SPACED_INTERVAL_DAYS).toEqual([1, 3, 7]);
  });

  const cases = [
    ['mastered 인 노트는 제외한다', [note('001', { mastered: true, lastReviewed: NOW - 30 * DAY })]],
    ['시각 정보가 전혀 없으면 바로 대기 목록에 넣는다', [note('002')]],
    [
      'reviewCount 0 → 1일: 0.9일 전은 아직, 1일 전은 대기',
      [
        note('010', { reviewCount: 0, lastReviewed: NOW - 0.9 * DAY }),
        note('011', { reviewCount: 0, lastReviewed: NOW - 1 * DAY }),
      ],
    ],
    [
      'reviewCount 1 → 3일: 2.9일 전은 아직, 3일 전은 대기',
      [
        note('020', { reviewCount: 1, lastReviewed: NOW - 2.9 * DAY }),
        note('021', { reviewCount: 1, lastReviewed: NOW - 3 * DAY }),
      ],
    ],
    [
      'reviewCount 2 → 7일: 6.9일 전은 아직, 7일 전은 대기',
      [
        note('030', { reviewCount: 2, lastReviewed: NOW - 6.9 * DAY }),
        note('031', { reviewCount: 2, lastReviewed: NOW - 7 * DAY }),
      ],
    ],
    [
      'reviewCount 가 3 이상이어도 간격은 7일에서 멈춘다',
      [
        note('040', { reviewCount: 9, lastReviewed: NOW - 6.9 * DAY }),
        note('041', { reviewCount: 9, lastReviewed: NOW - 7 * DAY }),
      ],
    ],
    [
      'reviewCount 가 없으면 7일 간격으로 본다',
      [
        note('050', { reviewCount: undefined, lastReviewed: NOW - 6.9 * DAY }),
        note('051', { reviewCount: undefined, lastReviewed: NOW - 7 * DAY }),
      ],
    ],
    [
      'reviewCount 가 음수여도 7일 간격으로 본다',
      [
        note('060', { reviewCount: -1, lastReviewed: NOW - 6.9 * DAY }),
        note('061', { reviewCount: -1, lastReviewed: NOW - 7 * DAY }),
      ],
    ],
    [
      'lastReviewed 가 있으면 addedAt 보다 우선한다',
      [note('070', { reviewCount: 0, addedAt: NOW - 30 * DAY, lastReviewed: NOW - 0.5 * DAY })],
    ],
    [
      'lastReviewed 가 0 이면 addedAt 으로 되돌아간다',
      [note('080', { reviewCount: 0, addedAt: NOW - 5 * DAY, lastReviewed: 0 })],
    ],
    ['빈 목록', []],
  ];

  it.each(cases)('%s', (_label, notes) => {
    const { browser, server } = bothAgree(notes);
    expect(server).toEqual(browser);
  });

  it('여러 노트를 섞어도 같은 집합을, 같은 순서로 돌려준다', () => {
    const notes = cases.flatMap(([, ns]) => ns);
    const { browser, server } = bothAgree(notes);
    expect(server).toEqual(browser);
    // 순서만 우연히 같은 게 아니라 실제로 걸러진 것이 있어야 의미가 있다
    expect(server.length).toBeGreaterThan(0);
    expect(server.length).toBeLessThan(notes.length);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const notes = [note('090', { lastReviewed: NOW - 10 * DAY })];
    const before = JSON.stringify(notes);
    selectDueReviews(notes, NOW);
    expect(JSON.stringify(notes)).toBe(before);
  });

  it('배열이 아니면 빈 목록을 돌려준다 (신뢰할 수 없는 스냅샷 방어)', () => {
    expect(selectDueReviews(null, NOW)).toEqual([]);
    expect(selectDueReviews(undefined, NOW)).toEqual([]);
    expect(selectDueReviews('노트', NOW)).toEqual([]);
  });
});
