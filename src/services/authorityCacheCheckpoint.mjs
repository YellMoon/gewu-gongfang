function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createAuthorityCacheCheckpoint(initialValue) {
  let committedValue = clone(initialValue);

  return Object.freeze({
    commit(value) {
      committedValue = clone(value);
    },
    guard(writeDraft, restore) {
      try {
        return writeDraft();
      } catch (error) {
        restore(clone(committedValue));
        throw error;
      }
    },
    snapshot() {
      return clone(committedValue);
    },
  });
}
