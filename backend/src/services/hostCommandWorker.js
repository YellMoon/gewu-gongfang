function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createHostCommandWorker({
  processOnce,
  intervalMs = 5000,
  retryBaseMs = 5000,
  retryMaxMs = 60000,
  random = Math.random,
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = () => {},
} = {}) {
  if (typeof processOnce !== 'function') throw workerError('HOST_COMMAND_PROCESSOR_REQUIRED');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) throw workerError('HOST_COMMAND_INTERVAL_INVALID');
  if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1000) throw workerError('HOST_COMMAND_RETRY_BASE_INVALID');
  if (!Number.isSafeInteger(retryMaxMs) || retryMaxMs < retryBaseMs) throw workerError('HOST_COMMAND_RETRY_MAX_INVALID');
  let timer = null;
  let inFlight = null;
  let stopped = false;
  const metrics = {
    lastProcessed: 0,
    wakeCount: 0,
    failures: 0,
    lastError: null,
    lastCompletedAt: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
  };
  function timestamp() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }
  function retryDelay() {
    const exponential = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, metrics.consecutiveFailures - 1)));
    const jitter = Math.max(0, Math.min(0.25, Number(random()) || 0));
    return Math.min(retryMaxMs, Math.round(exponential * (1 + jitter)));
  }
  async function wake() {
    if (stopped) return null;
    if (inFlight) return inFlight;
    if (metrics.nextRetryAt !== null && timestamp() < metrics.nextRetryAt) return null;
    metrics.wakeCount += 1;
    inFlight = Promise.resolve(processOnce())
      .then(result => {
        metrics.lastProcessed = Number(result?.processed || 0);
        metrics.lastError = null;
        metrics.lastCompletedAt = new Date().toISOString();
        metrics.consecutiveFailures = 0;
        metrics.nextRetryAt = null;
        return result;
      })
      .catch(error => {
        metrics.failures += 1;
        metrics.lastError = error?.code || error?.message || 'HOST_COMMAND_PROCESSING_FAILED';
        metrics.consecutiveFailures += 1;
        metrics.nextRetryAt = timestamp() + retryDelay();
        log(`Host command worker failed: ${metrics.lastError}`);
        return null;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }
  return Object.freeze({
    start() {
      if (stopped || timer) return;
      timer = setIntervalImpl(() => { void wake(); }, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
    },
    wake,
    status() {
      return Object.freeze({
        lastProcessed: metrics.lastProcessed,
        wakeCount: metrics.wakeCount,
        failures: metrics.failures,
        lastError: metrics.lastError,
        lastCompletedAt: metrics.lastCompletedAt,
        running: Boolean(timer),
        inFlight: Boolean(inFlight),
        retry: Object.freeze({
          consecutiveFailures: metrics.consecutiveFailures,
          nextRetryAt: metrics.nextRetryAt,
          lastError: metrics.lastError,
        }),
      });
    },
  });
}

module.exports = { createHostCommandWorker, workerError };
