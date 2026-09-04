// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_AVAILABLE_MINUTES,
  AVAILABLE_MINUTES_OPTIONS,
  SNAPSHOT_LIMITS,
  clampAvailableMinutes,
  buildPlanSnapshot,
  normalizePlan,
  describeToolEvent,
  planItemTitle,
  planItemLink,
} from '../src/domain/studyPlan.js';
import { saveProgress, setExamDate } from '../src/utils/storage.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 3, 12, 0, 0); // 2026-09-03 12:00 (Asia/Seoul)

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 실제 오답노트가 저장하는 모양 그대로 — 코드·정답 같은 큰 필드를 포함한다 */
function codeNote(id, over = {}) {
  return {
    id,
    source: 'quiz',
    type: 'code',
    title: `문제 ${id}`,
    context: 'x'.repeat(500),
    code: 'y'.repeat(2000),
    lang: 'java',
    answer: 'z'.repeat(300),
    pitfall: 'w'.repeat(300),
    userAnswer: '틀린 답',
    addedAt: NOW.getTime() - DAY,
    reviewCount: 0,
    mastered: false,
    ...over,
  };
}

describe('clampAvailableMinutes', () => {
  it('숫자를 그대로 통과시킨다', () => {
    expect(clampAvailableMinutes(90)).toBe(90);
    expect(clampAvailableMinutes('120')).toBe(120);
  });

  it('숫자가 아니면 기본값으로 되돌린다', () => {
    expect(clampAvailableMinutes(undefined)).toBe(DEFAULT_AVAILABLE_MINUTES);
    expect(clampAvailableMinutes(null)).toBe(DEFAULT_AVAILABLE_MINUTES);
    expect(clampAvailableMinutes('한 시간')).toBe(DEFAULT_AVAILABLE_MINUTES);
  });

  it('범위를 벗어난 값을 잘라낸다', () => {
    expect(clampAvailableMinutes(0)).toBe(10);
    expect(clampAvailableMinutes(-30)).toBe(10);
    expect(clampAvailableMinutes(100000)).toBe(600);
    expect(clampAvailableMinutes(45.7)).toBe(46);
  });

  it('선택지는 모두 유효 범위 안에 있다', () => {
    expect(AVAILABLE_MINUTES_OPTIONS).toContain(DEFAULT_AVAILABLE_MINUTES);
    for (const m of AVAILABLE_MINUTES_OPTIONS) expect(clampAvailableMinutes(m)).toBe(m);
  });
});

