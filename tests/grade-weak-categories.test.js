// `get_weak_categories` — 채점 결과가 저장되기 시작한 뒤의 정답률 계산 (블루프린트 §5 Phase 3).
//
// 저장 포맷은 클라이언트와 합의된 고정 계약이다:
//   quiz_results 의 값: 'correct' | 'incorrect' | 'answered'
//     'correct'/'incorrect' — Phase 3 자동 채점이 남기는 정오 결과
//     'answered'            — 레거시. "시도했으나 정오 미상"
//
// 두 세대가 섞인 상태에서도 합리적인 값이 나와야 한다:
//   정오를 아는 문항은 그 값을 그대로 세고, 모르는 문항만 오답노트로 추정한다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runGetWeakCategories } from '../lib/ai/tools/snapshotTools.js';
import { clearContentCache } from '../lib/ai/content.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

/** 오답노트 한 건 (계산에 쓰는 필드만) */
const note = (source, id, { mastered = false, category = '' } = {}) => ({
  source,
  id,
  question: '',
  category,
  reviewCount: 0,
  mastered,
  addedAt: 1,
  lastReviewed: 0,
});

const snapshot = (overrides = {}) => ({
  examDate: null,
  wrongNotes: [],
  quizResults: {},
  studyTime: {},
  dayChecks: {},
  availableMinutes: 60,
  ...overrides,
});

/** 카테고리명 → 통계 */
const byName = (result) => Object.fromEntries(result.categories.map((c) => [c.category, c]));

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

describe('채점 결과(correct|incorrect)를 그대로 센다', () => {
  it("'correct' 는 시도 1 · 오답 0", () => {
    const result = runGetWeakCategories(snapshot({ quizResults: { '001': 'correct' } }));

    expect(byName(result)['데이터베이스']).toEqual({
      category: '데이터베이스',
      attempted: 1,
      wrong: 0,
      accuracy: 1,
    });
  });

  it("'incorrect' 는 오답노트에 없어도 오답으로 센다", () => {
    const result = runGetWeakCategories(snapshot({ quizResults: { '001': 'incorrect' } }));

    expect(byName(result)['데이터베이스']).toEqual({
      category: '데이터베이스',
      attempted: 1,
      wrong: 1,
      accuracy: 0,
    });
  });

  it('같은 카테고리 안에서 correct 와 incorrect 가 섞이면 비율로 계산한다', () => {
    const result = runGetWeakCategories(
      snapshot({ quizResults: { '001': 'correct', '002': 'incorrect' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 2, wrong: 1, accuracy: 0.5 });
  });
});

describe('채점 결과가 오답노트 추정을 이긴다', () => {
  it("오답노트에 미숙달로 남아 있어도 'correct' 면 오답으로 세지 않는다", () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [note('quiz100', '001')],
        quizResults: { '001': 'correct' },
      })
    );

    // 같은 문항이므로 시도는 1회로 합쳐지고, 최신 채점 결과(정답)를 따른다
    expect(byName(result)['데이터베이스']).toEqual({
      category: '데이터베이스',
      attempted: 1,
      wrong: 0,
      accuracy: 1,
    });
  });

  it("오답노트에서 숙달 처리됐어도 'incorrect' 면 오답으로 센다", () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [note('quiz100', '026', { mastered: true })],
        quizResults: { '026': 'incorrect' },
      })
    );

    expect(byName(result)['소프트웨어공학']).toMatchObject({ attempted: 1, wrong: 1, accuracy: 0 });
  });
});

describe("레거시 'answered' 는 오답노트로 추정한다 (Phase 2 정의 유지)", () => {
  it('오답노트에 없으면 정답으로 본다', () => {
    const result = runGetWeakCategories(snapshot({ quizResults: { '002': 'answered' } }));

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 0 });
  });

  it('오답노트에 미숙달로 있으면 오답으로 본다', () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [note('quiz100', '001')],
        quizResults: { '001': 'answered' },
      })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 1 });
  });

  it('계약 밖의 값은 레거시와 같게 다룬다 (정오 미상)', () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [note('quiz100', '001')],
        quizResults: { '001': 'skipped', '002': 'skipped' },
      })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 2, wrong: 1, accuracy: 0.5 });
  });
});

describe('신·구 데이터가 섞인 스냅샷', () => {
  it('아는 것은 세고 모르는 것만 추정해 카테고리 정답률을 낸다', () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [
          note('quiz100', '002'), // 정오 미상 + 미숙달 → 오답으로 추정
          note('codedrill', 'C-01'), // quizResults 에 없음 → 오답으로 추정
          note('codedrill', 'J-01', { mastered: true }), // 숙달 → 오답 아님
        ],
        quizResults: {
          '001': 'correct', // 채점 결과 (신)
          '002': 'answered', // 레거시 (구) → 오답노트 미숙달이라 오답
          '026': 'incorrect', // 채점 결과 (신)
          'S-01': 'answered', // 레거시 (구) → 오답노트에 없어 정답
        },
      })
    );
    const stats = byName(result);

    expect(stats['데이터베이스']).toMatchObject({ attempted: 2, wrong: 1, accuracy: 0.5 });
    expect(stats['소프트웨어공학']).toMatchObject({ attempted: 1, wrong: 1, accuracy: 0 });
    expect(stats['c']).toMatchObject({ attempted: 1, wrong: 1, accuracy: 0 });
    expect(stats['java']).toMatchObject({ attempted: 1, wrong: 0, accuracy: 1 });
    expect(stats['sql']).toMatchObject({ attempted: 1, wrong: 0, accuracy: 1 });
  });

  it('채점 결과가 정렬 순서를 바꾼다 (정답률 낮은 순)', () => {
    const result = runGetWeakCategories(
      snapshot({
        // 오답노트가 비어 있으므로 정답률은 오직 채점 결과로만 갈린다
        quizResults: {
          '001': 'correct',
          '002': 'incorrect', // 데이터베이스 → 0.5
          '026': 'incorrect', // 소프트웨어공학 → 0
          'S-01': 'correct', // sql → 1
        },
      })
    );

    expect(result.categories.map((c) => c.category)).toEqual([
      '소프트웨어공학',
      '데이터베이스',
      'sql',
    ]);
  });
});
