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
  const invalidRuntimeRole = new Error(
    "Error invoking remote method 'single-user:bootstrap': Error: PRIMARY_HOST_RUNTIME_ROLE_REQUIRED"
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(invalidRuntimeRole),
    '\u6570\u636e\u4e3b\u673a\u521d\u59cb\u5316\u6d41\u7a0b\u672a\u5b8c\u6210\uff0c\u672a\u4fee\u6539\u672c\u673a\u6570\u636e\u3002\u8bf7\u66f4\u65b0\u5e94\u7528\u540e\u91cd\u8bd5\u3002'
  );
  const missingQuestionBankBinding = new Error('PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED');
  assert.strictEqual(
    desktopIdentityErrorMessage(missingQuestionBankBinding),
    '\u8bf7\u5148\u5728\u6570\u636e\u4e3b\u673a\u4e0a\u8fde\u63a5\u5e76\u7ed1\u5b9a\u9898\u5e93\u79fb\u52a8\u786c\u76d8\uff0c\u518d\u5b8c\u6210\u8eab\u4efd\u521d\u59cb\u5316\u3002'
  );
  const authorityMigrationMissing = new Error('ACTIVE_ROLE_NOT_GRANTED');
  assert.strictEqual(
    desktopIdentityErrorMessage(authorityMigrationMissing),
    '\u672c\u673a\u5bc6\u7801\u5df2\u901a\u8fc7\uff0c\u4f46\u8d26\u6237\u6743\u9650\u6570\u636e\u5c1a\u672a\u5b8c\u6210\u8fc1\u79fb\u3002\u8bf7\u66f4\u65b0\u540e\u91cd\u8bd5\u3002'
  );
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
