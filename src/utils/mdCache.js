const cache = new Map();

export function fetchMarkdown(file) {
  if (cache.has(file)) {
    return Promise.resolve(cache.get(file));
  }
  return fetch(`/data/${file}`)
    .then((r) => r.text())
    .then((text) => {
      cache.set(file, text);
      return text;
    });
}
