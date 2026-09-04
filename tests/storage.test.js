// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveProgress,
  loadProgress,
  clearProgress,
  getWrongNotes,
  addWrongNote,
  removeWrongNote,
  markWrongNoteReviewed,
  clearAllWrongNotes,
  setExamDate,
  getExamDate,
  getStudyTimeLog,
  addStudyTime,
  getWeeklyStudyTime,
  getStorageUsage,
  formatBytes,
  getSpacedRepetitionDue,
  toLocalDateKey,
  saveStudyPlan,
  getStudyPlan,
  listStudyPlanDates,
  pruneStudyPlans,
  MAX_STORED_PLANS,
  getIncludeVariants,
  setIncludeVariants,
  VARIANT_RESULTS_KEY,
  variantKnownKey,
  EXAM_RESULTS_KEY,
  getExamResults,
  saveExamResults,
} from '../src/utils/storage.js';

const PREFIX = 'jungchogi_';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveProgress / loadProgress / clearProgress', () => {
  it('모든 키를 `jungchogi_` 접두사 아래에 쓴다', () => {
    saveProgress('day_checks', { 1: true });
    expect(localStorage.getItem(`${PREFIX}day_checks`)).toBe('{"1":true}');
    expect(localStorage.getItem('day_checks')).toBeNull();
  });

  it('JSON 직렬화·역직렬화를 왕복한다', () => {
    const value = { known: { '001': true }, list: [1, 2, 3], note: '한글', flag: false };
    saveProgress('round_trip', value);
    expect(loadProgress('round_trip')).toEqual(value);
  });

  it('없는 키는 fallback 을 돌려주고 기본 fallback 은 null 이다', () => {
    expect(loadProgress('nope')).toBeNull();
    expect(loadProgress('nope', {})).toEqual({});
    expect(loadProgress('nope', [])).toEqual([]);
  });

  it('빈 문자열이 저장돼 있으면 값이 아니라 fallback 을 돌려준다', () => {
    // `raw ? JSON.parse(raw) : fallback` 이라 falsy 문자열은 fallback 으로 빠진다
    localStorage.setItem(`${PREFIX}empty`, '');
    expect(loadProgress('empty', 'fallback')).toBe('fallback');
  });

  it('저장값이 `null` 이면 JSON.parse 결과인 null 을 그대로 돌려준다', () => {
    saveProgress('nullable', null);
    expect(localStorage.getItem(`${PREFIX}nullable`)).toBe('null');
    expect(loadProgress('nullable', 'fallback')).toBeNull();
  });

  it('손상된 JSON 은 예외 대신 fallback 을 돌려준다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(`${PREFIX}broken`, '{"a":');
    expect(loadProgress('broken', { safe: true })).toEqual({ safe: true });
    expect(loadProgress('broken')).toBeNull();
  });

  it('손상된 값을 만나면 조용히 넘어가지 않고 키 이름과 함께 콘솔 경고를 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(`${PREFIX}broken`, '{"a":');
    loadProgress('broken', {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain(`${PREFIX}broken`);
  });

  it('손상된 값을 지우지는 않는다 (내보내기로 복구할 여지를 남긴다)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(`${PREFIX}broken`, '{"a":');
    loadProgress('broken', {});
    expect(localStorage.getItem(`${PREFIX}broken`)).toBe('{"a":');
  });

  it('clearProgress 는 해당 키만 지운다', () => {
    saveProgress('a', 1);
    saveProgress('b', 2);
    clearProgress('a');
    expect(loadProgress('a')).toBeNull();
    expect(loadProgress('b')).toBe(2);
  });

  it('저장에 성공하면 true 를 돌려준다', () => {
    expect(saveProgress('ok', 1)).toBe(true);
  });

  it('용량이 넘쳐도 예외를 터뜨리지 않고 false 를 돌려주며 콘솔 경고를 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveProgress('big', 'x')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain(`${PREFIX}big`);
  });

  it('용량 초과가 아닌 예외는 삼키지 않고 그대로 전파한다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => saveProgress('x', 1)).toThrow(/denied/);
  });
});

