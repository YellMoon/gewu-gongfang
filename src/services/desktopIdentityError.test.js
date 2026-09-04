const assert = require('assert');

(async () => {
  const { desktopIdentityErrorMessage, extractDesktopIdentityErrorCode } = await import('./desktopIdentityError.mjs');
  const wrapped = new Error("Error invoking remote method 'desktop-identity:unlock': Error: DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED");
  assert.strictEqual(extractDesktopIdentityErrorCode(wrapped), 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
  assert.strictEqual(desktopIdentityErrorMessage(wrapped), '\u8d26\u53f7\u6216\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002');
  const invalidHostKind = new Error(
    "Error invoking remote method 'single-user:bootstrap': Error: DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID"
  );
  assert.strictEqual(
    extractDesktopIdentityErrorCode(invalidHostKind),
    'DESKTOP_IDENTITY_FAILED'
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(invalidHostKind),
    '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002'
  );
  const missingDesktopBridge = new Error('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
  assert.strictEqual(
    desktopIdentityErrorMessage(missingDesktopBridge),
    '\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u684c\u9762\u767b\u5f55\uff0c\u8bf7\u4ece\u683c\u7269\u5de5\u574a\u684c\u9762\u5e94\u7528\u6253\u5f00\u3002'
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(new Error('CLOUD_DESKTOP_TEACHER_REGISTRATION_REQUIRED')),
    '\u8bf7\u5148\u586b\u5199\u6559\u5e08\u4fe1\u606f\uff0c\u5b8c\u6210\u540e\u5373\u53ef\u8fdb\u5165\u683c\u7269\u5de5\u574a\u3002',
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(new Error('DESKTOP_PHONE_REVERIFICATION_REQUIRED')),
    '\u767b\u5f55\u5df2\u8fc7\u671f\uff0c\u8bf7\u4f7f\u7528\u5fae\u4fe1\u91cd\u65b0\u767b\u5f55\u3002',
    'a login recovery message must not expose device-verification terminology',
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(new Error('PAIRING_API_BASE_REQUIRED')),
    '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002',
    'missing runtime configuration must not expose cloud service setup terminology on the login screen',
  );
  const retiredDeviceErrors = [
    'DESKTOP_DEVICE_NOT_ACTIVE',
    'DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID',
  ];
  for (const code of retiredDeviceErrors) {
    assert.strictEqual(
      desktopIdentityErrorMessage(new Error(code)),
      '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
      `${code} must use a normal login recovery message instead of device internals`,
    );
  }
  for (const code of [
    'VNEXT_DESKTOP_AUTHORIZATION_INVALID',
    'DESKTOP_SESSION_CHALLENGE_EXPIRED',
    'DESKTOP_SESSION_CHALLENGE_REPLAYED',
  ]) {
    assert.strictEqual(
      desktopIdentityErrorMessage(new Error(code)),
      '\u767b\u5f55\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
      `${code} must route the user to normal login without implementation details`,
    );
  }
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
      '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002',
      `${code} must not leak retired host or device-approval architecture into desktop login`,
    );
  }
  const missingRelayAssertionSecret = new Error('RELAY_ASSERTION_SECRET_REQUIRED');
  assert.strictEqual(
    desktopIdentityErrorMessage(missingRelayAssertionSecret),
    '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002'
  );
  const wrappedRelayFailure = new Error('DESKTOP_IDENTITY_REQUEST_FAILED');
  wrappedRelayFailure.cause = missingRelayAssertionSecret;
  assert.strictEqual(
    desktopIdentityErrorMessage(wrappedRelayFailure),
    '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002'
  );
  const unknown = desktopIdentityErrorMessage(new Error('Error invoking remote method unlock: C:\\private\\vault'));
  assert.strictEqual(unknown, '\u767b\u5f55\u9047\u5230\u95ee\u9898\uff0c\u8bf7\u91cd\u8bd5\u3002');
  assert.ok(!unknown.includes('\u8eab\u4efd\u9a8c\u8bc1') && !unknown.includes('\u8bbe\u5907\u6838\u9a8c') && !unknown.includes('\u5f00\u53d1\u8005'));
  assert.ok(!unknown.includes('remote method') && !unknown.includes('private'));
  console.log('desktop identity error mapping checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
