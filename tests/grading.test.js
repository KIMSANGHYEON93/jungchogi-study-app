// 자동 채점(Phase 3)의 도메인 규칙.
//
// 여기서 고정하는 것은 두 가지다.
//   1) confidence 경계 — 블루프린트 §4.2 의 `confidence < 0.6` 폴백
//   2) quiz_results 세 값('correct'|'incorrect'|'answered') 읽기 규칙
// 둘 다 화면 여러 곳이 같은 판정을 해야 하므로 한 곳에 모아 테스트로 못 박는다.
import { describe, it, expect } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  QUIZ_RESULT,
  isConfidentGrade,
  normalizeGradeResult,
  summarizeQuizResults,
  verdictToQuizResult,
  withQuizResult,
} from '../src/domain/grading.js';
import { toGradeKind } from '../src/domain/aiSource.js';

const RESULT = {
  verdict: 'correct',
  score: 100,
  feedback: '정확합니다.',
  missedPoints: [],
  confidence: 0.9,
};

describe('confidence 폴백 경계', () => {
  it('경계값은 블루프린트 §4.2 의 0.6 하나뿐이다', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it.each([
    [0.59, false],
    [0.6, true],
    [0.61, true],
  ])('confidence %s → 확정 여부 %s', (confidence, expected) => {
    expect(isConfidentGrade({ ...RESULT, confidence })).toBe(expected);
  });

  it('결과가 없으면 확정이 아니다 — 자기 채점으로 넘어간다', () => {
    expect(isConfidentGrade(null)).toBe(false);
    expect(isConfidentGrade(undefined)).toBe(false);
  });
});

describe('normalizeGradeResult', () => {
  it('명세대로 온 응답을 그대로 통과시킨다', () => {
    expect(normalizeGradeResult(RESULT)).toEqual(RESULT);
  });

  it('verdict 가 명세의 세 값이 아니면 결과로 보지 않는다', () => {
    expect(normalizeGradeResult({ ...RESULT, verdict: 'maybe' })).toBeNull();
    expect(normalizeGradeResult({ ...RESULT, verdict: undefined })).toBeNull();
    expect(normalizeGradeResult('correct')).toBeNull();
    expect(normalizeGradeResult(null)).toBeNull();
  });

  it('confidence 를 읽을 수 없으면 0 으로 본다 — 안전한 쪽(자기 채점)으로 떨어진다', () => {
    expect(normalizeGradeResult({ ...RESULT, confidence: undefined }).confidence).toBe(0);
    expect(normalizeGradeResult({ ...RESULT, confidence: 'high' }).confidence).toBe(0);
    expect(isConfidentGrade(normalizeGradeResult({ ...RESULT, confidence: NaN }))).toBe(false);
  });

  it('score·confidence 를 명세 범위로 좁힌다', () => {
    expect(normalizeGradeResult({ ...RESULT, score: 140 }).score).toBe(100);
    expect(normalizeGradeResult({ ...RESULT, score: -20 }).score).toBe(0);
    expect(normalizeGradeResult({ ...RESULT, confidence: 3 }).confidence).toBe(1);
    expect(normalizeGradeResult({ ...RESULT, confidence: -1 }).confidence).toBe(0);
  });

  it('score 가 없으면 verdict 에서 기본값을 세운다', () => {
    expect(normalizeGradeResult({ verdict: 'correct', confidence: 0.9 }).score).toBe(100);
    expect(normalizeGradeResult({ verdict: 'partial', confidence: 0.9 }).score).toBe(50);
    expect(normalizeGradeResult({ verdict: 'incorrect', confidence: 0.9 }).score).toBe(0);
  });

  it('feedback·missedPoints 가 빠지거나 형식이 어긋나도 화면이 그릴 수 있는 모양으로 맞춘다', () => {
    const r = normalizeGradeResult({ verdict: 'partial', confidence: 0.8, missedPoints: 'NULL 처리' });
    expect(r.feedback).toBe('');
    expect(r.missedPoints).toEqual(['NULL 처리']);
    expect(normalizeGradeResult({ verdict: 'partial', confidence: 0.8 }).missedPoints).toEqual([]);
    expect(normalizeGradeResult({ ...RESULT, missedPoints: [1, null] }).missedPoints).toEqual(['1']);
  });
});

describe('verdict → 저장값', () => {
  it('correct 만 정답으로 저장한다', () => {
    expect(verdictToQuizResult('correct')).toBe(QUIZ_RESULT.CORRECT);
  });

  it('partial 은 오답으로 저장한다 — 못 짚은 부분이 남아 있으므로 정답으로 세지 않는다', () => {
    expect(verdictToQuizResult('partial')).toBe(QUIZ_RESULT.INCORRECT);
    expect(verdictToQuizResult('incorrect')).toBe(QUIZ_RESULT.INCORRECT);
  });

  it('알 수 없는 verdict 는 저장값을 만들지 않는다', () => {
    expect(verdictToQuizResult('maybe')).toBeNull();
  });
});

describe('withQuizResult', () => {
  it('원본을 건드리지 않고 새 맵을 만든다', () => {
    const before = { 'C-01': 'answered' };
    const after = withQuizResult(before, 'C-02', 'correct');

    expect(after).toEqual({ 'C-01': 'answered', 'C-02': 'correct' });
    expect(before).toEqual({ 'C-01': 'answered' });
  });

  it('레거시 값을 채점 결과로 덮어쓴다', () => {
    expect(withQuizResult({ 'C-01': 'answered' }, 'C-01', 'incorrect')).toEqual({
      'C-01': 'incorrect',
    });
  });

  it('계약에 없는 값은 저장하지 않는다', () => {
    const before = { 'C-01': 'answered' };
    expect(withQuizResult(before, 'C-01', 'maybe')).toEqual(before);
    expect(withQuizResult(before, 'C-01', null)).toEqual(before);
  });
});

describe('summarizeQuizResults — 레거시 answered 를 정답으로도 오답으로도 세지 않는다', () => {
  it('세 값을 각자의 칸으로 나눈다', () => {
    const s = summarizeQuizResults({
      'C-01': 'correct',
      'C-02': 'incorrect',
      'C-03': 'answered',
      'C-04': 'correct',
    });

    expect(s.attempted).toBe(4);
    expect(s.correct).toBe(2);
    expect(s.incorrect).toBe(1);
    expect(s.graded).toBe(3);
    expect(s.ungraded).toBe(1);
  });

  it('레거시만 있으면 정답률을 말하지 않는다 — 정오 정보가 없기 때문', () => {
    const s = summarizeQuizResults({ 'C-01': 'answered', 'C-02': 'answered' });

    expect(s.attempted).toBe(2);
    expect(s.correct).toBe(0);
    expect(s.incorrect).toBe(0);
    expect(s.accuracy).toBeNull();
  });

  it('정답률은 채점된 문항만으로 계산한다', () => {
    const s = summarizeQuizResults({ 'C-01': 'correct', 'C-02': 'incorrect', 'C-03': 'answered' });
    expect(s.accuracy).toBe(50);
  });

  it('문자열이 아닌 손상된 값은 시도로도 세지 않는다 (스냅샷 규칙과 같다)', () => {
    const s = summarizeQuizResults({ 'C-01': 'correct', 'C-02': 3, 'C-03': null });
    expect(s.attempted).toBe(1);
  });

  it('알 수 없는 문자열은 시도로만 세고 정오에는 넣지 않는다', () => {
    const s = summarizeQuizResults({ 'C-01': 'skipped' });
    expect(s.attempted).toBe(1);
    expect(s.graded).toBe(0);
    expect(s.ungraded).toBe(1);
  });

  it('값이 없거나 깨져 있어도 0 으로 답한다', () => {
    expect(summarizeQuizResults(null).attempted).toBe(0);
    expect(summarizeQuizResults(undefined).accuracy).toBeNull();
  });
});

describe('toGradeKind — 문항 데이터에서 kind 를 유도한다', () => {
  it('코드 퀴즈 화면의 문항은 code 다', () => {
    expect(toGradeKind({ source: 'quiz' })).toBe('code');
  });

  it('모의고사는 문항 종류로 갈린다', () => {
    expect(toGradeKind({ source: 'exam', type: 'code' })).toBe('code');
    expect(toGradeKind({ source: 'exam', type: 'quiz' })).toBe('short');
  });

  it('보강 카드는 단답형이다', () => {
    expect(toGradeKind({ source: 'bogang' })).toBe('short');
  });

  it('교재 출처를 못 찾으면 kind 도 없다 — 채점을 걸지 않는다', () => {
    expect(toGradeKind({ source: 'unknown' })).toBeNull();
    expect(toGradeKind(null)).toBeNull();
  });
});
