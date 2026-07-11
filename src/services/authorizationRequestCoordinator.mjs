export function createLatestRequestCoordinator() {
  let latestRequestId = 0;
  return {
    async run(task, handlers = {}) {
      const requestId = ++latestRequestId;
      try {
        const value = await task();
        if (requestId === latestRequestId) handlers.success?.(value);
      } catch (error) {
        if (requestId === latestRequestId) handlers.error?.(error);
      } finally {
        if (requestId === latestRequestId) handlers.settled?.();
      }
    },
  };
}
