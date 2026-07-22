const assert = require('assert');

(async () => {
  const { desktopIdentityErrorMessage, extractDesktopIdentityErrorCode } = await import('./desktopIdentityError.mjs');
  const wrapped = new Error("Error invoking remote method 'desktop-identity:unlock': Error: DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED");
  assert.strictEqual(extractDesktopIdentityErrorCode(wrapped), 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
  assert.strictEqual(desktopIdentityErrorMessage(wrapped), '\u672c\u673a\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002');
  const unknown = desktopIdentityErrorMessage(new Error('Error invoking remote method unlock: C:\\private\\vault'));
  assert.strictEqual(unknown, '\u8eab\u4efd\u9a8c\u8bc1\u672a\u5b8c\u6210\uff0c\u8bf7\u91cd\u8bd5\u3002');
  assert.ok(!unknown.includes('remote method') && !unknown.includes('private'));
  console.log('desktop identity error mapping checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
