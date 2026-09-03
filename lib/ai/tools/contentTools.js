// 교재·문항을 읽는 플래너 도구 3종 — `search_content` · `get_section` · `list_problems`.
//
// 파싱·검색 규칙은 `lib/ai/content.js` 를 그대로 재사용한다 (오답 해설과 같은 규칙).
// 여기서는 "모델에게 무엇을 보여줄지"만 정한다.

import {
  findRelatedSections,
  getSection,
  listProblemMeta,
  SOURCE_FILES,
} from '../content.js';

/** `search_content` 가 한 번에 돌려줄 섹션 수 */
export const DEFAULT_SEARCH_LIMIT = 3;
export const MAX_SEARCH_LIMIT = 8;
/** `list_problems` 의 ids 인자 최대 길이 — 모델이 문항 전체를 한 번에 요구하지 못하게 */
export const MAX_PROBLEM_IDS = 60;
/** 도구 결과에 담을 섹션 본문의 최대 길이 (컨텍스트 폭주 방지) */
export const MAX_SECTION_BODY = 4_000;

const ALLOWED_SOURCES = Object.keys(SOURCE_FILES);

/** 자유 문자열 인자를 문자열로 좁힌다 (스키마가 막지 못한 형태 방어) */
const asString = (value) => (typeof value === 'string' ? value : '');

/**
 * 교재에서 질의와 관련된 섹션을 찾는다.
 * @param {{query?: string, limit?: number|null}} input
 * @returns {object} 도구 결과로 직렬화할 객체
 */
export function runSearchContent(input) {
  const query = asString(input?.query).trim();
  if (!query) {
    return { error: 'query 가 비어 있습니다. 찾고 싶은 개념을 한두 낱말로 주세요.' };
  }

  const requested = Number(input?.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_SEARCH_LIMIT)
    : DEFAULT_SEARCH_LIMIT;

  // score 는 내부 랭킹 값이라 모델에게 보내지 않는다 (계약: file/heading/excerpt)
  const sections = findRelatedSections(query, { limit }).map(({ file, heading, excerpt }) => ({
    file,
    heading,
    excerpt,
  }));

  return { sections };
}

/**
 * 교재 섹션 본문을 읽는다.
 * @param {{file?: string, heading?: string}} input
 * @returns {object}
 */
export function runGetSection(input) {
  const file = asString(input?.file);
  const heading = asString(input?.heading);

  const section = file && heading ? getSection(file, heading) : null;
  if (!section) {
    return {
      error: `${file || '(파일 없음)'} 에서 "${heading || '(헤딩 없음)'}" 섹션을 찾지 못했습니다. search_content 로 얻은 file·heading 을 그대로 쓰세요.`,
    };
  }

  const body = section.body.slice(0, MAX_SECTION_BODY);
  return {
    file: section.file,
    heading: section.heading,
    body,
    truncated: body.length < section.body.length,
  };
}

/**
 * 문항 **메타**를 나열한다 — 정답은 담지 않는다 (`listProblemMeta` 가 보장).
 * @param {{source?: string, category?: string|null, ids?: string[]|null}} input
 * @returns {object}
 */
export function runListProblems(input) {
  const source = asString(input?.source);
  if (!ALLOWED_SOURCES.includes(source)) {
    return { error: `source 는 ${ALLOWED_SOURCES.join(' | ')} 중 하나여야 합니다.` };
  }

  const rawIds = Array.isArray(input?.ids) ? input.ids.filter((id) => typeof id === 'string') : null;
  const truncated = rawIds !== null && rawIds.length > MAX_PROBLEM_IDS;
  const ids = rawIds === null ? null : rawIds.slice(0, MAX_PROBLEM_IDS);

  const category = typeof input?.category === 'string' ? input.category : null;
  const problems = listProblemMeta(source, { category, ids });

  return truncated ? { problems, truncated: true } : { problems };
}
