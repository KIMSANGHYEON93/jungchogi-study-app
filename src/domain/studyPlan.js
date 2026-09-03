// 학습 플래너(Phase 2)의 도메인 계층.
//
// - `/api/ai/plan` 이 받는 스냅샷을 만들고
// - 서버가 돌려준 계획(StudyPlan)을 화면이 믿고 쓸 수 있는 모양으로 정규화하고
// - 계획 항목을 실제 학습 화면으로 잇는다.
//
// 서버가 없어도 이 파일은 순수하게 동작한다 — 네트워크는 services/aiClient.js 담당.

import {
  getWrongNotes,
  getExamDate,
  getStudyTimeLog,
  getSpacedRepetitionDue,
  loadProgress,
  toLocalDateKey,
} from '../utils/storage';
import { toAiSource } from './aiSource';

/**
 * `/api/ai/plan` 요청에 실리는 학습자 스냅샷 (BLUEPRINT §4.3).
 * @typedef {Object} PlanSnapshot
 * @property {string|null} examDate 시험일(ISO 날짜). D-Day 미설정이면 null
 * @property {SnapshotWrongNote[]} wrongNotes 오답 식별자·메타데이터 (본문은 빼고 보낸다)
 * @property {Record<string, 'correct'|'incorrect'|'answered'>} quizResults
 *   Phase 3 채점 결과와 레거시 값('answered' = 시도했으나 정오 미상)이 섞여 있다.
 *   서버(`lib/ai/tools/snapshotTools.js`)가 세 값을 구분해 약점 분석에 쓴다.
 * @property {Record<string, number>} studyTime 최근 며칠간 `YYYY-MM-DD → 분`
 * @property {Record<string, true>} dayChecks 완료 표시한 Day 만
 * @property {number} availableMinutes 오늘 낼 수 있는 학습 시간(분)
 */

/**
 * 서버(`lib/ai/guard.js`)가 화이트리스트로 남기는 필드와 같은 집합이다.
 * 그 밖의 필드를 실어 보내도 서버가 버리므로 토큰만 낭비된다.
 * @typedef {Object} SnapshotWrongNote
 * @property {'quiz100'|'codedrill'|'bogang'} source 서버가 문항을 찾을 때 쓰는 교재 출처
 * @property {string} id
 * @property {string} [question] 짧게 자른 문항 라벨
 * @property {string} [category]
 * @property {number} reviewCount
 * @property {number} addedAt
 * @property {number} [lastReviewed]
 * @property {boolean} mastered
 */

/**
 * @typedef {Object} PlanItem
 * @property {'review_wrong'|'study_day'|'drill'|string} type
 * @property {'quiz100'|'codedrill'|'bogang'} [source]
 * @property {string[]} ids
 * @property {number} [day]
 * @property {string} [section]
 * @property {number} minutes
 * @property {string} why
 */

/**
 * 하루치 학습 계획 애그리게이트. localStorage `study_plan_<date>` 에 저장한다.
 * @typedef {Object} StudyPlan
 * @property {string} date 로컬 기준 YYYY-MM-DD
 * @property {PlanItem[]} items
 * @property {string} rationale
 * @property {string[]} riskFlags
 */

/**
 * 스트리밍 중 서버가 알려주는 도구 호출 진행 상황.
 * @typedef {Object} PlanToolEvent
 * @property {'tool'|'tool_result'} phase
 * @property {string} tool
 * @property {object} [input]
 * @property {boolean} [ok]
 */

// ─── 오늘 낼 수 있는 시간 ───

/** 블루프린트 §4.3 예시와 같은 90분을 기본값으로 둔다 */
export const DEFAULT_AVAILABLE_MINUTES = 90;

/** 카드에서 고르는 선택지 — 자유 입력 대신 고정 선택지라 잘못된 값이 들어올 여지가 없다 */
export const AVAILABLE_MINUTES_OPTIONS = [30, 60, 90, 120, 150, 180];

const MIN_AVAILABLE_MINUTES = 10;
const MAX_AVAILABLE_MINUTES = 600;

/**
 * 사용자가 고른 학습 시간을 유효 범위로 좁힌다.
 * 저장된 값이 깨졌거나(손상 JSON 폴백) 범위를 벗어나도 계획 생성이 막히면 안 된다.
 * @param {unknown} value
 * @returns {number}
 */
export function clampAvailableMinutes(value) {
  // null 을 0 으로 읽어 10분으로 깎지 않도록 타입부터 거른다 (Number(null) === 0)
  if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_AVAILABLE_MINUTES;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AVAILABLE_MINUTES;
  return Math.min(Math.max(Math.round(n), MIN_AVAILABLE_MINUTES), MAX_AVAILABLE_MINUTES);
}

// ─── 스냅샷 ───

/**
 * 스냅샷 크기 상한.
 *
 * 서버가 본문 크기 상한을 걸고 400 을 낸다. 오답노트는 한 건당 코드·정답·함정까지
 * 통째로 저장돼 있어(수 KB) 그대로 보내면 수백 KB 가 된다. 그래서
 *   1) 본문 필드를 빼고 식별자·메타데이터만 보내고 (서버는 source+id 로 교재에서 다시 찾는다)
 *   2) 그러고도 건수가 많으면 잘라낸다.
 * 무엇을 남길지는 `우선순위: 간격 반복 대기 → 미숙달 → 숙달` 로 정한다 —
 * 오늘 계획에 실제로 들어갈 후보부터 남기는 순서다.
 */