describe('buildPlanSnapshot — 정상 데이터', () => {
  beforeEach(() => {
    setExamDate('2026-10-18');
    saveProgress('wrong_notes', [codeNote('C-01'), codeNote('J-03')]);
    saveProgress('quiz_results', { 'C-01': 'incorrect', 'C-02': 'correct' });
    saveProgress('exam_results', { '042': 'correct', 'S-02': 'incorrect' });
    saveProgress('study_time', { '2026-09-02': 40, '2026-09-03': 25 });
    saveProgress('day_checks', { 1: true, 2: false, 6: true });
  });

  it('§4.3 이 정한 키만 담는다 (모의고사 결과 포함 7개)', () => {
    const snapshot = buildPlanSnapshot({ availableMinutes: 90 });
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'availableMinutes',
        'dayChecks',
        'examDate',
        'examResults',
        'quizResults',
        'studyTime',
        'wrongNotes',
      ].sort()
    );
  });

  it('examDate 와 availableMinutes 를 그대로 싣는다', () => {
    const snapshot = buildPlanSnapshot({ availableMinutes: 120 });
    expect(snapshot.examDate).toBe('2026-10-18');
    expect(snapshot.availableMinutes).toBe(120);
  });

  it('완료한 Day 만 dayChecks 에 담는다', () => {
    expect(buildPlanSnapshot({}).dayChecks).toEqual({ 1: true, 6: true });
  });

  it('quizResults 와 studyTime 을 그대로 싣는다', () => {
    const snapshot = buildPlanSnapshot({});
    expect(snapshot.quizResults).toEqual({ 'C-01': 'incorrect', 'C-02': 'correct' });
    expect(snapshot.studyTime).toEqual({ '2026-09-02': 40, '2026-09-03': 25 });
  });

  it('모의고사 채점 결과를 별도 필드로 싣는다', () => {
    // 두 맵을 합쳐 보내면 서버가 어느 쪽 판정인지 구분하지 못한다 —
    // 겹치는 문항의 우선순위 규칙이 성립하지 않는다
    const snapshot = buildPlanSnapshot({});
    expect(snapshot.examResults).toEqual({ '042': 'correct', 'S-02': 'incorrect' });
    expect(snapshot.quizResults).not.toHaveProperty('042');
  });

  it('오답노트는 서버가 읽는 필드만 보내고 본문(코드·정답)은 빼놓는다', () => {
    const snapshot = buildPlanSnapshot({});
    expect(snapshot.wrongNotes).toHaveLength(2);
    // lib/ai/guard.js 의 화이트리스트와 같은 집합 — 나머지는 서버가 어차피 버린다
    expect(Object.keys(snapshot.wrongNotes[0]).sort()).toEqual(
      ['addedAt', 'category', 'id', 'mastered', 'question', 'reviewCount', 'source'].sort()
    );
    const json = JSON.stringify(snapshot);
    for (const heavy of ['code', 'context', 'answer', 'pitfall', 'userAnswer', 'title']) {
      expect(json).not.toContain(`"${heavy}"`);
    }
  });

  it('간격 반복 판정에 필요한 시각(addedAt·lastReviewed)을 함께 보낸다', () => {
    const reviewed = NOW.getTime() - 2 * DAY;
    saveProgress('wrong_notes', [codeNote('C-01', { reviewCount: 1, lastReviewed: reviewed })]);

    const note = buildPlanSnapshot({}).wrongNotes[0];

    // 서버는 이 두 값으로 1/3/7일 간격을 다시 계산한다.
    // 빠뜨리면 서버가 "정보 없음 → 즉시 대기"로 보고 전부 대기로 판정한다.
    expect(note.addedAt).toBe(NOW.getTime() - DAY);
    expect(note.lastReviewed).toBe(reviewed);
  });

  it('카테고리가 없는 코드 문항은 언어를 카테고리로 옮긴다 (대시보드 오답 분석과 같은 규칙)', () => {
    saveProgress('wrong_notes', [
      codeNote('C-01', { lang: 'c' }),
      codeNote('J-01', { lang: 'java' }),
      codeNote('S-01', { lang: 'sql' }),
      codeNote('Q-01', { lang: 'java', category: '데이터베이스' }),
    ]);

    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.category)).toEqual([
      'C언어',
      'Java',
      'SQL',
      '데이터베이스',
    ]);
  });

  it('문항 라벨은 짧게 잘라 보낸다', () => {
    saveProgress('wrong_notes', [codeNote('C-01', { title: '가'.repeat(500) })]);

    expect(buildPlanSnapshot({}).wrongNotes[0].question.length).toBeLessThanOrEqual(120);
  });

  it('화면 source 를 서버가 아는 교재 source 로 옮긴다', () => {
    saveProgress('wrong_notes', [
      codeNote('C-01', { source: 'quiz' }),
      { id: '042', source: 'exam', type: 'quiz', category: 'DB', reviewCount: 0, mastered: false },
      { id: 'B-07', source: 'bogang', category: '보안', reviewCount: 0, mastered: false },
    ]);
    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.source)).toEqual([
      'codedrill',
      'quiz100',
      'bogang',
    ]);
  });

  it('서버가 요구하는 타입에 맞게 맵 값을 다듬는다', () => {
    // 손상되거나 구버전 형식이 섞인 값이 그대로 나가면 서버가 400 을 낸다.
    saveProgress('day_checks', { 1: 1, 2: 'yes', 3: true, 4: 0 });
    saveProgress('quiz_results', { 'C-01': 'correct', 'C-02': 3, 'C-03': null });
    saveProgress('exam_results', { '042': 'incorrect', '077': false });
    saveProgress('study_time', { '2026-09-03': 25, '2026-09-02': '40' });

    const snapshot = buildPlanSnapshot({});

    expect(snapshot.dayChecks).toEqual({ 1: true, 2: true, 3: true });
    expect(snapshot.quizResults).toEqual({ 'C-01': 'correct' });
    expect(snapshot.examResults).toEqual({ '042': 'incorrect' });
    expect(snapshot.studyTime).toEqual({ '2026-09-03': 25 });
  });

  it('대응하는 교재 출처가 없는 오답은 뺀다', () => {
    saveProgress('wrong_notes', [codeNote('C-01'), { id: 'X', source: '알 수 없음' }]);
    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.id)).toEqual(['C-01']);
  });
});