describe('오답노트', () => {
  const note = { source: 'quiz', id: '001', question: '문제', answer: '정답' };

  it('오답노트가 없으면 빈 배열을 돌려준다', () => {
    expect(getWrongNotes()).toEqual([]);
  });

  it('추가한 노트에 addedAt·reviewCount·mastered 를 저장 계층이 채운다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    addWrongNote(note);
    const [saved] = getWrongNotes();
    expect(saved).toMatchObject({ ...note, reviewCount: 0, mastered: false });
    expect(saved.addedAt).toBe(Date.parse('2026-09-02T12:00:00Z'));
  });

  it('같은 source+id 를 다시 넣으면 새 항목이 아니라 갱신이다', () => {
    addWrongNote(note);
    addWrongNote({ ...note, question: '수정된 문제' });
    const notes = getWrongNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].question).toBe('수정된 문제');
  });

  it('source 가 다르면 id 가 같아도 별개 항목이다', () => {
    addWrongNote(note);
    addWrongNote({ ...note, source: 'code' });
    expect(getWrongNotes()).toHaveLength(2);
  });

  it('갱신할 때 기존 reviewCount 는 보존한다', () => {
    addWrongNote(note);
    markWrongNoteReviewed('quiz', '001');
    markWrongNoteReviewed('quiz', '001');
    addWrongNote({ ...note, question: '다시 틀림' });
    expect(getWrongNotes()[0].reviewCount).toBe(2);
  });

  it('복습 처리는 reviewCount 를 올리고 lastReviewed 를 찍는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    addWrongNote(note);
    markWrongNoteReviewed('quiz', '001');
    const [saved] = getWrongNotes();
    expect(saved.reviewCount).toBe(1);
    expect(saved.lastReviewed).toBe(Date.parse('2026-09-02T12:00:00Z'));
  });

  it('없는 노트를 복습 처리해도 조용히 넘어간다', () => {
    addWrongNote(note);
    markWrongNoteReviewed('quiz', '999');
    expect(getWrongNotes()[0].reviewCount).toBe(0);
  });

  it('removeWrongNote 는 source+id 가 모두 맞는 것만 지운다', () => {
    addWrongNote(note);
    addWrongNote({ ...note, id: '002' });
    removeWrongNote('quiz', '001');
    expect(getWrongNotes().map((n) => n.id)).toEqual(['002']);
    removeWrongNote('code', '002');
    expect(getWrongNotes()).toHaveLength(1);
  });

  it('clearAllWrongNotes 는 빈 배열을 저장한다', () => {
    addWrongNote(note);
    clearAllWrongNotes();
    expect(getWrongNotes()).toEqual([]);
    expect(localStorage.getItem(`${PREFIX}wrong_notes`)).toBe('[]');
  });
});

