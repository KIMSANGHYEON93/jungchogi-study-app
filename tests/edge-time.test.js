// @vitest-environment jsdom
//
// 시간 경우의 수 하드닝.
//
// 이 앱은 날짜를 **로컬(한국) 기준으로 통일**했다(블루프린트 P8). 서버는 UTC 로 돌지만
// `todayInSeoul` 로 같은 날짜를 만든다. 이 둘이 어긋나면 계획이 하루 밀린 날짜로
// 저장되고 화면이 "오늘 계획 없음" 을 띄운다 — 조용히 틀리는 종류의 결함이다.
//
// 훑는 축: 자정 경계 · 서버(UTC)와 화면(로컬)의 일치 · 시계가 뒤로 간 경우 · 지난 시험일.
//
// 테스트 시간대는 `vite.config.js` 가 Asia/Seoul 로 고정한다 (CI 는 UTC 라
// 고정하지 않으면 로컬 = UTC 가 되어 이 회귀를 걸러내지 못한다).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  toLocalDateKey,
  addStudyTime,
  getStudyTimeLog,
  getWeeklyStudyTime,
  getSpacedRepetitionDue,
  saveStudyPlan,
  getStudyPlan,
  listStudyPlanDates,
} from '../src/utils/storage.js';
import { selectDueReviews } from '../lib/ai/spacedRepetition.js';
import { todayInSeoul } from '../api/ai/plan.js';
import { validatePlanBody } from '../lib/ai/guard.js';

const NOTES_KEY = 'jungchogi_wrong_notes';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('테스트 시간대 전제', () => {
  it('Asia/Seoul 로 고정돼 있다 (아니면 아래 기대값이 무의미하다)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Seoul');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 자정 경계
// ─────────────────────────────────────────────────────────────────────────────

describe('자정 경계', () => {
  it.each([
    ['자정 1밀리초 전', '2026-09-04T14:59:59.999Z', '2026-09-04'],
    ['자정 정각', '2026-09-04T15:00:00.000Z', '2026-09-05'],
    ['자정 1밀리초 후', '2026-09-04T15:00:00.001Z', '2026-09-05'],
    ['새벽 3시', '2026-09-04T18:00:00.000Z', '2026-09-05'],
  ])('%s: 화면의 날짜 키가 로컬 기준으로 넘어간다', (_label, iso, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    expect(toLocalDateKey()).toBe(expected);
  });

  it.each([
    ['자정 1밀리초 전', '2026-09-04T14:59:59.999Z', '2026-09-04'],
    ['자정 정각', '2026-09-04T15:00:00.000Z', '2026-09-05'],
    ['UTC 로는 아직 어제', '2026-09-04T16:30:00.000Z', '2026-09-05'],
  ])('%s: 서버의 계획 날짜도 같은 값이다', (_label, iso, expected) => {
    expect(todayInSeoul(Date.parse(iso))).toBe(expected);
  });

  it('서버(UTC)와 화면(로컬)의 날짜가 하루 내내 일치한다', () => {
    vi.useFakeTimers();
    // 1시간 간격으로 하루를 훑는다 — 한 칸이라도 어긋나면 계획이 밀린 날짜에 저장된다
    for (let hour = 0; hour < 24; hour += 1) {
      const at = Date.parse(`2026-09-04T${String(hour).padStart(2, '0')}:30:00.000Z`);
      vi.setSystemTime(new Date(at));
      expect(todayInSeoul(at)).toBe(toLocalDateKey());
    }
  });

  it('학습 시간은 자정을 넘기면 다음 날 칸에 쌓인다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T14:50:00.000Z')); // 23:50 KST
    addStudyTime(10);
    vi.setSystemTime(new Date('2026-09-04T15:10:00.000Z')); // 00:10 KST (다음 날)
    addStudyTime(20);

    expect(getStudyTimeLog()).toEqual({ '2026-09-04': 10, '2026-09-05': 20 });
  });

  it('주간 통계는 자정 직후에도 7일치 서로 다른 날짜를 준다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T15:00:00.000Z')); // 00:00 KST
    const week = getWeeklyStudyTime();

    expect(week).toHaveLength(7);
    expect(new Set(week.map((d) => d.date)).size).toBe(7);
    expect(week.at(-1).date).toBe('2026-09-05');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시계가 뒤로 갔을 때
// ─────────────────────────────────────────────────────────────────────────────

