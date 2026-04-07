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
