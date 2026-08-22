# Unified Desktop Password Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a canonical cloud account use either its verified phone or an optional account name plus password to begin an online desktop registration.

**Architecture:** The cloud API derives and verifies scrypt hashes; PostgreSQL stores only versioned salt/hash material behind identity-verifier-only SECURITY DEFINER functions. A successful password check produces the existing five-minute verification token, so device proof and M16 registration remain mandatory.

**Tech Stack:** Node.js crypto scrypt, Express, PostgreSQL 17, existing PG17 manifest/catalog and disposable runtime.

---

### Task 1: Password credential service

**Files:**
- Create: `cloud-business-api/src/desktopPasswordIdentityService.js`
- Create: `cloud-business-api/src/desktopPasswordIdentityService.test.js`

- [ ] **Step 1: Write failing tests for enrollment and phone/name login**

```js
const service = createDesktopPasswordIdentityService({
  scrypt, randomBytes, phoneHash, saveCredential, lookupByPhoneHash, lookupByLoginName,
});
await service.enroll({ verifiedPhone: '13800138000', accountId: 'account-1', authorityId: 'authority-1', loginName: 'teacher.a', password: 'correct horse battery staple' });
assert.strictEqual((await service.verify({ loginType: 'account_name', login: 'teacher.a', password: 'correct horse battery staple' })).accountId, 'account-1');
await assert.rejects(() => service.verify({ loginType: 'phone', login: '13800138000', password: 'wrong password' }), error => error.code === 'CLOUD_DESKTOP_PASSWORD_REJECTED');
```

- [ ] **Step 2: Run the test and confirm it fails because the module is absent.**

Run: `node cloud-business-api/src/desktopPasswordIdentityService.test.js`

- [ ] **Step 3: Implement strict plain-data input handling, fixed scrypt parameters, random salt, constant-time verification, and generic rejection.**

```js
const derived = await scrypt(passwordBytes, salt, 32, { N: 16384, r: 8, p: 1 });
if (!crypto.timingSafeEqual(Buffer.from(row.hash, 'base64'), derived)) throw rejected();
```

- [ ] **Step 4: Run the focused test and `npm --prefix cloud-business-api test`; commit.**

### Task 2: M18 control-plane credential catalog

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.js`
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [ ] **Step 0: Add the exact control-plane prefix-upgrade contract before adding M18.**

The current `catalog.apply()` accepts only a ledger equal to the complete manifest, while production is exactly M1--M17. First write red tests for an exact M1--M17 ledger and clean catalog that appends only M18, and for a forged M17 catalog that fails before any M18 ledger write. Keep fresh apply and already-M18 reapply behavior. Do not run raw production SQL outside this verified upgrade path.

- [ ] **Step 1: Add failing manifest/catalog tests for version 18 and identity-verifier-only credential functions.**

```js
assert.strictEqual(MIGRATIONS.at(-1).semanticVersion, 18);
await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'writer', q => q.query("SELECT * FROM vnext_control_plane.vnext_read_desktop_password_by_login_name('teacher.a')")));
```

- [ ] **Step 2: Run focused tests and confirm the M18 relation/function assertions fail.**

- [ ] **Step 3: Add `vnext_desktop_password_credentials`, append-only guards, and three SECURITY DEFINER functions: set credential, read by phone hash, read by account name.**

```sql
REVOKE ALL ON TABLE vnext_control_plane.vnext_desktop_password_credentials FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_set_desktop_password_credential(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_set_desktop_password_credential(...) TO vnext_pg17_identity_verifier;
```

The set function must lock an active account, replace only the same account credential, increment `auth_version`, and reject invalid scrypt metadata. Read functions return credential material only to `vnext_pg17_identity_verifier` and only for active accounts with verified, non-revoked phone contacts.

- [ ] **Step 4: Run manifest/catalog/disposable focused tests; commit.**

### Task 3: Cloud enrollment and password-verification endpoints

**Files:**
- Modify: `cloud-business-api/server.js`
- Modify: `cloud-business-api/src/app.js`
- Modify: `cloud-business-api/src/app.test.js`
- Modify: `cloud-business-api/src/desktopRegistrationService.js`
- Modify: `cloud-business-api/src/desktopRegistrationService.test.js`

- [ ] **Step 1: Add failing API tests.**

```js
const enrolled = await request(app, '/api/desktop/password-enrollment', { method: 'POST', body: { phoneCode: 'wechat-code', loginName: 'teacher.a', password: 'correct horse battery staple' } });
assert.strictEqual(enrolled.status, 200);
const verified = await request(app, '/api/desktop/password-verification', { method: 'POST', body: { loginType: 'account_name', login: 'teacher.a', password: 'correct horse battery staple' } });
assert.strictEqual(verified.status, 200);
assert.ok(verified.body.verificationToken);
```

- [ ] **Step 2: Run tests and confirm routes return 404 before implementation.**

- [ ] **Step 3: Add endpoints and inject the password service. Enrollment must verify WeChat phone first, provision/resolve the canonical account, set the credential, then call the same verification-token issuer used by phone verification. Password verification must emit the same token without exposing account IDs, salts, or hashes.**

- [ ] **Step 4: Run cloud API tests and disposable M18 tests; commit.**

### Task 4: Unified desktop client entry and release evidence

**Files:**
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityClient.test.js`
- Modify: `src/components/DesktopIdentityGate.*`
- Modify: `public/preload.js`
- Modify: `public/electron.js`

- [ ] **Step 1: Add client tests that password verification only yields the existing pending unified-registration flow and cannot complete offline.**

```js
await client.beginPasswordVerification({ loginType: 'phone', login: '13800138000', password: 'correct horse battery staple' });
assert.strictEqual((await client.status()).state, 'unified_online_registration_pending');
```

- [ ] **Step 2: Run focused client test and confirm the method is absent.**

- [ ] **Step 3: Implement the narrow UI/client call, never persist the cloud password, and pass the returned verification token into existing device-proof registration. Keep local vault password separate.**

- [ ] **Step 4: Run desktop identity tests, cloud API tests, target tests, and package checks. Deploy M18 + cloud API only after catalog proof; then build/upload the miniapp and desktop through a new unified release matrix, obtain 5.6-sol audit, and record per-target receipts.**