describe('buildPlanSnapshot — 데이터가 없을 때', () => {
  it('빈 localStorage 에서도 스냅샷 모양을 지킨다', () => {
    const snapshot = buildPlanSnapshot({});
    expect(snapshot).toEqual({
      examDate: null,
      wrongNotes: [],
      quizResults: {},
      examResults: {},
      studyTime: {},
      dayChecks: {},
      availableMinutes: DEFAULT_AVAILABLE_MINUTES,
    });
  });

  it('D-Day 미설정이면 examDate 는 null 이다 — 생성 자체는 막지 않는다', () => {
    saveProgress('wrong_notes', [codeNote('C-01')]);
    const snapshot = buildPlanSnapshot({ availableMinutes: 60 });
    expect(snapshot.examDate).toBeNull();
    expect(snapshot.wrongNotes).toHaveLength(1);
  });

  it('availableMinutes 를 안 주면 기본값을 쓴다', () => {
    expect(buildPlanSnapshot({}).availableMinutes).toBe(DEFAULT_AVAILABLE_MINUTES);
    expect(buildPlanSnapshot().availableMinutes).toBe(DEFAULT_AVAILABLE_MINUTES);
  });
});

describe('buildPlanSnapshot — 크기 상한', () => {
  it('오답노트가 상한을 넘으면 잘라낸다', () => {
    const notes = Array.from({ length: 300 }, (_, i) => codeNote(`C-${i}`));
    saveProgress('wrong_notes', notes);
    expect(buildPlanSnapshot({}).wrongNotes).toHaveLength(SNAPSHOT_LIMITS.wrongNotes);
  });

  it('간격 반복 대기 → 미숙달 → 숙달 순으로 남긴다', () => {
    const old = NOW.getTime() - 30 * DAY; // 1일 간격을 이미 넘겨 due
    const fresh = NOW.getTime(); // 방금 복습 → due 아님
    saveProgress('wrong_notes', [
      codeNote('mastered', { mastered: true, addedAt: fresh, lastReviewed: fresh }),
      codeNote('fresh', { addedAt: fresh, lastReviewed: fresh }),
      codeNote('due', { addedAt: old, lastReviewed: old }),
    ]);
    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.id)).toEqual(['due', 'fresh', 'mastered']);
  });

  it('잘라낼 때 간격 반복 대기 오답을 먼저 살린다', () => {
    const old = NOW.getTime() - 30 * DAY;
    const notes = [
      ...Array.from({ length: 100 }, (_, i) => codeNote(`fresh-${i}`, { lastReviewed: NOW.getTime() })),
      codeNote('due-1', { addedAt: old, lastReviewed: old }),
    ];
    saveProgress('wrong_notes', notes);
    const ids = buildPlanSnapshot({}).wrongNotes.map((n) => n.id);
    expect(ids[0]).toBe('due-1');
    expect(ids).toHaveLength(SNAPSHOT_LIMITS.wrongNotes);
  });

  it('학습시간은 최근 며칠만 보낸다', () => {
    const log = {};
    for (let i = 0; i < 60; i++) {
      const d = new Date(NOW.getTime() - i * DAY);
      log[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = 30;
    }
    saveProgress('study_time', log);
    const studyTime = buildPlanSnapshot({}).studyTime;
    expect(Object.keys(studyTime)).toHaveLength(SNAPSHOT_LIMITS.studyTimeDays);
    expect(studyTime['2026-09-03']).toBe(30);
    expect(studyTime['2026-07-20']).toBeUndefined();
  });

  it('퀴즈 결과도 상한을 넘으면 잘라낸다', () => {
    const results = {};
    for (let i = 0; i < 500; i++) results[`Q-${i}`] = 'correct';
    saveProgress('quiz_results', results);
    expect(Object.keys(buildPlanSnapshot({}).quizResults)).toHaveLength(SNAPSHOT_LIMITS.quizResults);
  });

  it('모의고사 결과도 같은 방식으로 잘라낸다', () => {
    // 상한을 두는 이유가 같다 — 브라우저가 보내는 값이 그대로 토큰 비용이 된다
    const results = {};
    for (let i = 0; i < 500; i++) results[`E-${i}`] = 'incorrect';
    saveProgress('exam_results', results);
    expect(Object.keys(buildPlanSnapshot({}).examResults)).toHaveLength(SNAPSHOT_LIMITS.examResults);
  });

  it('최악의 데이터에서도 직렬화 크기가 32KB 를 넘지 않는다', () => {
    saveProgress(
      'wrong_notes',
      Array.from({ length: 500 }, (_, i) => codeNote(`C-${i}`, { title: '가'.repeat(400) }))
    );
    const results = {};
    for (let i = 0; i < 1000; i++) results[`Q-${i}`] = 'incorrect';
    saveProgress('quiz_results', results);
    const log = {};
    for (let i = 0; i < 400; i++) {
      const d = new Date(NOW.getTime() - i * DAY);
      log[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = 120;
    }
    saveProgress('study_time', log);
    const bytes = JSON.stringify(buildPlanSnapshot({})).length;
    expect(bytes).toBeLessThan(32 * 1024);
  });
});

