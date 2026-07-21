const assert = require('assert');
const { createAuthRateLimiter } = require('./authRateLimiter');

let clock = 1_000;
const limiter = createAuthRateLimiter({
  maxAttempts: 2,
  windowMs: 5_000,
  now: () => clock,
});

assert.deepStrictEqual(limiter.consume('client-a'), {
  allowed: true,
  remaining: 1,
  retryAfterMs: 0,
});
assert.deepStrictEqual(limiter.consume('client-a'), {
  allowed: true,
  remaining: 0,
  retryAfterMs: 0,
});
assert.deepStrictEqual(limiter.consume('client-a'), {
  allowed: false,
  remaining: 0,
  retryAfterMs: 5_000,
});
assert.strictEqual(limiter.consume('client-b').allowed, true, 'keys must be isolated');

clock += 5_001;
assert.strictEqual(limiter.consume('client-a').allowed, true, 'window expiry should allow a new attempt');
limiter.reset('client-a');
assert.strictEqual(limiter.consume('client-a').remaining, 1, 'reset should remove only the requested key');

assert.throws(
  () => createAuthRateLimiter({ maxAttempts: 0 }),
  error => error?.code === 'AUTH_RATE_LIMIT_CONFIG_INVALID',
);
console.log('auth rate limiter checks passed');
