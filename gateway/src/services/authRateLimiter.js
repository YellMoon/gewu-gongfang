const crypto = require('crypto');

function createAuthRateLimiter({ windowMs = 60000, ipLimit = 60, identityLimit = 5, maxKeys = 5000, now = Date.now } = {}) {
  const buckets = new Map();
  const purge = () => {
    const cutoff = now() - windowMs;
    for (const [key, times] of buckets) {
      const recent = times.filter(time => time > cutoff);
      if (recent.length) buckets.set(key, recent); else buckets.delete(key);
    }
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
  };
  const check = ({ ip, identifier }) => {
    purge();
    const hash = crypto.createHash('sha256').update(String(identifier || '')).digest('hex');
    for (const [key, limit] of [[`ip:${String(ip || '').trim().toLowerCase()}`, ipLimit], [`identity:${hash}`, identityLimit]]) {
      const times = buckets.get(key) || [];
      if (times.length >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] + windowMs - now()) / 1000)) };
      times.push(now()); buckets.set(key, times);
    }
    purge();
    return { allowed: true };
  };
  return { check, purge, size: () => buckets.size };
}

module.exports = { createAuthRateLimiter };
