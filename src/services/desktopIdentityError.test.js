const assert = require('assert');

(async () => {
  const { desktopIdentityErrorMessage, extractDesktopIdentityErrorCode } = await import('./desktopIdentityError.mjs');
  const wrapped = new Error("Error invoking remote method 'desktop-identity:unlock': Error: DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED");
  assert.strictEqual(extractDesktopIdentityErrorCode(wrapped), 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
  assert.strictEqual(desktopIdentityErrorMessage(wrapped), '\u672c\u673a\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002');
  const invalidHostKind = new Error(
    "Error invoking remote method 'single-user:bootstrap': Error: DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID"
  );
  assert.strictEqual(
    extractDesktopIdentityErrorCode(invalidHostKind),
    'DESKTOP_IDENTITY_FAILED'
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(invalidHostKind),
    '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002'
  );
  const missingDesktopBridge = new Error('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
  assert.strictEqual(
    desktopIdentityErrorMessage(missingDesktopBridge),
    '\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u684c\u9762\u767b\u5f55\uff0c\u8bf7\u4ece\u683c\u7269\u5de5\u574a\u684c\u9762\u5e94\u7528\u6253\u5f00\u3002'
  );
  const retiredAuthorityErrors = [
    'DESKTOP_REGISTRATION_NOT_APPROVED',
    'PRIMARY_HOST_RUNTIME_ROLE_REQUIRED',
    'PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED',
    'ACTIVE_ROLE_NOT_GRANTED',
  ];
  for (const code of retiredAuthorityErrors) {
    const error = new Error(code);
    assert.strictEqual(extractDesktopIdentityErrorCode(error), 'DESKTOP_IDENTITY_FAILED');
    assert.strictEqual(
      desktopIdentityErrorMessage(error),
      '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002',
      `${code} must not leak retired host or device-approval architecture into desktop login`,
    );
  }
  const missingRelayAssertionSecret = new Error('RELAY_ASSERTION_SECRET_REQUIRED');
  assert.strictEqual(
    desktopIdentityErrorMessage(missingRelayAssertionSecret),
    '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002'
  );
  const wrappedRelayFailure = new Error('DESKTOP_IDENTITY_REQUEST_FAILED');
  wrappedRelayFailure.cause = missingRelayAssertionSecret;
  assert.strictEqual(
    desktopIdentityErrorMessage(wrappedRelayFailure),
    '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002'
  );
  const unknown = desktopIdentityErrorMessage(new Error('Error invoking remote method unlock: C:\\private\\vault'));
  assert.strictEqual(unknown, '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002');
  assert.ok(!unknown.includes('remote method') && !unknown.includes('private'));
  console.log('desktop identity error mapping checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
