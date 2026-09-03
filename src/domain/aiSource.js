// 문항 출처 이름 맞추기.
//
// 화면과 오답노트는 "어느 화면에서 틀렸나"(quiz=코드 퀴즈, exam=모의고사)를 source 로 쓰지만,
// 서버 API 는 "어느 교재 파일에서 나온 문항인가"(quiz100/codedrill/bogang)를 받는다.
// 두 이름 체계를 여기 한 곳에서만 잇는다.

/** @typedef {'quiz100'|'codedrill'|'bogang'} AiSource */

/**
 * 채점 API(§4.2)가 받는 문항 종류.
 * @typedef {'code'|'short'} GradeKind
 */

/** API 명세(§4.1)의 source 문자열 */
export const AI_SOURCE = {
  QUIZ100: 'quiz100',
  CODEDRILL: 'codedrill',
  BOGANG: 'bogang',
};

/**
 * @param {{source?: string, type?: string}|null|undefined} item 오답노트 항목 또는 화면의 현재 문항
 * @returns {AiSource|null} 대응하는 출처가 없으면 null — 호출부는 AI 해설을 띄우지 않는다
 */
export function toAiSource(item) {
  switch (item?.source) {
    case 'quiz':
      // 코드 퀴즈 화면은 코드트레이싱 드릴만 낸다
      return AI_SOURCE.CODEDRILL;
    case 'bogang':
      return AI_SOURCE.BOGANG;
    case 'exam':
      // 모의고사는 두 교재에서 섞어 낸다 — 문항 종류로 갈린다
      return item.type === 'code' ? AI_SOURCE.CODEDRILL : AI_SOURCE.QUIZ100;
    default:
      return null;
  }
}

/**
 * 문항 데이터에서 채점 API 의 `kind` 를 유도한다 (§4.2).
 *
 * 화면이 아니라 문항이 종류를 정한다 — 모의고사는 단답형과 코드 트레이싱을
 * 섞어 내므로 화면 이름만으로는 갈리지 않는다. 코드 퀴즈처럼 `type` 이 없는
 * 화면은 교재 출처로 판단한다(코드트레이싱 드릴 = 코드).
 *
 * @param {{source?: string, type?: string}|null|undefined} item
 * @returns {GradeKind|null} 교재 출처를 못 찾으면 null — 호출부는 AI 채점을 걸지 않는다
 */
export function toGradeKind(item) {
  const source = toAiSource(item);
  if (!source) return null;
  if (item.type === 'code') return 'code';
  if (item.type === 'quiz') return 'short';
  return source === AI_SOURCE.CODEDRILL ? 'code' : 'short';
}
