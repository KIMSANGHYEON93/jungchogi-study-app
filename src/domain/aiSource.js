// 문항 출처 이름 맞추기.
//
// 화면과 오답노트는 "어느 화면에서 틀렸나"(quiz=코드 퀴즈, exam=모의고사)를 source 로 쓰지만,
// 서버 API 는 "어느 교재 파일에서 나온 문항인가"(quiz100/codedrill/bogang)를 받는다.
// 두 이름 체계를 여기 한 곳에서만 잇는다.

/** @typedef {'quiz100'|'codedrill'|'bogang'} AiSource */

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