describe('간격 반복 (1/3/7일)', () => {
  const base = { source: 'quiz', question: 'q', answer: 'a' };
  const seed = (notes) => saveProgress('wrong_notes', notes);
  const now = Date.parse('2026-09-10T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('mastered 노트는 복습 대상에서 빠진다', () => {
    seed([{ ...base, id: '1', mastered: true, reviewCount: 0, addedAt: now - 30 * DAY }]);
    expect(getSpacedRepetitionDue()).toEqual([]);
  });

  it('reviewCount 0 은 1일, 1은 3일, 2 이상은 7일이 지나야 대상이 된다', () => {
    seed([
      { ...base, id: 'r0-지남', reviewCount: 0, addedAt: now - 2 * DAY },
      { ...base, id: 'r0-아직', reviewCount: 0, addedAt: now - 0.5 * DAY },
      { ...base, id: 'r1-지남', reviewCount: 1, lastReviewed: now - 4 * DAY, addedAt: now - 9 * DAY },
      { ...base, id: 'r1-아직', reviewCount: 1, lastReviewed: now - 2 * DAY, addedAt: now - 9 * DAY },
      { ...base, id: 'r2-지남', reviewCount: 2, lastReviewed: now - 8 * DAY, addedAt: now - 9 * DAY },
      { ...base, id: 'r2-아직', reviewCount: 2, lastReviewed: now - 6 * DAY, addedAt: now - 9 * DAY },
      { ...base, id: 'r9-지남', reviewCount: 9, lastReviewed: now - 8 * DAY, addedAt: now - 9 * DAY },
    ]);
    expect(getSpacedRepetitionDue().map((n) => n.id)).toEqual([
      'r0-지남',
      'r1-지남',
      'r2-지남',
      'r9-지남',
    ]);
  });

  it('lastReviewed 가 없으면 addedAt 을 기준 시각으로 쓴다', () => {
    seed([{ ...base, id: '1', reviewCount: 1, addedAt: now - 5 * DAY }]);
    expect(getSpacedRepetitionDue().map((n) => n.id)).toEqual(['1']);
  });

  it('기준 시각이 아예 없으면 즉시 복습 대상이다', () => {
    seed([{ ...base, id: '1', reviewCount: 0 }]);
    expect(getSpacedRepetitionDue().map((n) => n.id)).toEqual(['1']);
  });
});

describe('D-Day', () => {
  it('시험일 문자열을 저장하고 읽는다', () => {
    setExamDate('2026-10-18');
    expect(getExamDate()).toBe('2026-10-18');
  });

  it('설정 전에는 null 이다', () => {
    expect(getExamDate()).toBeNull();
  });
});

describe('학습 시간', () => {
  // 시간대는 vite.config.js 에서 Asia/Seoul 로 고정된다(테스트 실행 시에만).
  // 아래 기대값들은 UTC 와 로컬 날짜가 갈리는 시각을 골라 UTC 회귀를 잡는다.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z')); // 2026-09-02 21:00 KST
  });

  it('테스트 시간대가 UTC 로 풀리면 아래 기대값이 무의미해지므로 먼저 확인한다', () => {
    expect(new Date().getTimezoneOffset()).toBe(-540);
  });

  it('로그가 없으면 빈 객체다', () => {
    expect(getStudyTimeLog()).toEqual({});
  });

  it('같은 날 호출은 분을 누적한다', () => {
    addStudyTime(10);
    addStudyTime(5);
    expect(getStudyTimeLog()['2026-09-02']).toBe(15);
  });

  it('날짜 키는 로컬 기준 `YYYY-MM-DD` 다', () => {
    addStudyTime(3);
    expect(Object.keys(getStudyTimeLog())).toEqual(['2026-09-02']);
  });

  it('로컬 자정 직후의 학습은 전날이 아니라 오늘 키에 쌓인다', () => {
    // 2026-09-02 08:00 KST = 2026-09-01 23:00 UTC.
    // UTC 기준이면 `2026-09-01` 로 기록돼 하루 밀린다.
    vi.setSystemTime(new Date('2026-09-01T23:00:00Z'));
    addStudyTime(30);
    expect(Object.keys(getStudyTimeLog())).toEqual(['2026-09-02']);
  });

  it('주간 통계의 날짜 키와 요일 라벨이 자정 근처에서도 어긋나지 않는다', () => {
    vi.setSystemTime(new Date('2026-09-01T23:00:00Z')); // 2026-09-02(수) 08:00 KST
    addStudyTime(20);
    const week = getWeeklyStudyTime();
    expect(week.at(-1)).toEqual({ date: '2026-09-02', day: '수', minutes: 20 });
    expect(week[0]).toEqual({ date: '2026-08-27', day: '목', minutes: 0 });
  });

  it('주간 통계는 오늘을 마지막으로 하는 7일치를 돌려준다', () => {
    addStudyTime(20);
    const week = getWeeklyStudyTime();
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.date)).toEqual([
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(week.at(-1).minutes).toBe(20);
    expect(week.slice(0, 6).every((d) => d.minutes === 0)).toBe(true);
  });

  it('주간 통계의 요일 라벨은 한글 한 글자다', () => {
    const week = getWeeklyStudyTime();
    expect(week.every((d) => '일월화수목금토'.includes(d.day))).toBe(true);
    expect(new Set(week.map((d) => d.day)).size).toBe(7);
  });
});

