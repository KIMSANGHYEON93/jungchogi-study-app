// 간격 반복(1/3/7일) 복습 대기 판정 — `src/utils/storage.js` 의 `getSpacedRepetitionDue` 서버판.
//
// 왜 복사인가: 화면 쪽 함수는 `localStorage` 에서 노트를 읽고 `Date.now()` 를 직접 부른다.
// 서버는 요청에 실려 온 스냅샷 위에서 판정해야 하므로 그 함수를 그대로 부를 수 없다.
// 이상적인 형태는 순수 규칙을 한 곳에 두고 양쪽이 import 하는 것이지만
// 이번 작업 범위에서 `src/` 를 수정할 수 없어, 서버에 같은 규칙을 두고
// **동치성을 테스트로 못 박았다** (`tests/plan-spaced-repetition.test.js`).
// 한쪽 규칙을 바꾸면 그 테스트가 깨진다.

/** 복습 간격 (일). 인덱스 = 지금까지의 복습 횟수. */
export const SPACED_INTERVAL_DAYS = [1, 3, 7];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 복습 대기 상태인 오답노트를 고른다.
 *
 * 판정 규칙(화면과 동일):
 *   - `mastered` 는 제외한다.
 *   - 기준 시각은 `lastReviewed || addedAt`. 둘 다 없으면(0·undefined 포함) 즉시 대기.
 *   - 다음 간격 = `SPACED_INTERVAL_DAYS[min(reviewCount, 2)]`, 없으면 7일.
 *     `reviewCount` 가 없거나 음수면 인덱싱이 빗나가 7일이 된다 — 화면도 같다.
 *   - 경과일이 간격 **이상**이면 대기.
 *
 * @param {Array<{mastered?: boolean, lastReviewed?: number, addedAt?: number,
 *                reviewCount?: number}>} notes 스냅샷의 오답노트 목록
 * @param {number} now `Date.now()` 값 (호출자가 주입 — 서버 시각을 한 번만 읽게)
 * @returns {Array<object>} 입력 순서를 유지한 대기 목록 (원본 객체를 그대로 담는다)
 */
export function selectDueReviews(notes, now) {
  if (!Array.isArray(notes)) return [];

  const lastIndex = SPACED_INTERVAL_DAYS.length - 1;

  return notes.filter((note) => {
    if (!note || typeof note !== 'object') return false;
    if (note.mastered) return false;

    const lastTime = note.lastReviewed || note.addedAt;
    if (!lastTime) return true;

    const daysSince = (now - lastTime) / MS_PER_DAY;
    const nextInterval = SPACED_INTERVAL_DAYS[Math.min(note.reviewCount, lastIndex)] || 7;
    return daysSince >= nextInterval;
  });
}