describe('시계가 뒤로 간 경우', () => {
  const futureNote = (overrides = {}) => ({
    source: 'quiz100',
    id: '001',
    reviewCount: 0,
    mastered: false,
    addedAt: Date.now() + 30 * DAY, // 미래에 추가된 것으로 기록됨
    ...overrides,
  });

  it('미래 시각이 찍힌 노트를 복습 대기로 잡지 않는다 (화면)', () => {
    localStorage.setItem(NOTES_KEY, JSON.stringify([futureNote()]));
    expect(getSpacedRepetitionDue()).toEqual([]);
  });

  it('미래 시각이 찍힌 노트를 복습 대기로 잡지 않는다 (서버)', () => {
    expect(selectDueReviews([futureNote()], Date.now())).toEqual([]);
  });

  it('시계를 되돌려도 복습 판정이 화면과 서버에서 같다', () => {
    const now = Date.parse('2026-09-04T00:00:00.000Z');
    const notes = [
      futureNote({ id: '001', addedAt: now + DAY }),
      futureNote({ id: '002', addedAt: now - 2 * DAY }),
      futureNote({ id: '003', lastReviewed: now + 10 * DAY, addedAt: now - 30 * DAY }),
    ];
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const screen = getSpacedRepetitionDue().map((n) => n.id);
    const server = selectDueReviews(notes, now).map((n) => n.id);

    expect(screen).toEqual(server);
    expect(screen).toEqual(['002']);
  });

  it('학습 시간을 되돌려도 지난 날 기록을 덮어쓰지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T02:00:00.000Z'));
    addStudyTime(30);
    vi.setSystemTime(new Date('2026-09-04T02:00:00.000Z')); // 하루 뒤로
    addStudyTime(15);

    expect(getStudyTimeLog()).toEqual({ '2026-09-05': 30, '2026-09-04': 15 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 지난 시험일
// ─────────────────────────────────────────────────────────────────────────────

describe('examDate 가 과거일 때', () => {
  const snapshot = (examDate) => ({
    snapshot: {
      examDate,
      wrongNotes: [],
      quizResults: {},
      studyTime: {},
      dayChecks: {},
      availableMinutes: 60,
    },
  });

  it('지난 시험일도 요청을 막지 않는다 (다음 회차 준비를 계속할 수 있어야 한다)', () => {
    const result = validatePlanBody(snapshot('2020-01-01'));
    expect(result.ok).toBe(true);
    expect(result.value.snapshot.examDate).toBe('2020-01-01');
  });

  it('형식이 아닌 시험일은 거절한다', () => {
    for (const bad of ['2026/09/04', '2026-9-4', '어제', '', '2026-09-04T00:00:00Z', 20260904]) {
      expect(validatePlanBody(snapshot(bad)).ok).toBe(false);
    }
  });

  it('시험일이 없어도(null·undefined) 계획을 세울 수 있다', () => {
    expect(validatePlanBody(snapshot(null)).value.snapshot.examDate).toBeNull();
    expect(validatePlanBody(snapshot(undefined)).value.snapshot.examDate).toBeNull();
  });

  it('달력에 없는 날짜여도 형식만 맞으면 통과한다 (서버가 D-Day 만 셈한다)', () => {
    // 2026-02-30 은 존재하지 않지만 요청 전체를 막을 이유는 없다.
    // 막으면 사용자가 왜 계획을 못 만드는지 알 길이 없다.
    expect(validatePlanBody(snapshot('2026-02-30')).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 계획 저장의 날짜 키
// ─────────────────────────────────────────────────────────────────────────────

describe('계획 저장 날짜', () => {
  it('자정을 넘긴 뒤 저장한 계획은 새 날짜 키로 들어간다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T14:50:00.000Z'));
    saveStudyPlan({ date: toLocalDateKey(), items: [], rationale: '', riskFlags: [] });
    vi.setSystemTime(new Date('2026-09-04T15:10:00.000Z'));
    saveStudyPlan({ date: toLocalDateKey(), items: [], rationale: '', riskFlags: [] });

    expect(listStudyPlanDates()).toEqual(['2026-09-05', '2026-09-04']);
  });

  it('같은 날짜로 두 번 빠르게 저장하면 마지막 것만 남는다 (재생성)', () => {
    const date = '2026-09-04';
    saveStudyPlan({ date, items: [], rationale: '첫 번째', riskFlags: [] });
    saveStudyPlan({ date, items: [], rationale: '두 번째', riskFlags: [] });

    expect(listStudyPlanDates()).toEqual([date]);
    expect(getStudyPlan(date).rationale).toBe('두 번째');
  });

  it('날짜가 아닌 키로 저장된 계획은 목록에 세지 않는다', () => {
    saveStudyPlan({ date: '__proto__', items: [], rationale: '', riskFlags: [] });
    expect(listStudyPlanDates()).toEqual([]);
    // 그래도 값 자체는 자기 자리에 들어가 있다 (프로토타입을 건드리지 않는다)
    expect(getStudyPlan('__proto__')).toEqual({
      date: '__proto__',
      items: [],
      rationale: '',
      riskFlags: [],
    });
    expect({}.rationale).toBeUndefined();
  });
});
