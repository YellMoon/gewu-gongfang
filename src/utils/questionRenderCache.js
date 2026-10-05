function createBoundedRenderCache(maxEntries = 512, maxChars = 2 * 1024 * 1024) {
  const entries = new Map();
  let chars = 0;
  return (key, render) => {
    if (entries.has(key)) {
      const value = entries.get(key); entries.delete(key); entries.set(key, value); return value;
    }
    const value = render();
    const size = key.length + value.length;
    if (size > maxChars) return value;
    while (entries.size >= maxEntries || chars + size > maxChars) {
      const first = entries.keys().next().value;
      chars -= first.length + entries.get(first).length; entries.delete(first);
    }
    entries.set(key, value); chars += size;
    return value;
  };
}
const cachedQuestionFormula = createBoundedRenderCache();
module.exports = { createBoundedRenderCache, cachedQuestionFormula };
