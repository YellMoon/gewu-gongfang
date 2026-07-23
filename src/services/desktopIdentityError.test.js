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
    'DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID'
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(invalidHostKind),
    '\u6570\u636e\u4e3b\u673a\u8eab\u4efd\u521d\u59cb\u5316\u53c2\u6570\u5f02\u5e38\uff0c\u672a\u4fee\u6539\u672c\u673a\u6570\u636e\u3002\u8bf7\u66f4\u65b0\u5e94\u7528\u540e\u91cd\u8bd5\u3002'
  );
  const invalidRuntimeRole = new Error(
    "Error invoking remote method 'single-user:bootstrap': Error: PRIMARY_HOST_RUNTIME_ROLE_REQUIRED"
  );
  assert.strictEqual(
    desktopIdentityErrorMessage(invalidRuntimeRole),
    '\u6570\u636e\u4e3b\u673a\u521d\u59cb\u5316\u6d41\u7a0b\u672a\u5b8c\u6210\uff0c\u672a\u4fee\u6539\u672c\u673a\u6570\u636e\u3002\u8bf7\u66f4\u65b0\u5e94\u7528\u540e\u91cd\u8bd5\u3002'
  );
  const unknown = desktopIdentityErrorMessage(new Error('Error invoking remote method unlock: C:\\private\\vault'));
  assert.strictEqual(unknown, '\u8eab\u4efd\u9a8c\u8bc1\u672a\u5b8c\u6210\uff0c\u8bf7\u91cd\u8bd5\u3002');
  assert.ok(!unknown.includes('remote method') && !unknown.includes('private'));
  console.log('desktop identity error mapping checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