export const SNAPSHOT_LIMITS = {
  wrongNotes: 60,
  quizResults: 200,
  studyTimeDays: 14,
  /** 문항 라벨(question)의 최대 길이 — 서버는 500자에서 자른다 */
  noteLabel: 120,
};

// 코드 문항에는 category 대신 lang 이 있다. 서버의 get_weak_categories 는
// 교재에서 category 를 찾지 못하면 노트의 category 로 떨어지므로, 대시보드
// "오답 유형 분석"과 같은 규칙으로 언어를 카테고리 이름으로 옮겨 준다.
const LANG_CATEGORY = { c: 'C언어', java: 'Java', python: 'Python', sql: 'SQL' };

function categoryOf(note) {
  if (note.category) return note.category;
  if (!note.lang) return '';
  return LANG_CATEGORY[note.lang] || String(note.lang).toUpperCase();
}

function labelOf(note) {
  const raw = note.question || note.title;
  if (typeof raw !== 'string' || raw === '') return '';
  return raw.slice(0, SNAPSHOT_LIMITS.noteLabel);
}

/** 정렬 키: 최근에 손댄 오답일수록 먼저 */
function recencyOf(note) {
  return note.lastReviewed || note.addedAt || 0;
}

/** 0 = 간격 반복 대기, 1 = 미숙달, 2 = 숙달 */
function priorityOf(note, due) {
  if (note.mastered) return 2;
  return due ? 0 : 1;
}

function selectWrongNotes() {
  const notes = getWrongNotes();
  const dueKeys = new Set(getSpacedRepetitionDue().map((n) => `${n.source}|${n.id}`));

  return notes
    .map((note) => {
      const source = toAiSource(note);
      if (!source) return null; // 교재 출처를 못 찾으면 서버가 문항을 찾을 수 없다
      const due = dueKeys.has(`${note.source}|${note.id}`);
      /** @type {SnapshotWrongNote} */
      const slim = {
        source,
        id: String(note.id),
        reviewCount: Number(note.reviewCount) || 0,
        mastered: !!note.mastered,
        // 서버가 간격 반복(1/3/7일)을 다시 계산할 때 쓰는 기준 시각.
        // 빠뜨리면 서버가 "정보 없음 → 즉시 대기"로 보고 전부 대기로 판정한다.
        addedAt: Number(note.addedAt) || 0,
      };
      if (note.lastReviewed) slim.lastReviewed = note.lastReviewed;
      const category = categoryOf(note);
      if (category) slim.category = category;
      const label = labelOf(note);
      if (label) slim.question = label;
      // `due` 는 보내지 않는다 — 서버가 같은 규칙으로 다시 계산하고, 스냅샷
      // 화이트리스트에도 없어 어차피 버려진다. 여기서는 무엇을 남길지 고르는 데만 쓴다.
      return { slim, rank: priorityOf(note, due), recency: recencyOf(note) };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.recency - a.recency)
    .slice(0, SNAPSHOT_LIMITS.wrongNotes)
    .map((entry) => entry.slim);
}

// 서버(`lib/ai/guard.js`)는 맵 필드의 값 타입을 엄격히 본다 —
// quizResults 는 문자열, studyTime 은 유한한 수, dayChecks 는 불리언이어야 하고
// 하나라도 어긋나면 요청 전체가 400 이다. 손상되거나 구버전 형식이 섞인 값이
// 계획 생성을 통째로 막지 않도록 여기서 다듬어 보낸다.

function recentStudyTime() {
  const log = getStudyTimeLog();
  const recent = {};
  for (let i = 0; i < SNAPSHOT_LIMITS.studyTimeDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = toLocalDateKey(d);
    if (Number.isFinite(log[key])) recent[key] = log[key];
  }
  return recent;
}

// 값을 세 가지로 좁히지 않고 문자열이면 통과시킨다 — 서버가 계약 밖 값을
// 레거시(정오 미상)와 같게 다루므로, 여기서 걸러 정보를 없애는 쪽이 더 위험하다.
function cappedQuizResults() {
  const results = loadProgress('quiz_results', {}) || {};
  const entries = Object.entries(results)
    .filter(([, verdict]) => typeof verdict === 'string')
    .slice(0, SNAPSHOT_LIMITS.quizResults);
  return Object.fromEntries(entries);
}

function completedDayChecks() {
  const checks = loadProgress('day_checks', {}) || {};
  // 완료한 Day 만 보낸다 — 서버는 1~14 를 알고 있으므로 false 는 정보가 아니다
  return Object.fromEntries(
    Object.entries(checks)
      .filter(([, done]) => !!done)
      .map(([day]) => [day, true])
  );
}

/**
 * localStorage 의 학습 기록으로 `/api/ai/plan` 스냅샷을 만든다.
 * @param {{availableMinutes?: unknown}} [options]
 * @returns {PlanSnapshot}
 */
export function buildPlanSnapshot(options = {}) {
  return {
    // D-Day 미설정이면 null 을 그대로 보낸다. 계획 생성 자체를 막지 않는다 —
    // 시험일은 앱에서도 선택 항목이고, 없으면 "마감 없는 계획"으로 세우면 된다.
    examDate: getExamDate() ?? null,
    wrongNotes: selectWrongNotes(),
    quizResults: cappedQuizResults(),
    studyTime: recentStudyTime(),
    dayChecks: completedDayChecks(),
    availableMinutes: clampAvailableMinutes(options?.availableMinutes),
  };
}

// ─── 계획 정규화 ───

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  /** @type {PlanItem} */
  const item = {
    type: typeof raw.type === 'string' ? raw.type : '학습',
    ids: toStringArray(raw.ids),
    minutes: Number.isFinite(Number(raw.minutes)) ? Math.round(Number(raw.minutes)) : 0,
    why: typeof raw.why === 'string' ? raw.why : '',
  };
  if (typeof raw.source === 'string') item.source = raw.source;
  if (Number.isFinite(Number(raw.day))) item.day = Number(raw.day);
  if (typeof raw.section === 'string' && raw.section !== '') item.section = raw.section;
  return item;
}

