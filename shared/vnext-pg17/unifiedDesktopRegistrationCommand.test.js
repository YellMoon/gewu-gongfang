'use strict';

const assert = require('assert');
const { createUnifiedDesktopRegistrationCommand } = require('./unifiedDesktopRegistrationCommand');

async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}

async function runUnifiedDesktopRegistrationCommandCases() {
  assert.throws(
    () => createUnifiedDesktopRegistrationCommand({}),
    error => error && error.code === 'VNEXT_UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID',
  );
  let received;
  const command = createUnifiedDesktopRegistrationCommand({
    invoke: async request => { received = request; return Object.freeze({ registrationId: 'registration-1', sessionId: request.sessionId }); },
  });
  const input = {
    assertionId: 'assertion-1', idempotencyKey: 'registration-key-1', receiptId: 'receipt-1',
    auditEventId: 'audit-1', outboxEventId: 'outbox-1', sessionId: 'session-1',
    occurredAt: '2026-08-21T00:00:00.000Z',
  };
  assert.deepStrictEqual(await command.execute(input), { registrationId: 'registration-1', sessionId: 'session-1' });
  assert.deepStrictEqual(received, input);
  await expectCode(() => command.execute({ ...input, accountId: 'caller-claimed-account' }), 'VNEXT_UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
}

if (require.main === module) {
  runUnifiedDesktopRegistrationCommandCases().then(() => process.stdout.write('unified desktop registration command checks passed\n')).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runUnifiedDesktopRegistrationCommandCases };
