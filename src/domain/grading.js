// 자동 채점(Phase 3)의 도메인 계층.
//
// - 서버가 돌려준 채점 결과(§4.2)를 화면이 믿고 쓸 수 있는 모양으로 정규화하고
// - `confidence < 0.6` 폴백 경계를 한 곳에서 정하고
// - `quiz_results` 저장값 세 가지를 읽고 쓰는 규칙을 모은다.
//
// 서버가 없어도 이 파일은 순수하게 동작한다 — 네트워크는 services/aiClient.js 담당.

/**
 * `/api/ai/grade` 응답 (BLUEPRINT §4.2).
 * @typedef {Object} GradeResult
 * @property {'correct'|'partial'|'incorrect'} verdict
 * @property {number} score 0..100
 * @property {string} feedback
 * @property {string[]} missedPoints
 * @property {number} confidence 0..1
 */

/**
 * AI 판정을 확정으로 쓸 수 있는 최소 confidence (BLUEPRINT §4.2).
 *
 * 이 값 아래면 AI 의견을 참고로만 보여주고 사용자가 직접 맞음/틀림을 고르는
 * 기존 자기 채점 흐름으로 넘긴다. 경계는 여기 한 곳에만 둔다 —
 * 훅·컴포넌트·페이지가 각자 숫자를 들고 있으면 곧 어긋난다.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

const VERDICTS = ['correct', 'partial', 'incorrect'];

/** verdict 별 기본 점수 — 서버가 score 를 빠뜨렸을 때만 쓴다 */
const DEFAULT_SCORE = { correct: 100, partial: 50, incorrect: 0 };

/**
 * `quiz_results` 에 저장되는 값. 서버 에이전트와 합의된 고정 계약이다.
 *
 * - `correct`/`incorrect` : Phase 3 이후의 채점 결과 (AI 채점 확정분 + 사용자 자기 채점)
 * - `answered`            : 시도했으나 정오 미상. Phase 2 까지 쌓인 레거시 값이며,
 *                           지금도 "답을 냈지만 아직 채점하지 않은" 상태를 뜻한다.
 *                           **정답으로도 오답으로도 세면 안 된다.**
 *
 * 레거시 값에는 정오 정보가 없어 마이그레이션으로 복원할 수 없다.
 * 그래서 값을 고치는 대신 읽는 쪽이 세 값을 모두 다룬다.
 */
export const QUIZ_RESULT = {
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  /** 정오 미상 — 통계에서 정답/오답 어느 쪽으로도 세지 않는다 */
  ANSWERED: 'answered',
};

const GRADED_VALUES = [QUIZ_RESULT.CORRECT, QUIZ_RESULT.INCORRECT];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => v != null).map(String);
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

/**
 * 서버가 돌려준 채점 결과를 화면이 믿고 쓸 수 있는 모양으로 맞춘다.
 *
 * 구조화 출력이 스키마를 지켜 주지만, 여기서 한 번 더 막아야 잘못된 응답
 * 하나가 화면을 깨뜨리거나 — 더 나쁘게 — 근거 없는 판정을 확정으로 만들지 않는다.
 * 읽을 수 없는 confidence 는 0 으로 본다: 모르면 자기 채점으로 떨어지는 쪽이 안전하다.
 *
 * @param {unknown} raw
 * @returns {GradeResult|null} 채점 결과로 볼 수 없으면 null
 */
export function normalizeGradeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!VERDICTS.includes(raw.verdict)) return null;

  const score = Number(raw.score);
  const confidence = Number(raw.confidence);

  return {
    verdict: raw.verdict,
    score: Number.isFinite(score) ? Math.round(clamp(score, 0, 100)) : DEFAULT_SCORE[raw.verdict],
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
    missedPoints: toStringArray(raw.missedPoints),
    confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0,
  };
}

/**
 * AI 판정을 확정으로 써도 되는가 (BLUEPRINT §4.2).
 * @param {GradeResult|null|undefined} result
 * @returns {boolean}
 */
export function isConfidentGrade(result) {
  return !!result && result.confidence >= CONFIDENCE_THRESHOLD;
}

/**
 * 채점 판정을 저장값으로 옮긴다.
 *
 * `partial` 은 오답으로 접는다 — 못 짚은 부분(`missedPoints`)이 남아 있는데
 * 정답으로 세면 정답률이 실제보다 높아진다. 저장 계약에 중간값이 없기도 하다.
 *
 * @param {string} verdict
 * @returns {'correct'|'incorrect'|null} 알 수 없는 판정이면 null
 */
export function verdictToQuizResult(verdict) {
  if (verdict === 'correct') return QUIZ_RESULT.CORRECT;
  if (verdict === 'partial' || verdict === 'incorrect') return QUIZ_RESULT.INCORRECT;
  return null;
}

/**
 * 채점 결과 맵에 한 문항의 판정을 얹은 새 맵을 돌려준다.
 * 계약에 없는 값은 저장하지 않는다 — 읽는 쪽이 다뤄야 할 값의 가짓수를 늘리지 않는다.
 *
 * @param {Record<string, string>} results
 * @param {string} id
 * @param {'correct'|'incorrect'} quizResult
 * @returns {Record<string, string>}
 */
export function withQuizResult(results, id, quizResult) {
  const base = results && typeof results === 'object' ? results : {};
  if (!GRADED_VALUES.includes(quizResult) || typeof id !== 'string' || id === '') return base;
  return { ...base, [id]: quizResult };
}

/**
 * @typedef {Object} QuizResultsSummary
 * @property {number} attempted 답을 낸 문항 수 (세 값 모두 포함)
 * @property {number} correct
 * @property {number} incorrect
 * @property {number} graded 정오가 확정된 문항 수 (correct + incorrect)
 * @property {number} ungraded 시도했지만 정오 미상 — 레거시 `answered` 포함
 * @property {number|null} accuracy 채점된 문항만으로 낸 정답률(%). 채점분이 없으면 null
 */

/**
 * `quiz_results` 를 읽는 모든 화면이 같은 셈을 하도록 한 곳에 모은다.
 *
 * 레거시 `'answered'` 는 "시도했지만 정오 미상"이라 **정답으로도 오답으로도
 * 세지 않는다**. 정답률은 채점된 문항만으로 내고, 채점분이 하나도 없으면
 * 숫자를 만들지 않고 null 을 돌려준다(0% 로 보이면 실제와 다르다).
 *
 * 문자열이 아닌 손상된 값은 시도로도 세지 않는다 —
 * `domain/studyPlan.js` 의 스냅샷 규칙과 같은 판정이다.
 *
 * @param {Record<string, unknown>|null|undefined} results
 * @returns {QuizResultsSummary}
 */
export function summarizeQuizResults(results) {
  let attempted = 0;
  let correct = 0;
  let incorrect = 0;

  for (const value of Object.values(results && typeof results === 'object' ? results : {})) {
    if (typeof value !== 'string' || value === '') continue;
    attempted += 1;
    if (value === QUIZ_RESULT.CORRECT) correct += 1;
    else if (value === QUIZ_RESULT.INCORRECT) incorrect += 1;
  }

  const graded = correct + incorrect;
  return {
    attempted,
    correct,
    incorrect,
    graded,
    ungraded: attempted - graded,
    accuracy: graded === 0 ? null : Math.round((correct / graded) * 100),
  };
}