describe('normalizePlan', () => {
  const raw = {
    date: '2026-09-03',
    items: [{ type: 'review_wrong', source: 'quiz100', ids: ['042'], minutes: 20, why: '약점' }],
    rationale: '오답부터',
    riskFlags: ['SQL 정답률 40%'],
  };

  it('명세대로 온 계획을 그대로 통과시킨다', () => {
    expect(normalizePlan(raw, { date: '2026-09-03' })).toEqual(raw);
  });

  it('date 가 없으면 오늘 날짜를 채운다', () => {
    const { date } = normalizePlan({ ...raw, date: undefined }, { date: '2026-09-03' });
    expect(date).toBe('2026-09-03');
  });

  it('items 가 배열이 아니면 계획으로 인정하지 않는다', () => {
    expect(normalizePlan({ ...raw, items: null }, { date: '2026-09-03' })).toBeNull();
    expect(normalizePlan(null, { date: '2026-09-03' })).toBeNull();
    expect(normalizePlan('계획입니다', { date: '2026-09-03' })).toBeNull();
  });

  it('빠지거나 형식이 어긋난 필드를 안전한 기본값으로 메운다', () => {
    const plan = normalizePlan(
      { items: [{ type: 'study_day', day: '6', minutes: '30', ids: 'J-03' }] },
      { date: '2026-09-03' }
    );
    expect(plan.items[0]).toEqual({
      type: 'study_day',
      day: 6,
      minutes: 30,
      ids: ['J-03'],
      why: '',
    });
    expect(plan.rationale).toBe('');
    expect(plan.riskFlags).toEqual([]);
  });

  it('항목이 아닌 값은 버린다', () => {
    const plan = normalizePlan({ items: [null, '공부하기', { type: 'drill' }] }, { date: '2026-09-03' });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].type).toBe('drill');
  });
});

