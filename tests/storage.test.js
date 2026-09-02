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

  it('손상된 JSON 은 fallback 으로 흡수되지 않고 예외를 던진다', () => {
    // 현행 동작 기록: loadProgress 에 try/catch 가 없다.
    localStorage.setItem(`${PREFIX}broken`, '{"a":');
    expect(() => loadProgress('broken', {})).toThrow(SyntaxError);
  });

  it('clearProgress 는 해당 키만 지운다', () => {
    saveProgress('a', 1);
    saveProgress('b', 2);
    clearProgress('a');
    expect(loadProgress('a')).toBeNull();
    expect(loadProgress('b')).toBe(2);
  });

  it('용량이 넘치면 setItem 예외가 그대로 호출자에게 전파된다', () => {
    // 현행 동작 기록: saveProgress 에 QuotaExceededError 처리가 없다.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveProgress('big', 'x')).toThrow(/quota/);
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  it('로그가 없으면 빈 객체다', () => {
    expect(getStudyTimeLog()).toEqual({});
  });

  it('같은 날 호출은 분을 누적한다', () => {
    addStudyTime(10);
    addStudyTime(5);
    expect(getStudyTimeLog()['2026-09-02']).toBe(15);
  });

  it('날짜 키는 UTC 기준 `YYYY-MM-DD` 다', () => {
    addStudyTime(3);
    expect(Object.keys(getStudyTimeLog())).toEqual(['2026-09-02']);
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
