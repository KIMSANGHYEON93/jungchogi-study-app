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