describe('describeToolEvent', () => {
  it('도구 호출을 사람이 읽을 문구로 바꾼다', () => {
    expect(describeToolEvent({ phase: 'tool', tool: 'search_content' })).toBe('교재 내용 검색 중…');
    expect(describeToolEvent({ phase: 'tool', tool: 'get_weak_categories' })).toBe(
      '약점 카테고리 계산 중…'
    );
  });

  it('도구 결과는 성공·실패를 구분한다', () => {
    expect(describeToolEvent({ phase: 'tool_result', tool: 'get_section', ok: true })).toBe(
      '교재 섹션 읽기 완료'
    );
    expect(describeToolEvent({ phase: 'tool_result', tool: 'get_section', ok: false })).toBe(
      '교재 섹션 읽기 실패'
    );
  });

  it('모르는 도구 이름도 문장으로 만든다', () => {
    expect(describeToolEvent({ phase: 'tool', tool: 'brand_new' })).toBe('AI 도구(brand_new) 중…');
  });
});

describe('planItemTitle / planItemLink', () => {
  it('항목 종류마다 제목을 만든다', () => {
    expect(planItemTitle({ type: 'review_wrong', ids: ['042', '077'] })).toBe('오답 복습 · 042, 077');
    expect(planItemTitle({ type: 'study_day', day: 6, section: '결합도/응집도' })).toBe(
      'Day 6 · 결합도/응집도'
    );
    expect(planItemTitle({ type: 'study_day', day: 6 })).toBe('Day 6');
    expect(planItemTitle({ type: 'drill', ids: ['J-03'] })).toBe('드릴 · J-03');
    expect(planItemTitle({ type: '알 수 없음' })).toBe('알 수 없음');
  });

  it('Day 학습은 해당 Day 를 연 학습노트로 이어진다', () => {
    expect(planItemLink({ type: 'study_day', day: 6 })).toEqual({
      to: '/study?day=6',
      label: 'Day 6 학습노트',
    });
  });

  it('Day 가 없고 섹션만 있으면 검색으로 이어진다', () => {
    expect(planItemLink({ type: 'study_day', section: '결합도/응집도' })).toEqual({
      to: `/search?q=${encodeURIComponent('결합도/응집도')}`,
      label: '검색: 결합도/응집도',
    });
  });

  // 문항 딥링크 계약 — `?id=<id>`. 화면 세 곳이 이 파라미터를 읽는다.
  // 계획이 "042 를 복습하라"고 해 놓고 목록의 첫 문항을 여는 것은 계획을 반쯤만
  // 이어 주는 것이다. `ids` 가 비었을 때만 화면 단위로 떨어진다.

  it('오답 복습은 첫 문항을 연 오답노트로 이어진다', () => {
    expect(planItemLink({ type: 'review_wrong', ids: ['042'] })).toEqual({
      to: '/wrong?id=042',
      label: '오답노트',
    });
  });

  it('ids 가 여럿이면 첫 문항만 연다 — 나머지는 그 화면에서 이어 푼다', () => {
    expect(planItemLink({ type: 'review_wrong', ids: ['042', '077'] }).to).toBe('/wrong?id=042');
  });

  it('ids 가 비어 있으면 화면 단위 링크로 떨어진다', () => {
    expect(planItemLink({ type: 'review_wrong', ids: [] })).toEqual({
      to: '/wrong',
      label: '오답노트',
    });
    expect(planItemLink({ type: 'review_wrong' }).to).toBe('/wrong');
    // 빈 문자열은 id 가 아니다 — `?id=` 로 나가면 화면이 빈 값을 찾는다
    expect(planItemLink({ type: 'review_wrong', ids: [''] }).to).toBe('/wrong');
  });

  it('드릴은 출처에 맞는 화면의 그 문항으로 이어진다', () => {
    expect(planItemLink({ type: 'drill', source: 'codedrill', ids: ['C-01'] }).to).toBe(
      '/quiz?id=C-01'
    );
    expect(planItemLink({ type: 'drill', source: 'quiz100', ids: ['042'] }).to).toBe(
      '/flashcard?id=042'
    );
    expect(planItemLink({ type: 'drill', source: 'bogang', ids: ['B07'] }).to).toBe(
      '/flashcard?id=B07'
    );
  });

  it('ids 가 없는 드릴은 예전처럼 화면 단위로 이어진다', () => {
    expect(planItemLink({ type: 'drill', source: 'codedrill' }).to).toBe('/quiz');
    expect(planItemLink({ type: 'drill', source: 'quiz100' }).to).toBe('/flashcard');
    expect(planItemLink({ type: 'drill', source: 'bogang' }).to).toBe('/flashcard');
  });

  it('변형 id 도 그대로 실어 보낸다', () => {
    // 교재에 없는 id 라 화면이 못 찾을 수 있다. 그 처리는 화면 몫이고,
    // 여기서 걸러 버리면 변형을 낸 계획이 영영 첫 문항으로만 이어진다.
    expect(planItemLink({ type: 'drill', source: 'quiz100', ids: ['042-v1'] }).to).toBe(
      '/flashcard?id=042-v1'
    );
    expect(planItemLink({ type: 'review_wrong', ids: ['C-01-v2'] }).to).toBe('/wrong?id=C-01-v2');
  });

  it('id 를 URL 에 안전하게 실어 보낸다', () => {
    // 모델이 낸 값이라 계약 밖 문자가 섞일 수 있다. 그대로 붙이면 쿼리가 갈라진다.
    expect(planItemLink({ type: 'review_wrong', ids: ['a&b=c'] }).to).toBe(
      `/wrong?id=${encodeURIComponent('a&b=c')}`
    );
  });

  it('이어갈 화면을 못 찾으면 null 이다', () => {
    expect(planItemLink({ type: '알 수 없음' })).toBeNull();
    expect(planItemLink({ type: 'drill' })).toBeNull();
    // 출처를 모르면 id 가 있어도 열 화면이 없다
    expect(planItemLink({ type: 'drill', ids: ['C-01'] })).toBeNull();
  });
});

