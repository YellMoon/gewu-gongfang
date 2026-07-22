const assert = require('assert');

const { retryTransientNetwork } = require('./oss-upload-retry');

async function main() {
  let attempts = 0;
  const delays = [];
  const result = await retryTransientNetwork(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('socket reset during OSS PUT');
      error.code = 'ECONNRESET';
      throw error;
    }
    return 'uploaded';
  }, {
    retries: 2,
    delayMs: 10,
    sleep: async delay => delays.push(delay),
  });

  assert.strictEqual(result, 'uploaded');
  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(delays, [10, 20]);

  let permanentAttempts = 0;
  await assert.rejects(
    retryTransientNetwork(async () => {
      permanentAttempts += 1;
      const error = new Error('OSS signature rejected');
      error.code = 'SignatureDoesNotMatch';
      throw error;
    }, {
      retries: 2,
      delayMs: 10,
      sleep: async () => {},
    }),
    /OSS signature rejected/
  );
  assert.strictEqual(permanentAttempts, 1);

  console.log('oss upload retry checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
