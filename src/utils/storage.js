const PREFIX = 'jungchogi_';

// 브라우저마다 용량 초과 예외의 name/code 가 다르다.
// 용량 초과만 흡수하고 그 밖의 예외(사생활 보호 모드의 SecurityError 등)는
// 원인을 감추지 않도록 그대로 전파한다.
function isQuotaExceeded(err) {
  return (
    !!err &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  );
}

// 저장 성공 여부를 돌려준다. 용량이 꽉 차도 앱을 죽이지 않는다 —
// 대시보드 "데이터 관리"의 용량 표시가 사용자에게 보이는 경고 경로다.
export function saveProgress(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
    return true;
  } catch (err) {
    if (!isQuotaExceeded(err)) throw err;
    console.warn(
      `[storage] ${PREFIX + key} 저장 실패: localStorage 용량 초과. ` +
        '대시보드 "데이터 관리"에서 내보내기 후 초기화가 필요합니다.',
      err
    );
    return false;
  }
}

export function loadProgress(key, fallback = null) {
  const raw = localStorage.getItem(PREFIX + key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    // 손상된 값을 조용히 삼키면 진행 상황이 소리 없이 사라진 것처럼 보인다.
    // 값 자체는 지우지 않는다 — "데이터 관리 → 내보내기"로 복구할 여지를 남긴다.
    console.warn(
      `[storage] ${PREFIX + key} 값이 손상돼 읽지 못했습니다. 기본값으로 대체합니다.`,
      err
    );
    return fallback;
  }
}

export function clearProgress(key) {
  localStorage.removeItem(PREFIX + key);
}

// ─── 마이그레이션: flashcard_known → flashcard_known_quiz100 ───
(function migrateFlashcardKey() {
  const oldKey = 'jungchogi_flashcard_known';
  const newKey = 'jungchogi_flashcard_known_quiz100';
  if (localStorage.getItem(oldKey) && !localStorage.getItem(newKey)) {
    localStorage.setItem(newKey, localStorage.getItem(oldKey));
  }
})();

// ─── 오답노트 ───

const WRONG_NOTES_KEY = 'wrong_notes';

export function getWrongNotes() {
  return loadProgress(WRONG_NOTES_KEY, []);
}

export function addWrongNote(note) {
  const notes = getWrongNotes();
  // 중복 방지: 같은 source + id 조합이면 업데이트
  const existIdx = notes.findIndex((n) => n.source === note.source && n.id === note.id);
  const entry = {
    ...note,
    addedAt: Date.now(),
    reviewCount: 0,
    mastered: false,
  };
  if (existIdx >= 0) {
    entry.reviewCount = notes[existIdx].reviewCount;
    notes[existIdx] = entry;
  } else {
    notes.push(entry);
  }
  saveProgress(WRONG_NOTES_KEY, notes);
}

export function removeWrongNote(source, id) {
  const notes = getWrongNotes().filter((n) => !(n.source === source && n.id === id));
  saveProgress(WRONG_NOTES_KEY, notes);
}

// 복습 완료 처리 — 타임스탬프는 addWrongNote 의 addedAt 과 마찬가지로 저장 계층이 소유한다
export function markWrongNoteReviewed(source, id) {
  const notes = getWrongNotes().map((n) =>
    n.source === source && n.id === id
      ? { ...n, reviewCount: n.reviewCount + 1, lastReviewed: Date.now() }
      : n
  );
  saveProgress(WRONG_NOTES_KEY, notes);
}

export function clearAllWrongNotes() {
  saveProgress(WRONG_NOTES_KEY, []);
}

// ─── D-Day ───

export function setExamDate(dateStr) {
  saveProgress('exam_date', dateStr);
}

export function getExamDate() {
  return loadProgress('exam_date', null);
}

// ─── 학습 시간 추적 ───

const STUDY_TIME_KEY = 'study_time';

export function getStudyTimeLog() {
  return loadProgress(STUDY_TIME_KEY, {});
}

export function addStudyTime(minutes) {
  const log = getStudyTimeLog();
  const today = new Date().toISOString().slice(0, 10);
  log[today] = (log[today] || 0) + minutes;
  saveProgress(STUDY_TIME_KEY, log);
}

export function getWeeklyStudyTime() {
  const log = getStudyTimeLog();
  const result = [];
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({
      date: key,
      day: dayNames[d.getDay()],
      minutes: log[key] || 0,
    });
  }
  return result;
}

// ─── 간격 반복 (Spaced Repetition) ───

// ─── localStorage 용량 ───

export function getStorageUsage() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(PREFIX)) {
      bytes += key.length * 2 + (localStorage.getItem(key) || '').length * 2;
    }
  }
  return bytes;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function getSpacedRepetitionDue() {
  const notes = getWrongNotes();
  const now = Date.now();
  const intervals = [1, 3, 7]; // 일 단위

  return notes.filter((n) => {
    if (n.mastered) return false;
    const lastTime = n.lastReviewed || n.addedAt;
    if (!lastTime) return true;
    const daysSince = (now - lastTime) / (1000 * 60 * 60 * 24);
    const nextInterval = intervals[Math.min(n.reviewCount, intervals.length - 1)] || 7;
    return daysSince >= nextInterval;
  });
}