// 스냅샷 계약은 "식별자만 보내고 상세는 서버가 교재에서 다시 찾는다"이다.
// 변형 id 는 교재에 없어 서버가 못 찾는다 — 보내면 근거 없는 계획 항목이 되거나
// 60건 상한을 잡아먹는다. 오답노트 화면에는 그대로 남고, 계획에서만 빠진다.
describe('buildPlanSnapshot — AI 변형 문항', () => {
  it('generated 표시가 있는 오답은 스냅샷에서 뺀다', () => {
    saveProgress('wrong_notes', [codeNote('C-01'), codeNote('C-01-v1', { generated: true })]);
    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.id)).toEqual(['C-01']);
  });

  it('표시가 없어도 변형 id 모양이면 뺀다', () => {
    saveProgress('wrong_notes', [codeNote('C-01'), codeNote('C-02-v3')]);
    expect(buildPlanSnapshot({}).wrongNotes.map((n) => n.id)).toEqual(['C-01']);
  });

  it('quizResults 에서도 변형 id 를 뺀다', () => {
    // 서버 get_weak_categories 는 못 찾는 id 를 그냥 버리지만,
    // 200개 상한을 교재 문항이 아닌 값이 잡아먹는다
    saveProgress('quiz_results', { 'C-01': 'incorrect', 'C-01-v1': 'correct' });
    expect(buildPlanSnapshot({}).quizResults).toEqual({ 'C-01': 'incorrect' });
  });

  it('examResults 에서도 변형 id 를 뺀다', () => {
    // 모의고사는 변형을 켜면 변형 문항도 낸다. 자기 채점은 `exam_results` 에
    // 그대로 쌓이지만(사용자 입력을 버리지 않는다), 교재에 없는 id 는
    // 서버가 근거를 못 찾으므로 스냅샷 경계에서 뺀다 — quizResults 와 같은 규칙이다
    saveProgress('exam_results', { '042': 'incorrect', '042-v1': 'correct' });
    expect(buildPlanSnapshot({}).examResults).toEqual({ '042': 'incorrect' });
  });

  it('변형만 있는 오답노트면 빈 목록을 보낸다', () => {
    saveProgress('wrong_notes', [codeNote('C-01-v1', { generated: true })]);
    expect(buildPlanSnapshot({}).wrongNotes).toEqual([]);
  });
});
