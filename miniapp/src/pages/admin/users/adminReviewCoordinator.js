function createLatestRequestCoordinator() {
  let generation = 0;
  let loading = false;
  async function run(request, commit, reject, finalize) {
    const requestId = ++generation;
    loading = true;
    try {
      const value = await request();
      if (requestId !== generation) return false;
      commit(value, requestId);
      return true;
    } catch (error) {
      if (requestId !== generation) return false;
      if (reject) reject(error, requestId);
      return false;
    } finally {
      if (requestId === generation) {
        loading = false;
        if (finalize) finalize(requestId);
      }
    }
  }
  return { run, isLoading: () => loading, currentGeneration: () => generation };
}

function createOperationLocks() {
  const locks = new Set();
  async function run(key, operation) {
    if (locks.has(key)) return false;
    locks.add(key);
    try {
      await operation();
      return true;
    } finally {
      locks.delete(key);
    }
  }
  return { run, isLocked: key => locks.has(key) };
}

module.exports = { createLatestRequestCoordinator, createOperationLocks };
