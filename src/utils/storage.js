const PREFIX = 'jungchogi_';

export function saveProgress(key, data) {
  localStorage.setItem(PREFIX + key, JSON.stringify(data));
}

export function loadProgress(key, fallback = null) {
  const raw = localStorage.getItem(PREFIX + key);
  return raw ? JSON.parse(raw) : fallback;
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

export function updateWrongNote(source, id, updates) {
  const notes = getWrongNotes().map((n) =>
    n.source === source && n.id === id ? { ...n, ...updates } : n
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
