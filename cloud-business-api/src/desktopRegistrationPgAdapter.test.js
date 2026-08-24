'use strict';

const assert = require('assert');
const { createDesktopRegistrationPgAdapter } = require('./desktopRegistrationPgAdapter');

(async () => {
  const calls = [];
  const register = createDesktopRegistrationPgAdapter({
    writerPool: {
      async query(text, values) {
        calls.push({ text, values });
        return {
          rows: [{
            receiptId: 'receipt-1',
            sessionId: 'session-1',
            replayed: false,
          }],
        };
      },
    },
  });

  const input = {
    assertionId: 'assertion-1',
    idempotencyKey: 'retry-1',
    receiptId: 'receipt-1',
    auditEventId: 'audit-1',
    outboxEventId: 'outbox-1',
    sessionId: 'session-1',
    linkId: 'link-1',
    sessionExpiresAt: '2026-08-25T01:00:00.000Z',
    canonicalResultJson: '{"sessionId":"session-1"}',
    resultSha256: 'a'.repeat(64),
    canonicalPayloadJson: '{"sessionId":"session-1"}',
    payloadSha256: 'b'.repeat(64),
  };
  assert.deepStrictEqual(await register(input), {
    receiptId: 'receipt-1',
    sessionId: 'session-1',
    replayed: false,
  });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].values, Object.values(input));

  const missing = createDesktopRegistrationPgAdapter({
    writerPool: { query: async () => ({ rows: [] }) },
  });
  assert.strictEqual(await missing(input), null);

  console.log('desktop registration PostgreSQL adapter checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