describe('localStorage 용량', () => {
  it('`jungchogi_` 접두사 키만 UTF-16 바이트로 합산한다', () => {
    localStorage.setItem('other_app', 'xxxxxxxxxx');
    saveProgress('u', 'ab'); // key 'jungchogi_u'(11) + value '"ab"'(4) = 15자 → 30바이트
    expect(getStorageUsage()).toBe(30);
  });

  it('저장된 것이 없으면 0 이다', () => {
    expect(getStorageUsage()).toBe(0);
  });

  it('formatBytes 는 1024 경계에서 단위를 바꾼다', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('flashcard_known 키 마이그레이션 (모듈 로드 시 1회)', () => {
  const OLD = `${PREFIX}flashcard_known`;
  const NEW = `${PREFIX}flashcard_known_quiz100`;

  const reimport = async () => {
    vi.resetModules();
    return import('../src/utils/storage.js');
  };

  it('구 키만 있으면 신 키로 복사한다 (구 키는 남긴다)', async () => {
    localStorage.setItem(OLD, '{"001":true}');
    await reimport();
    expect(localStorage.getItem(NEW)).toBe('{"001":true}');
    expect(localStorage.getItem(OLD)).toBe('{"001":true}');
  });

  it('신 키가 이미 있으면 덮어쓰지 않는다', async () => {
    localStorage.setItem(OLD, '{"001":true}');
    localStorage.setItem(NEW, '{"002":true}');
    await reimport();
    expect(localStorage.getItem(NEW)).toBe('{"002":true}');
  });

  it('구 키가 없으면 아무것도 만들지 않는다', async () => {
    await reimport();
    expect(localStorage.getItem(NEW)).toBeNull();
  });
});

// ─── 학습 플랜 (Phase 2) ───

describe('toLocalDateKey', () => {
  it('로컬 기준 YYYY-MM-DD 를 만든다 (UTC 가 아니다)', () => {
    // Asia/Seoul(UTC+9) 기준 2026-09-03 01:00 = UTC 2026-09-02 16:00
    const d = new Date(2026, 8, 3, 1, 0, 0);
    expect(toLocalDateKey(d)).toBe('2026-09-03');
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('인자가 없으면 오늘 날짜를 쓴다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12, 0, 0));
    expect(toLocalDateKey()).toBe('2026-09-03');
  });
});

describe('saveStudyPlan / getStudyPlan', () => {
  const plan = (date) => ({
    date,
    items: [{ type: 'review_wrong', source: 'quiz100', ids: ['042'], minutes: 20, why: '틀림' }],
    rationale: '오답부터',
    riskFlags: [],
  });

  it('`study_plan_<date>` 키로 저장하고 그대로 다시 읽는다', () => {
    expect(saveStudyPlan(plan('2026-09-03'))).toBe(true);
    expect(localStorage.getItem(`${PREFIX}study_plan_2026-09-03`)).not.toBeNull();
    expect(getStudyPlan('2026-09-03')).toEqual(plan('2026-09-03'));
  });

  it('저장된 계획이 없는 날짜는 null 이다', () => {
    expect(getStudyPlan('2026-09-03')).toBeNull();
  });

  it('같은 날짜로 다시 저장하면 덮어쓴다 (재생성)', () => {
    saveStudyPlan(plan('2026-09-03'));
    const regenerated = { ...plan('2026-09-03'), rationale: '다시 세운 계획' };
    saveStudyPlan(regenerated);
    expect(getStudyPlan('2026-09-03').rationale).toBe('다시 세운 계획');
    expect(listStudyPlanDates()).toEqual(['2026-09-03']);
  });

  it('date 가 없는 계획은 저장하지 않는다', () => {
    expect(saveStudyPlan({ items: [] })).toBe(false);
    expect(saveStudyPlan(null)).toBe(false);
    expect(listStudyPlanDates()).toEqual([]);
  });

  it('용량이 꽉 차면 false 를 돌려주고 예외를 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(saveStudyPlan(plan('2026-09-03'))).toBe(false);
  });
});

describe('listStudyPlanDates / pruneStudyPlans', () => {
  const save = (date) => saveStudyPlan({ date, items: [], rationale: '', riskFlags: [] });

  it('저장된 날짜를 최신순으로 돌려준다', () => {
    save('2026-09-01');
    save('2026-09-03');
    save('2026-09-02');
    expect(listStudyPlanDates()).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });

  it('플랜이 아닌 jungchogi_ 키는 세지 않는다', () => {
    saveProgress('day_checks', { 1: true });
    save('2026-09-03');
    expect(listStudyPlanDates()).toEqual(['2026-09-03']);
  });

  it('저장할 때마다 오래된 계획을 MAX_STORED_PLANS 개까지만 남긴다', () => {
    for (let d = 1; d <= 10; d++) save(`2026-09-${String(d).padStart(2, '0')}`);
    const dates = listStudyPlanDates();
    expect(dates).toHaveLength(MAX_STORED_PLANS);
    expect(dates[0]).toBe('2026-09-10');
    expect(dates.at(-1)).toBe(`2026-09-0${10 - MAX_STORED_PLANS + 1}`);
  });

  it('pruneStudyPlans 는 지운 날짜를 돌려준다', () => {
    save('2026-09-01');
    save('2026-09-02');
    save('2026-09-03');
    expect(pruneStudyPlans(1)).toEqual(['2026-09-02', '2026-09-01']);
    expect(listStudyPlanDates()).toEqual(['2026-09-03']);
  });

  it('전체 초기화가 플랜 키도 함께 지우도록 jungchogi_ 접두사를 쓴다', () => {
    save('2026-09-03');
    const keys = Object.keys(localStorage).filter((k) => k.includes('study_plan'));
    expect(keys.every((k) => k.startsWith(PREFIX))).toBe(true);
  });
});

// ─── AI 변형 문제 (Phase 4) ───

describe('변형 포함 설정', () => {
  it('기본값은 꺼짐이다', () => {
    // 교재가 아닌 AI 생성 문항은 옵트인으로 들어온다 —
    // 기존 사용자의 덱 크기·진도 분모가 아무 조작 없이 바뀌면 안 된다
    expect(getIncludeVariants()).toBe(false);
  });

  it('켜면 저장되고 다시 읽힌다', () => {
    setIncludeVariants(true);
    expect(getIncludeVariants()).toBe(true);
    expect(localStorage.getItem(PREFIX + 'include_variants')).toBe('true');
  });

  it('껐다 켜기를 되풀이해도 마지막 값이 남는다', () => {
    setIncludeVariants(true);
    setIncludeVariants(false);
    expect(getIncludeVariants()).toBe(false);
  });

  it('저장값이 손상돼 있으면 꺼짐으로 본다', () => {
    localStorage.setItem(PREFIX + 'include_variants', '{그렇다');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getIncludeVariants()).toBe(false);
  });

  it('불리언이 아닌 값이 들어 있어도 꺼짐으로 본다', () => {
    localStorage.setItem(PREFIX + 'include_variants', '"true"');
    expect(getIncludeVariants()).toBe(false);
  });
});

describe('변형 진도 키', () => {
  it('교재 진도 키와 이름이 겹치지 않는다', () => {
    // quiz_results·flashcard_known_* 는 "문항 수가 고정된" 분모(40·100·24)에
    // 걸려 있다. 변형 진도가 같은 맵에 들어가면 진도가 100% 를 넘는다.
    expect(VARIANT_RESULTS_KEY).not.toBe('quiz_results');
    expect(variantKnownKey('quiz100')).not.toBe('flashcard_known_quiz100');
    expect(variantKnownKey('bogang119')).not.toBe('flashcard_known_bogang119');
  });

  it('덱마다 다른 키를 쓴다', () => {
    expect(variantKnownKey('quiz100')).not.toBe(variantKnownKey('bogang119'));
  });

  it('전체 초기화가 함께 지우도록 jungchogi_ 접두사 아래 쌓인다', () => {
    saveProgress(VARIANT_RESULTS_KEY, { 'C-01-v1': 'correct' });
    saveProgress(variantKnownKey('quiz100'), { '001-v1': true });
    const keys = Object.keys(localStorage).filter((k) => k.includes('variant'));
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.startsWith(PREFIX))).toBe(true);
  });
});

