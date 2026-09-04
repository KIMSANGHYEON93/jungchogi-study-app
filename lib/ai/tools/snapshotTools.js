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
 * `quiz_results`·`exam_results` 에 저장되는 값 (클라이언트와 합의된 고정 계약).
 *   'correct' / 'incorrect' — Phase 3 자동 채점이 남기는 정오 결과
 *   'answered'              — 레거시. "시도했으나 정오 미상"
 * 계약 밖의 값이 들어오면 레거시와 같게(정오 미상) 다룬다.
 * 두 맵의 값 계약이 같아서 한 표로 두 맵을 읽는다.
 */
const KNOWN_VERDICTS = { correct: false, incorrect: true };

/**
 * 카테고리별 정답률을 센다.
 *
 * 판정 규칙 — 문항 단위로 "시도했는가 / 틀렸는가" 를 정하고 카테고리별로 합친다.
 *   - 시도(attempted): `quizResults`·`examResults` 에 기록이 있거나 오답노트에 있는 문항
 *     (같은 문항이 여러 곳에 있어도 한 번만 센다)
 *   - 오답(wrong):
 *       · 채점 결과 값이 'correct'/'incorrect' 면 **그 값을 그대로** 쓴다.
 *       · 그 밖의 값('answered' 등 레거시)이거나 기록이 없으면 오답노트로 추정한다 —
 *         오답노트에 있고 아직 `mastered` 가 아니면 오답.
 *   - 정답률(accuracy): (시도 − 오답) / 시도, 소수 둘째 자리 반올림
 *
 * **아는 것이 추정을 이긴다.** 같은 문항에 오답노트(추정)와 채점 결과(사실)가 함께
 * 있으면 채점 결과를 따른다. 숙달 처리된 오답노트라도 최근 채점이 'incorrect' 면 오답이고,
 * 미숙달로 남아 있어도 최근 채점이 'correct' 면 오답이 아니다. 두 세대 데이터가 섞인
 * 스냅샷에서도 이 규칙 하나로 일관된 값이 나온다.
 *
 * **아는 것끼리 부딪히면 모의고사가 이긴다.** `quizResults` 와 `examResults` 에 같은
 * 문항의 확정 판정이 서로 다르게 들어 있을 수 있다(코드 드릴은 두 화면 모두에서 나온다).
 * 두 맵 어디에도 타임스탬프가 없어 "더 최근 것"을 고를 수 없으므로 순서를 규칙으로
 * 못 박는다 — 모의고사는 정답을 가린 채 시간 제한 아래에서 한 번에 푸는 실전 조건이고,
 * 코드 퀴즈는 "정답 확인" 버튼이 바로 옆에 있는 연습 화면이다. 실력 추정으로서
 * 앞의 것이 낫다. 처리 순서로 정해 두면 같은 스냅샷이 언제나 같은 결과를 낸다.
 * 다만 이건 **확정끼리의 규칙**이다 — 모의고사의 'answered'(정오 미상)는 코드 퀴즈의
 * 확정 판정을 밀어내지 못한다. 그러면 아는 것이 추정에 지게 된다.
 *
 * `examResults` 는 없어도 되는 필드다(갱신 전 클라이언트). 없으면 예전과 같은 계산이다.
 *
 * @param {{wrongNotes?: Array<object>, quizResults?: Record<string, string>,
 *          examResults?: Record<string, string>}} snapshot
 * @returns {{categories: Array<{category: string, attempted: number, wrong: number, accuracy: number}>}}
 */
export function runGetWeakCategories(snapshot) {
  /** 문항키(`source/id`) → {category, wrong} */
  const problems = new Map();

  const upsert = (key, category, wrong) => {
    const found = problems.get(key);
    if (found) {
      if (wrong !== undefined) found.wrong = wrong;
      return;
    }
    problems.set(key, { category, wrong: wrong ?? false });
  };

  // 1) 오답노트 — 정오를 모르는 문항의 추정 근거
  for (const note of snapshot?.wrongNotes ?? []) {
    const meta = findProblemMeta(note.id, note.source);
    // 교재에서 사라진 id 는 카테고리를 알 수 없다. 노트가 들고 있는 값으로 대체하고
    // 그것도 없으면 통계에서 뺀다 (모르는 카테고리를 지어내지 않는다).
    const category = meta?.category || note.category;
    if (!category) continue;

    upsert(`${note.source}/${note.id}`, category, !note.mastered);
  }

  // 2) 채점 기록 — 정오를 아는 문항은 여기서 확정한다 (추정을 덮어쓴다).
  //    순서가 곧 우선순위다: 뒤에 오는 모의고사가 앞의 코드 퀴즈를 덮는다 (위 주석 참조).
  for (const results of [snapshot?.quizResults, snapshot?.examResults]) {
    for (const [id, value] of Object.entries(results ?? {})) {
      const meta = findProblemMeta(id);
      if (!meta?.category) continue;

      // 계약 밖 값·'answered' 는 undefined 라 upsert 가 기존 판정을 그대로 둔다 —
      // 정오 미상이 확정을 밀어내지 않는다
      const known = KNOWN_VERDICTS[value];
      upsert(`${meta.source}/${meta.id}`, meta.category, known);
    }
  }

  /** 카테고리 → {attempted, wrong} */
  const buckets = new Map();
  for (const { category, wrong } of problems.values()) {
    const bucket = buckets.get(category) ?? { attempted: 0, wrong: 0 };
    bucket.attempted += 1;
    if (wrong) bucket.wrong += 1;
    buckets.set(category, bucket);
  }

  const categories = [...buckets.entries()]
    .map(([category, { attempted, wrong }]) => ({
      category,
      attempted,
      wrong,
      accuracy: Math.round(((attempted - wrong) / attempted) * 100) / 100,
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
