// 스냅샷 위에서 계산하는 플래너 도구 2종 — `get_weak_categories` · `get_due_reviews`.
//
// 서버에는 학습 기록 DB 가 없다 (블루프린트 §3.2). 오답노트·퀴즈 결과는 요청에 실려 오고,
// 여기서는 그 위에서만 계산한다. 교재 파일은 **카테고리·제목을 붙이는 용도로만** 읽는다.

import { listProblemMeta, SOURCE_FILES } from '../content.js';
import { selectDueReviews } from '../spacedRepetition.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const ALLOWED_SOURCES = Object.keys(SOURCE_FILES);

/**
 * 문항 id 하나로 교재의 메타를 찾는다.
 *
 * 퀴즈 결과(`quizResults`)는 `{id: 상태}` 형태라 source 가 없다. id 형식이
 * source 마다 달라(`001` / `C-01` / `B01`) 겹치지 않으므로, 교재를 실제로 조회해
 * 처음 맞는 것을 쓴다. 형식 정규식을 또 하나 두는 대신 데이터에 물어보는 쪽이
 * 파일이 바뀌어도 어긋나지 않는다.
 * @param {string} id
 * @param {string} [preferredSource] 아는 경우 먼저 본다
 * @returns {import('../content.js').ProblemMeta|null}
 */
export function findProblemMeta(id, preferredSource) {
  if (typeof id !== 'string' || id === '') return null;

  const order = preferredSource
    ? [preferredSource, ...ALLOWED_SOURCES.filter((s) => s !== preferredSource)]
    : ALLOWED_SOURCES;

  for (const source of order) {
    const [found] = listProblemMeta(source, { ids: [id] });
    if (found) return found;
  }
  return null;
}

/**
 * 카테고리별 정답률을 센다.
 *
 * 판정 규칙 (스냅샷에 "정답/오답" 이 명시돼 있지 않아 아래처럼 정의한다):
 *   - 시도(attempted): `quizResults` 에 기록이 있거나 오답노트에 있는 문항의 수 (문항 단위 중복 제거)
 *   - 오답(wrong): 오답노트에 있고 아직 `mastered` 가 아닌 문항의 수
 *   - 정답률(accuracy): (시도 − 오답) / 시도, 소수 둘째 자리 반올림
 * `mastered` 인 오답노트는 "틀렸지만 이제 안다"는 뜻이므로 오답으로 세지 않는다.
 *
 * @param {{wrongNotes?: Array<object>, quizResults?: Record<string, string>}} snapshot
 * @returns {object}
 */
export function runGetWeakCategories(snapshot) {
  /** 카테고리 → {attempted: Set<문항키>, wrong: Set<문항키>} */
  const buckets = new Map();

  const bucket = (category) => {
    if (!buckets.has(category)) {
      buckets.set(category, { attempted: new Set(), wrong: new Set() });
    }
    return buckets.get(category);
  };

  for (const note of snapshot?.wrongNotes ?? []) {
    const meta = findProblemMeta(note.id, note.source);
    // 교재에서 사라진 id 는 카테고리를 알 수 없다. 노트가 들고 있는 값으로 대체하고
    // 그것도 없으면 통계에서 뺀다 (모르는 카테고리를 지어내지 않는다).
    const category = meta?.category || note.category;
    if (!category) continue;

    const key = `${note.source}/${note.id}`;
    bucket(category).attempted.add(key);
    if (!note.mastered) bucket(category).wrong.add(key);
  }

  for (const id of Object.keys(snapshot?.quizResults ?? {})) {
    const meta = findProblemMeta(id);
    if (!meta?.category) continue;
    bucket(meta.category).attempted.add(`${meta.source}/${meta.id}`);
  }

  const categories = [...buckets.entries()]
    .map(([category, { attempted, wrong }]) => ({
      category,
      attempted: attempted.size,
      wrong: wrong.size,
      accuracy: Math.round(((attempted.size - wrong.size) / attempted.size) * 100) / 100,
    }))
    // 약한 것부터. 같으면 이름순 — 순서가 결정적이어야 같은 스냅샷이 같은 계획을 만든다.
    .sort((a, b) => a.accuracy - b.accuracy || a.category.localeCompare(b.category));

  return { categories };
}

/**
 * 간격 반복 복습 대기 목록.
 * 판정은 `selectDueReviews`(화면의 `getSpacedRepetitionDue` 와 동치)에 맡기고,
 * 여기서는 모델이 읽을 수 있게 교재 제목·카테고리만 덧붙인다 (정답은 붙이지 않는다).
 * @param {{wrongNotes?: Array<object>}} snapshot
 * @param {number} now
 * @returns {object}
 */
export function runGetDueReviews(snapshot, now) {
  const due = selectDueReviews(snapshot?.wrongNotes ?? [], now).map((note) => {
    const meta = findProblemMeta(note.id, note.source);
    const since = note.lastReviewed || note.addedAt;

    return {
      source: note.source,
      id: note.id,
      title: meta?.title || note.question || '',
      category: meta?.category || note.category || '',
      reviewCount: note.reviewCount,
      // 며칠 밀렸는지 — 우선순위를 정할 때 쓰라고 준다. 기준 시각이 없으면 null.
      daysSince: since ? Math.floor((now - since) / MS_PER_DAY) : null,
    };
  });

  return { due };
}