// ─── 모의고사 채점 결과 (Phase 3 잔여) ───

describe('모의고사 채점 결과', () => {
  it('교재 진도 키와 이름이 겹치지 않는다', () => {
    // `quiz_results` 는 분모가 40 으로 고정된 코드 퀴즈 진도(`quizDone/40`)를 센다.
    // 모의고사가 낸 단답형 id(`042`)가 섞이면 진도가 40 을 넘는다 — 변형 진도를
    // 가른 것과 같은 이유로 키를 가른다.
    expect(EXAM_RESULTS_KEY).not.toBe('quiz_results');
    expect(EXAM_RESULTS_KEY).not.toBe(VARIANT_RESULTS_KEY);
  });

  it('저장한 결과를 그대로 다시 읽는다', () => {
    expect(saveExamResults({ '042': 'correct', 'C-01': 'incorrect' })).toBe(true);
    expect(getExamResults()).toEqual({ '042': 'correct', 'C-01': 'incorrect' });
    expect(localStorage.getItem(`${PREFIX}exam_results`)).toBe(
      '{"042":"correct","C-01":"incorrect"}'
    );
  });

  it('기록이 없으면 빈 맵이다', () => {
    expect(getExamResults()).toEqual({});
  });

  it('`quiz_results` 와 같은 세 값을 그대로 담는다', () => {
    // 값 계약은 코드 퀴즈와 같다 — 읽는 쪽(약점 분석)이 한 규칙으로 두 맵을 센다
    saveExamResults({ '042': 'correct', '077': 'incorrect', 'C-01': 'answered' });
    expect(getExamResults()).toEqual({
      '042': 'correct',
      '077': 'incorrect',
      'C-01': 'answered',
    });
  });

  it('저장해도 코드 퀴즈 진도는 건드리지 않는다', () => {
    saveProgress('quiz_results', { 'C-01': 'correct' });
    saveExamResults({ '042': 'incorrect' });
    expect(loadProgress('quiz_results', {})).toEqual({ 'C-01': 'correct' });
  });

  it('손상된 JSON 은 예외 대신 빈 맵이다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(`${PREFIX}exam_results`, '{"042":');
    expect(getExamResults()).toEqual({});
  });

  it('맵이 아닌 값이 들어 있어도 빈 맵으로 본다', () => {
    // 읽는 쪽이 전부 `{id: 상태}` 맵을 전제한다 — 오답노트·학습시간과 같은 이유로
    // 여기 한 곳에서 형태를 보장한다
    for (const stored of ['null', '[]', '"correct"', '3']) {
      localStorage.setItem(`${PREFIX}exam_results`, stored);
      expect(getExamResults()).toEqual({});
    }
  });

  it('용량이 꽉 차면 던지지 않고 false 를 돌려준다', () => {
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota; });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(saveExamResults({ '042': 'correct' })).toBe(false);
  });

  it('전체 초기화가 함께 지우도록 jungchogi_ 접두사 아래 쌓인다', () => {
    saveExamResults({ '042': 'correct' });
    const keys = Object.keys(localStorage).filter((k) => k.includes('exam_results'));
    expect(keys).toEqual([`${PREFIX}exam_results`]);
  });
});
