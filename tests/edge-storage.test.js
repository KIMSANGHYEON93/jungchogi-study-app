// @vitest-environment jsdom
//
// 저장소 경우의 수 하드닝 — `src/utils/storage.js`.
//
// `tests/storage.test.js` 는 정상 경로와 P6·P7(손상 JSON · 용량 초과)을 다룬다.
// 여기서는 그 밖의 "실제로 일어나는 나쁜 상태"를 훑는다:
//   · 키는 있는데 값이 `null` — `JSON.parse('null')` 은 예외가 아니라 null 이라
//     `loadProgress` 의 fallback 을 타지 않고 그대로 흘러나온다.
//   · 타입이 다른 값 — 내보내기 파일을 손으로 고쳤거나 구버전 형식이 남은 경우.
//   · localStorage 접근 자체가 던지는 환경 — 쿠키·사이트 데이터 차단, 일부 사생활 보호 모드.
//   · 숫자가 아닌 학습 시간 — 타이머 보정이 어긋나면 NaN 이 들어온다.
//
// 판정 기준: **학습 기록 화면이 죽지 않고, 이미 쌓인 값을 잃지 않는다.**

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWrongNotes,
  addWrongNote,
  removeWrongNote,
  markWrongNoteReviewed,
  getSpacedRepetitionDue,
  getStudyTimeLog,
  addStudyTime,
  getWeeklyStudyTime,
  toLocalDateKey,
} from '../src/utils/storage.js';

const PREFIX = 'jungchogi_';
const NOTES_KEY = `${PREFIX}wrong_notes`;
const STUDY_KEY = `${PREFIX}study_time`;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 오답노트 — 배열이 아닌 값이 들어 있어도 화면이 죽지 않는다
// ─────────────────────────────────────────────────────────────────────────────

describe('오답노트: 배열이 아닌 저장값', () => {
  // 각각 실제로 나올 수 있는 경로다:
  //   'null'  → saveProgress('wrong_notes', null) 이 남긴 값
  //   '{}'    → 구버전 형식(맵) 잔재, 내보내기 파일 수기 편집
  //   '"x"'   → 다른 키의 값을 잘못 붙여 넣음
  //   '0'     → 부분 덮어쓰기
  const broken = [
    ['null', 'null'],
    ['객체', '{}'],
    ['문자열', '"복구불가"'],
    ['숫자', '0'],
  ];

  it.each(broken)('%s 이 들어 있어도 getWrongNotes 는 빈 배열을 돌려준다', (_label, raw) => {
    localStorage.setItem(NOTES_KEY, raw);
    expect(getWrongNotes()).toEqual([]);
  });

  it.each(broken)('%s 이 들어 있어도 addWrongNote 가 던지지 않고 새 노트를 남긴다', (_label, raw) => {
    localStorage.setItem(NOTES_KEY, raw);
    expect(() => addWrongNote({ source: 'quiz', id: 'C-01' })).not.toThrow();

    const notes = getWrongNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ source: 'quiz', id: 'C-01', reviewCount: 0, mastered: false });
  });

  it.each(broken)('%s 이 들어 있어도 복습·삭제·간격반복이 던지지 않는다', (_label, raw) => {
    localStorage.setItem(NOTES_KEY, raw);
    expect(() => markWrongNoteReviewed('quiz', 'C-01')).not.toThrow();
    expect(() => removeWrongNote('quiz', 'C-01')).not.toThrow();
    expect(getSpacedRepetitionDue()).toEqual([]);
  });

  it('배열 안에 노트가 아닌 값이 섞여 있어도 간격 반복이 죽지 않는다', () => {
    localStorage.setItem(NOTES_KEY, JSON.stringify([null, 'x', 42, { source: 'quiz', id: 'C-01' }]));
    const due = getSpacedRepetitionDue();
    // 기준 시각이 없는 정상 노트 하나만 대기로 잡힌다
    expect(due).toEqual([{ source: 'quiz', id: 'C-01' }]);
  });

  it('기존 노트의 reviewCount 가 없어도 복습이 NaN 을 남기지 않는다', () => {
    // 구버전 데이터에는 reviewCount 가 없다
    localStorage.setItem(NOTES_KEY, JSON.stringify([{ source: 'quiz', id: 'C-01' }]));
    markWrongNoteReviewed('quiz', 'C-01');
    expect(getWrongNotes()[0].reviewCount).toBe(1);
  });

  it('reviewCount 가 손상된 노트를 갱신해도 숫자가 남는다', () => {
    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify([{ source: 'quiz', id: 'C-01', reviewCount: '망가짐' }])
    );
    addWrongNote({ source: 'quiz', id: 'C-01', question: '다시 틀림' });
    expect(getWrongNotes()[0].reviewCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 학습 시간 — 맵이 아닌 값, 숫자가 아닌 분
// ─────────────────────────────────────────────────────────────────────────────

describe('학습 시간: 맵이 아닌 저장값', () => {
  const broken = [
    ['null', 'null'],
    ['배열', '[]'],
    ['문자열', '"90"'],
    ['숫자', '90'],
  ];

  it.each(broken)('%s 이 들어 있어도 getStudyTimeLog 는 빈 객체를 돌려준다', (_label, raw) => {
    localStorage.setItem(STUDY_KEY, raw);
    expect(getStudyTimeLog()).toEqual({});
  });

  it.each(broken)('%s 이 들어 있어도 addStudyTime 이 던지지 않고 오늘 칸에 쌓인다', (_label, raw) => {
    localStorage.setItem(STUDY_KEY, raw);
    expect(() => addStudyTime(25)).not.toThrow();
    expect(getStudyTimeLog()[toLocalDateKey()]).toBe(25);
  });

  it.each(broken)('%s 이 들어 있어도 주간 통계가 7일치를 돌려준다', (_label, raw) => {
    localStorage.setItem(STUDY_KEY, raw);
    const week = getWeeklyStudyTime();
    expect(week).toHaveLength(7);
    expect(week.every((day) => day.minutes === 0)).toBe(true);
  });
});

describe('학습 시간: 숫자가 아닌 분', () => {
  const today = () => toLocalDateKey();

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['문자열', '30분'],
    ['undefined', undefined],
    ['null', null],
  ])('%s 을 더해도 이미 쌓인 분을 잃지 않는다', (_label, value) => {
    addStudyTime(40);
    addStudyTime(value);
    expect(getStudyTimeLog()[today()]).toBe(40);
  });

  it('음수는 이미 쌓인 시간을 깎지 않는다', () => {
    addStudyTime(40);
    addStudyTime(-100);
    expect(getStudyTimeLog()[today()]).toBe(40);
  });

  it('숫자 문자열은 분으로 받아들인다 (기존 호출부 호환)', () => {
    addStudyTime('15');
    expect(getStudyTimeLog()[today()]).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorage 접근 자체가 던지는 환경
// ─────────────────────────────────────────────────────────────────────────────

describe('localStorage 를 쓸 수 없는 환경', () => {
  /** 쿠키·사이트 데이터가 차단되면 접근만으로 SecurityError 가 난다 */
  const throwing = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    removeItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    key() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    get length() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  };

  it('모듈을 불러오는 것만으로 앱이 죽지 않는다', async () => {
    // 모듈 최상단의 flashcard_known 마이그레이션이 여기서 던지면
    // 번들 import 시점에 터져 화면이 통째로 하얘진다.
    vi.stubGlobal('localStorage', throwing);
    vi.resetModules();
    await expect(import('../src/utils/storage.js')).resolves.toBeDefined();
    vi.unstubAllGlobals();
  });
});
