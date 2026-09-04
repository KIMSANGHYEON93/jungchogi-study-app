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
  examResults: {},
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

describe('모의고사 채점 결과(examResults)도 센다', () => {
  it('모의고사에서만 푼 문항도 시도·오답에 들어간다', () => {
    // 이걸 못 세던 것이 Phase 3 이 남긴 구멍이다 — 모의고사를 아무리 봐도
    // 약점 분석에는 한 글자도 반영되지 않았다
    const result = runGetWeakCategories(snapshot({ examResults: { '001': 'incorrect' } }));

    expect(byName(result)['데이터베이스']).toEqual({
      category: '데이터베이스',
      attempted: 1,
      wrong: 1,
      accuracy: 0,
    });
  });

  it('quizResults 와 같은 값 계약을 쓴다', () => {
    const result = runGetWeakCategories(
      snapshot({ examResults: { '001': 'correct', '002': 'incorrect' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 2, wrong: 1, accuracy: 0.5 });
  });

  it('오답노트 추정보다 모의고사 채점이 먼저다', () => {
    const result = runGetWeakCategories(
      snapshot({
        wrongNotes: [note('quiz100', '001')],
        examResults: { '001': 'correct' },
      })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 0 });
  });

  it('두 맵에 같은 문항이 있어도 시도는 한 번만 센다', () => {
    const result = runGetWeakCategories(
      snapshot({ quizResults: { '001': 'incorrect' }, examResults: { '001': 'incorrect' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 1 });
  });

  // ── 겹치는 문항의 우선순위 ──
  //
  // 두 맵 모두 타임스탬프가 없어 "더 최근 것"을 고를 수 없다. 그래서 순서를 규칙으로
  // 못 박는다: **모의고사 채점이 코드 퀴즈 채점을 이긴다.**
  // 모의고사는 정답을 가린 채 시간 제한 아래에서 한 번에 푸는 실전 조건이고,
  // 코드 퀴즈는 "정답 확인" 버튼이 바로 옆에 있는 연습 화면이다. 실력 추정으로서
  // 앞의 것이 뒤의 것보다 낫다. 아는 것이 추정을 이긴다는 기존 규칙의 연장이다.

  it('같은 문항이 코드 퀴즈에서는 정답, 모의고사에서는 오답이면 오답으로 센다', () => {
    const result = runGetWeakCategories(
      snapshot({ quizResults: { '001': 'correct' }, examResults: { '001': 'incorrect' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 1, accuracy: 0 });
  });

  it('반대 방향도 같은 규칙이다 — 모의고사에서 맞았으면 오답이 아니다', () => {
    const result = runGetWeakCategories(
      snapshot({ quizResults: { '001': 'incorrect' }, examResults: { '001': 'correct' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 0, accuracy: 1 });
  });

  it("모의고사의 'answered' 는 코드 퀴즈의 확정 판정을 덮지 않는다", () => {
    // 우선순위는 **아는 것끼리**의 규칙이다. 정오 미상이 확정을 밀어내면
    // "아는 것이 추정을 이긴다"가 뒤집힌다
    const result = runGetWeakCategories(
      snapshot({ quizResults: { '001': 'incorrect' }, examResults: { '001': 'answered' } })
    );

    expect(byName(result)['데이터베이스']).toMatchObject({ attempted: 1, wrong: 1 });
  });
});

describe('examResults 를 모르는 옛 클라이언트', () => {
  it('필드가 없어도 예전과 똑같이 계산한다', () => {
    const old = snapshot({ quizResults: { '001': 'incorrect' } });
    delete old.examResults;

    expect(byName(runGetWeakCategories(old))['데이터베이스']).toMatchObject({
      attempted: 1,
      wrong: 1,
    });
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