/**
 * 서버가 돌려준 계획을 화면·저장이 믿고 쓸 수 있는 모양으로 맞춘다.
 * 구조화 출력이 스키마를 지켜 주지만, 여기서 한 번 더 막아야 잘못된 응답 하나가
 * 대시보드를 통째로 깨뜨리지 않는다.
 *
 * @param {unknown} raw
 * @param {{date: string}} context 오늘 날짜 — 서버가 date 를 빠뜨렸을 때 쓴다
 * @returns {StudyPlan|null} 계획으로 볼 수 없으면 null
 */
export function normalizePlan(raw, context) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  return {
    date: typeof raw.date === 'string' && raw.date !== '' ? raw.date : context.date,
    items: raw.items.map(normalizeItem).filter(Boolean),
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    riskFlags: Array.isArray(raw.riskFlags) ? raw.riskFlags.map(String) : [],
  };
}

// ─── 도구 호출 진행 표시 ───

/** §4.3 이 정한 도구 5종 */
const TOOL_LABELS = {
  search_content: '교재 내용 검색',
  get_section: '교재 섹션 읽기',
  list_problems: '문항 목록 조회',
  get_weak_categories: '약점 카테고리 계산',
  get_due_reviews: '복습 대기 목록 조회',
};

/**
 * 도구 호출 프레임을 화면에 띄울 한 줄로 바꾼다.
 * @param {PlanToolEvent} event
 * @returns {string}
 */
export function describeToolEvent(event) {
  const label = TOOL_LABELS[event?.tool] ?? `AI 도구(${event?.tool})`;
  if (event?.phase === 'tool_result') return `${label} ${event.ok ? '완료' : '실패'}`;
  return `${label} 중…`;
}

// ─── 계획 항목 → 학습 화면 ───

/** 드릴 항목의 교재 출처별로 실제 풀 수 있는 화면 */
const SOURCE_ROUTES = {
  codedrill: { to: '/quiz', label: '코드 퀴즈' },
  quiz100: { to: '/flashcard', label: '플래시카드' },
  bogang: { to: '/flashcard', label: '플래시카드' },
};

/**
 * 계획 항목의 한 줄 제목.
 * @param {PlanItem} item
 * @returns {string}
 */
export function planItemTitle(item) {
  const ids = Array.isArray(item?.ids) ? item.ids : [];
  switch (item?.type) {
    case 'review_wrong':
      return ids.length ? `오답 복습 · ${ids.join(', ')}` : '오답 복습';
    case 'study_day':
      return item.section ? `Day ${item.day} · ${item.section}` : `Day ${item.day}`;
    case 'drill':
      return ids.length ? `드릴 · ${ids.join(', ')}` : '드릴';
    default:
      return item?.type ?? '학습';
  }
}

/**
 * 계획 항목에서 이어갈 학습 화면.
 *
 * 각 페이지는 URL 파라미터를 하나씩만 읽는다(`/study?day=`, `/search?q=`).
 * 문항 단위(`ids`)로 바로 여는 경로는 없어서 화면 단위까지만 잇는다.
 *
 * @param {PlanItem} item
 * @returns {{to: string, label: string}|null} 이어갈 화면이 없으면 null
 */
export function planItemLink(item) {
  switch (item?.type) {
    case 'review_wrong':
      return { to: '/wrong', label: '오답노트' };
    case 'study_day':
      if (Number.isFinite(item.day)) {
        return { to: `/study?day=${item.day}`, label: `Day ${item.day} 학습노트` };
      }
      if (item.section) {
        return {
          to: `/search?q=${encodeURIComponent(item.section)}`,
          label: `검색: ${item.section}`,
        };
      }
      return null;
    case 'drill':
      return SOURCE_ROUTES[item.source] ?? null;
    default:
      return null;
  }
}
