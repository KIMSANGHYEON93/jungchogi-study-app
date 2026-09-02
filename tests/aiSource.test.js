import { describe, it, expect } from 'vitest';
import { AI_SOURCE, toAiSource } from '../src/domain/aiSource.js';

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
