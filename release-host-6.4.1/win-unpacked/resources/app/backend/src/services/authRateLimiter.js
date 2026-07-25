function configError(message) {
  const error = new Error(message);
  error.code = 'AUTH_RATE_LIMIT_CONFIG_INVALID';
  return error;
}

function createAuthRateLimiter({ maxAttempts = 10, windowMs = 60_000, now = Date.now } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw configError('maxAttempts must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs < 1) throw configError('windowMs must be positive');
  if (typeof now !== 'function') throw configError('now must be a function');

  const entries = new Map();

  function consume(rawKey) {
    const key = String(rawKey || 'unknown');
    const currentTime = Number(now());
    let entry = entries.get(key);
    if (!entry || currentTime >= entry.resetAt) {
      entry = { count: 0, resetAt: currentTime + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, entry.resetAt - currentTime),
      };
    }
    entry.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - entry.count),
      retryAfterMs: 0,
    };
  }

  function reset(rawKey) {
    entries.delete(String(rawKey || 'unknown'));
  }

  function prune() {
    const currentTime = Number(now());
    for (const [key, entry] of entries) {
      if (currentTime >= entry.resetAt) entries.delete(key);
    }
    return entries.size;
  }

  return { consume, prune, reset };
}

module.exports = { createAuthRateLimiter };
