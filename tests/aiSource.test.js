import { describe, it, expect } from 'vitest';
import { AI_SOURCE, toAiSource, toGradeKind } from '../src/domain/aiSource.js';

describe('toAiSource — 화면/오답노트 문항을 서버 API 의 source 로 옮긴다', () => {
  it('코드 퀴즈(source=quiz)는 코드트레이싱 드릴이다', () => {
    expect(toAiSource({ source: 'quiz', type: 'code' })).toBe(AI_SOURCE.CODEDRILL);
  });

  it('모의고사의 코드 문항은 코드트레이싱 드릴에서 뽑은 것이다', () => {
    expect(toAiSource({ source: 'exam', type: 'code' })).toBe(AI_SOURCE.CODEDRILL);
  });

  it('모의고사의 단답형 문항은 단답형 100선에서 뽑은 것이다', () => {
    expect(toAiSource({ source: 'exam', type: 'quiz' })).toBe(AI_SOURCE.QUIZ100);
  });

  it('보강 덱은 bogang 이다', () => {
    expect(toAiSource({ source: 'bogang' })).toBe(AI_SOURCE.BOGANG);
  });

  it('모르는 조합은 null 을 돌려준다 — 호출부는 AI 버튼을 숨긴다', () => {
    expect(toAiSource({ source: 'unknown' })).toBeNull();
    expect(toAiSource({})).toBeNull();
    expect(toAiSource(null)).toBeNull();
    expect(toAiSource(undefined)).toBeNull();
  });

  it('type 이 빠진 모의고사 문항은 단답형으로 본다', () => {
    expect(toAiSource({ source: 'exam' })).toBe(AI_SOURCE.QUIZ100);
  });

  it('AI_SOURCE 값은 API 명세 문자열 그대로다', () => {
    expect(AI_SOURCE).toEqual({ QUIZ100: 'quiz100', CODEDRILL: 'codedrill', BOGANG: 'bogang' });
  });
});

// 서버(`lib/ai/guard.js`)의 ID_PATTERN 은 교재 id 형식만 통과시킨다
// (quiz100 `\d{3}` · codedrill `[CJPS]-\d{2}` · bogang `B\d{2,3}`).
// 변형 id 는 어느 것과도 맞지 않아 /api/ai/tutor · /api/ai/grade 가 400 을 낸다.
// 그러니 호출 자체를 막는다 — 눌러 봐야 오류 문구만 나오는 버튼을 띄우지 않는다.
describe('AI 변형 문항은 서버 API 로 보내지 않는다', () => {
  it('generated 표시가 있으면 source 를 주지 않는다', () => {
    expect(toAiSource({ source: 'quiz', type: 'code', generated: true })).toBeNull();
    expect(toAiSource({ source: 'exam', type: 'quiz', generated: true })).toBeNull();
    expect(toAiSource({ source: 'bogang', generated: true })).toBeNull();
  });

  it('generated 표시가 없어도 변형 id 모양이면 막는다', () => {
    // Phase 4 이전에 저장된 오답노트 항목에는 generated 필드가 없다
    expect(toAiSource({ source: 'quiz', type: 'code', id: 'C-01-v1' })).toBeNull();
  });

  it('교재 문항은 그대로 통과시킨다', () => {
    expect(toAiSource({ source: 'quiz', type: 'code', id: 'C-01' })).toBe(AI_SOURCE.CODEDRILL);
  });

  it('채점 종류도 함께 막는다', () => {
    expect(toGradeKind({ source: 'quiz', type: 'code', generated: true })).toBeNull();
    expect(toGradeKind({ source: 'quiz', type: 'code' })).toBe('code');
  });
});
