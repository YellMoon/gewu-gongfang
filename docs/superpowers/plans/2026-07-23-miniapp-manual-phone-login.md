# Miniapp Manual Phone Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unavailable WeChat phone-number button with manual phone entry while preserving verified-phone compatibility and requiring super-admin review before a new WeChat account can bind an existing user.

**Architecture:** Add a dedicated binding-request table, service, and review route. Keep `loginWithVerifiedWechat` for legacy `phoneCode` calls and add `loginWithClaimedWechat` for untrusted manual input. The miniapp submits a fresh `Taro.login()` code plus the typed phone and exposes pending binding reviews in the existing admin user page.

**Tech Stack:** Node.js, Express, better-sqlite3, JWT, React/Taro, TypeScript, WeChat Mini Program CI, Electron Builder, Alibaba Cloud OSS.

---

## File map

- Create `backend/src/services/miniappWechatBindingService.js` for request, list, approve, reject, masking, and audit behavior.
- Create `backend/src/services/miniappWechatBindingService.test.js` for transaction, conflict, idempotency, and permission tests.
- Create `backend/src/routes/miniappWechatBindings.js` and `backend/src/routes/miniappWechatBindings.http.test.js` for review APIs.
- Create `miniapp/src/pages/login/manualPhoneLoginRuntime.js` and its test for phone validation and user-facing error mapping.
- Modify `backend/src/schema.sql`, identity service and tests, auth route and HTTP tests, privacy retention and tests, `backend/src/app.js`, and root test scripts.
- Modify the miniapp login page, admin user page, API client, account application copy, privacy copy, UI inventory, and UI coverage tests.
- Update `task.md` and `docs/reports/2026-07-23-unified-completion-audit.md` with implementation and release evidence.

### Task 1: Add the binding-request schema

**Files:**
- Modify: `backend/src/schema.sql:291-330`
- Modify: `backend/src/schema.sql:1275-1290`
- Modify: `backend/src/miniappIdentitySchema.test.js:25-90`

- [ ] **Step 1: Write the failing schema assertions**

Add `miniapp_wechat_binding_requests` to the table list and assert these columns and indexes:

```js
const bindingColumns = columns('miniapp_wechat_binding_requests');
for (const column of [
  'id', 'target_user_id', 'phone_normalized', 'candidate_openid',
  'candidate_unionid', 'status', 'revision', 'reviewed_by',
  'review_note', 'created_at', 'updated_at', 'resolved_at',
]) {
  assert.ok(bindingColumns.has(column), `binding requests should include ${column}`);
}
for (const indexName of [
  'idx_miniapp_wechat_binding_active_openid',
  'idx_miniapp_wechat_binding_active_user',
  'idx_miniapp_wechat_binding_status_created',
]) {
  assert.ok(service.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?"
  ).get(indexName), `${indexName} should exist`);
}
```

- [ ] **Step 2: Run the test and observe the missing table**

Run: `node backend/src/miniappIdentitySchema.test.js`

Expected: FAIL because `miniapp_wechat_binding_requests` does not exist.

- [ ] **Step 3: Add the table and indexes**

```sql
CREATE TABLE IF NOT EXISTS miniapp_wechat_binding_requests (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  candidate_openid TEXT NOT NULL,
  candidate_unionid TEXT,
  status TEXT NOT NULL CHECK(status IN ('submitted', 'approved', 'rejected', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_active_openid
  ON miniapp_wechat_binding_requests(candidate_openid) WHERE status='submitted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_active_user
  ON miniapp_wechat_binding_requests(target_user_id) WHERE status='submitted';
CREATE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_status_created
  ON miniapp_wechat_binding_requests(status, created_at);
```

- [ ] **Step 4: Run and commit**

Run: `node backend/src/miniappIdentitySchema.test.js`

Expected: PASS.

```powershell
git add -- backend/src/schema.sql backend/src/miniappIdentitySchema.test.js
git commit -m "feat: add miniapp wechat binding request schema"
```

### Task 2: Implement the binding-request service

**Files:**
- Create: `backend/src/services/miniappWechatBindingService.js`
- Create: `backend/src/services/miniappWechatBindingService.test.js`

- [ ] **Step 1: Write failing transaction and permission tests**

```js
const first = service.requestBinding({
  targetUserId: 'formal-user',
  phone: '13800138000',
  openid: 'openid-new',
  unionid: 'unionid-new',
});
assert.deepStrictEqual(
  [first.status, first.revision, first.phoneMasked],
  ['submitted', 1, '138****8000'],
);
assert.strictEqual(service.requestBinding({
  targetUserId: 'formal-user',
  phone: '13800138000',
  openid: 'openid-new',
}).id, first.id);
assert.throws(
  () => service.approve({ actor: normalAdmin, requestId: first.id, expectedRevision: 1 }),
  error => error.code === 'WECHAT_BINDING_REVIEW_FORBIDDEN',
);
const approved = service.approve({
  actor: superAdmin,
  requestId: first.id,
  expectedRevision: 1,
});
assert.strictEqual(approved.status, 'approved');
assert.strictEqual(
  db.prepare("SELECT wechat_openid FROM users WHERE id='formal-user'").get().wechat_openid,
  'openid-new',
);
```

The same test file must cover active-openid conflicts, active-target conflicts, changed target phone, occupied openid, stale revision, repeated approval, rejection audit, and the absence of a full phone in list results.

- [ ] **Step 2: Run and observe the missing module**

Run: `node backend/src/services/miniappWechatBindingService.test.js`

Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement the focused service**

```js
function bindingError(code, statusCode = 400, details) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function maskPhone(phone) {
  const value = String(phone || '');
  return /^1\d{10}$/.test(value)
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : '';
}

function createMiniappWechatBindingService({
  db, now = () => new Date(), uuid = uuidv4,
} = {}) {
  return { requestBinding, list, approve, reject };
}
```

`requestBinding` must re-read the target and openid owner inside a transaction. An identical active request returns the same row; any other unique collision throws `WECHAT_BINDING_REQUEST_CONFLICT`.

`approve` must call `canReviewUsers(actor)` and perform this conditional update before completing the request and inserting `approve_wechat_binding` into `authorization_audit_log`:

```sql
UPDATE users
SET wechat_openid=?, wechat_unionid=COALESCE(wechat_unionid, ?),
    auth_version=auth_version+1, updated_at=?
WHERE id=? AND deleted=0 AND phone_normalized=? AND wechat_openid IS NULL
```

`reject` must complete the request and insert `reject_wechat_binding`.

- [ ] **Step 4: Run and commit**

Run: `node backend/src/services/miniappWechatBindingService.test.js`

Expected: PASS.

```powershell
git add -- backend/src/services/miniappWechatBindingService.js backend/src/services/miniappWechatBindingService.test.js
git commit -m "feat: add reviewed miniapp wechat binding service"
```

### Task 3: Add the claimed-phone identity state machine

**Files:**
- Modify: `backend/src/services/miniappIdentityService.js:45-360`
- Modify: `backend/src/services/miniappIdentityService.test.js`

- [ ] **Step 1: Write failing claimed-phone tests**

```js
const fresh = identity.loginWithClaimedWechat({
  openid: 'openid-fresh',
  phone: '13900139000',
});
assert.strictEqual(fresh.user.account_state, 'unrecognized');
assert.throws(
  () => identity.loginWithClaimedWechat({
    openid: 'openid-formal-candidate',
    phone: '13800138000',
  }),
  error => error.code === 'WECHAT_BINDING_REVIEW_REQUIRED'
    && error.details.requestId,
);
assert.throws(
  () => identity.loginWithClaimedWechat({
    openid: 'openid-fresh',
    phone: '13900139001',
  }),
  error => error.code === 'OPENID_PHONE_BINDING_CONFLICT',
);
```

Keep the existing trusted `loginWithVerifiedWechat` tests unchanged.

- [ ] **Step 2: Run and observe the missing method**

Run: `node backend/src/services/miniappIdentityService.test.js`

Expected: FAIL because `loginWithClaimedWechat` is undefined.

- [ ] **Step 3: Implement the state machine**

```js
function loginWithClaimedWechat(input = {}) {
  const phone = normalizePhone(input.phone);
  const openid = String(input.openid || '').trim();
  if (!phone) throw serviceError('MANUAL_PHONE_REQUIRED');
  if (!/^1\d{10}$/.test(phone)) throw serviceError('MANUAL_PHONE_INVALID');
  if (!openid) throw serviceError('WECHAT_IDENTITY_REQUIRED');

  const openidOwner = findByOpenid.get(openid);
  if (openidOwner) {
    if (normalizePhone(openidOwner.phone_normalized || openidOwner.phone) !== phone) {
      writeEvent({ user: openidOwner, phone, resultCode: 'OPENID_PHONE_BINDING_CONFLICT' });
      throw serviceError('OPENID_PHONE_BINDING_CONFLICT');
    }
    return issueLoginForBoundUser(openidOwner, { ...input, phone, openid });
  }

  const phoneOwner = findByPhone.get(phone);
  if (phoneOwner?.wechat_openid) {
    writeEvent({ user: phoneOwner, phone, resultCode: 'PHONE_WECHAT_BINDING_CONFLICT' });
    throw serviceError('PHONE_WECHAT_BINDING_CONFLICT');
  }
  if (phoneOwner) {
    const request = bindingService.requestBinding({
      targetUserId: phoneOwner.id,
      phone,
      openid,
      unionid: input.unionid,
    });
    throw serviceError('WECHAT_BINDING_REVIEW_REQUIRED', {
      requestId: request.id,
      status: request.status,
    });
  }
  return createAndLoginUnrecognizedUser({ ...input, phone, openid });
}
```

Extract `issueLoginForBoundUser` and `createAndLoginUnrecognizedUser` from the current transaction without changing JWT claims, audiences, `auth_version`, or unrecognized capabilities. Extend `serviceError` with an optional `details` object.

- [ ] **Step 4: Run and commit**

Run: `node backend/src/services/miniappWechatBindingService.test.js && node backend/src/services/miniappIdentityService.test.js`

Expected: both PASS.

```powershell
git add -- backend/src/services/miniappIdentityService.js backend/src/services/miniappIdentityService.test.js
git commit -m "feat: add claimed phone miniapp identity flow"
```

### Task 4: Add the dual HTTP login contract

**Files:**
- Modify: `backend/src/routes/auth.js:45-115`
- Modify: `backend/src/miniappPhoneLogin.test.js`

- [ ] **Step 1: Add failing manual, legacy, and mismatch tests**

```js
const manualFresh = await postJson(baseUrl, {
  code: 'login-code-manual-fresh',
  phone: '13600136000',
});
assert.strictEqual(manualFresh.status, 200);
assert.strictEqual(manualFresh.body.data.user.account_state, 'unrecognized');

const manualFormal = await postJson(baseUrl, {
  code: 'login-code-manual-formal',
  phone: '13732250653',
});
assert.strictEqual(manualFormal.status, 202);
assert.strictEqual(manualFormal.body.code, 'WECHAT_BINDING_REVIEW_REQUIRED');

const mismatch = await postJson(baseUrl, {
  code: 'login-code-repeat',
  phone: '13900000000',
  phoneCode: 'phone-code-admin',
});
assert.strictEqual(mismatch.status, 409);
assert.strictEqual(mismatch.body.code, 'WECHAT_PHONE_MISMATCH');
```

The WeChat mock must return stable distinct openids for the new login codes.

- [ ] **Step 2: Run and observe the old rejection**

Run: `node backend/src/miniappPhoneLogin.test.js`

Expected: FAIL because manual phone is rejected by the old phone-code rule.

- [ ] **Step 3: Implement compatible routing**

```js
const { code, phone, phoneCode, userInfo, miniappVersion, platform } = req.body || {};
const { openid, unionid } = await resolveWechatIdentity(code);
let login;
if (phoneCode) {
  const verifiedPhone = await resolveWechatPhoneNumber(phoneCode);
  const claimedPhone = normalizePhone(phone);
  if (claimedPhone && claimedPhone !== normalizePhone(verifiedPhone)) {
    const error = new Error('WECHAT_PHONE_MISMATCH');
    error.code = 'WECHAT_PHONE_MISMATCH';
    throw error;
  }
  login = identityServiceFor(db).loginWithVerifiedWechat({
    openid, unionid, phone: verifiedPhone, profile, miniappVersion, platform,
  });
} else {
  login = identityServiceFor(db).loginWithClaimedWechat({
    openid, unionid, phone, profile, miniappVersion, platform,
  });
}
```

Map binding review to HTTP 202 with `err.details`, manual validation to 400, identity conflicts and phone mismatch to 409, disabled login to 403, and WeChat exchange failures to 502.

- [ ] **Step 4: Run and commit**

Run: `node backend/src/miniappPhoneLogin.test.js && npm run test:miniapp-identity`

Expected: all PASS.

```powershell
git add -- backend/src/routes/auth.js backend/src/miniappPhoneLogin.test.js
git commit -m "feat: accept manual phone miniapp login"
```

### Task 5: Add binding-review HTTP APIs

**Files:**
- Create: `backend/src/routes/miniappWechatBindings.js`
- Create: `backend/src/routes/miniappWechatBindings.http.test.js`
- Modify: `backend/src/app.js:28-43`
- Modify: `backend/src/app.js:338-341`
- Modify: `package.json`

- [ ] **Step 1: Write failing HTTP tests**

```js
const list = await requestJson(baseUrl, 'GET',
  '/api/miniapp/wechat-bindings/admin?status=submitted',
  { token: tokenFor('ordinary-admin') });
assert.strictEqual(list.status, 200);
assert.strictEqual(list.body.data.items[0].phoneMasked, '138****8000');
assert.ok(!JSON.stringify(list.body).includes('13800138000'));

const forbidden = await requestJson(baseUrl, 'POST',
  `/api/miniapp/wechat-bindings/${requestId}/approve`,
  { token: tokenFor('ordinary-admin'), body: { expectedRevision: 1 } });
assert.strictEqual(forbidden.status, 403);

const approved = await requestJson(baseUrl, 'POST',
  `/api/miniapp/wechat-bindings/${requestId}/approve`,
  { token: tokenFor('miniapp-admin-13732250653'), body: { expectedRevision: 1 } });
assert.strictEqual(approved.status, 200);
```

Also cover no token, teacher token, reject, stale revision, and unknown request.

- [ ] **Step 2: Run and observe 404**

Run: `node backend/src/routes/miniappWechatBindings.http.test.js`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement and mount**

```js
router.get('/admin', requireApplicationReviewer, listHandler);
router.post('/:id/approve', requireSuperAdmin, approveHandler);
router.post('/:id/reject', requireSuperAdmin, rejectHandler);
```

Use `canReviewApplications` for list access. Mutations require both `canReviewUsers(req.user)` and `req.authz.role === 'super_admin'`.

```js
app.use('/api/miniapp/wechat-bindings',
  authMiddleware, miniappWechatBindingsRouter);
```

Add the service and HTTP tests to `test:miniapp-identity`.

- [ ] **Step 4: Run and commit**

Run: `node backend/src/routes/miniappWechatBindings.http.test.js && npm run test:miniapp-identity`

Expected: all PASS.

```powershell
git add -- backend/src/routes/miniappWechatBindings.js backend/src/routes/miniappWechatBindings.http.test.js backend/src/app.js package.json
git commit -m "feat: add miniapp wechat binding review api"
```

### Task 6: Add privacy retention for completed requests

**Files:**
- Modify: `backend/src/services/miniappPrivacyRetention.js`
- Modify: `backend/src/services/miniappPrivacyRetention.test.js`

- [ ] **Step 1: Write the failing retention test**

```js
const result = runMiniappPrivacyRetention(
  db, new Date('2026-07-23T00:00:00.000Z'));
assert.strictEqual(result.bindingRequestsRedacted, 1);
assert.deepStrictEqual(db.prepare(
  "SELECT phone_normalized, candidate_openid, candidate_unionid, review_note FROM miniapp_wechat_binding_requests WHERE id='old-binding'"
).get(), {
  phone_normalized: '[redacted]',
  candidate_openid: '[redacted]',
  candidate_unionid: null,
  review_note: null,
});
```

Also assert that a recent `submitted` request remains unchanged.

- [ ] **Step 2: Run and observe the missing result**

Run: `node backend/src/services/miniappPrivacyRetention.test.js`

Expected: FAIL because `bindingRequestsRedacted` does not exist.

- [ ] **Step 3: Redact old terminal requests**

```js
const redactBindingRequests = db.prepare(`
  UPDATE miniapp_wechat_binding_requests
  SET phone_normalized=?, candidate_openid=?,
      candidate_unionid=NULL, review_note=NULL
  WHERE status IN ('approved','rejected','expired') AND updated_at < ?
    AND (phone_normalized<>? OR candidate_openid<>?
      OR candidate_unionid IS NOT NULL OR review_note IS NOT NULL)`);
```

Return its changed-row count as `bindingRequestsRedacted`.

- [ ] **Step 4: Run and commit**

Run: `node backend/src/services/miniappPrivacyRetention.test.js && node backend/src/miniappIdentitySchema.test.js`

Expected: both PASS.

```powershell
git add -- backend/src/services/miniappPrivacyRetention.js backend/src/services/miniappPrivacyRetention.test.js
git commit -m "feat: retain and redact wechat binding reviews"
```

### Task 7: Replace the miniapp login button

**Files:**
- Create: `miniapp/src/pages/login/manualPhoneLoginRuntime.js`
- Create: `miniapp/src/pages/login/manualPhoneLoginRuntime.test.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/login/index.scss`
- Modify: `miniapp/src/utils/miniappPhoneLogin.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing runtime and source tests**

```js
assert.strictEqual(normalizeManualPhone(' 138 0013 8000 '), '13800138000');
assert.strictEqual(validateManualPhone(''), 'MANUAL_PHONE_REQUIRED');
assert.strictEqual(validateManualPhone('23800138000'), 'MANUAL_PHONE_INVALID');
assert.strictEqual(validateManualPhone('13800138000'), '');
assert.strictEqual(
  manualPhoneLoginErrorMessage('WECHAT_BINDING_REVIEW_REQUIRED'),
  '\u5fae\u4fe1\u8d26\u53f7\u7ed1\u5b9a\u7533\u8bf7\u5df2\u63d0\u4ea4\uff0c\u7ba1\u7406\u5458\u786e\u8ba4\u540e\u8bf7\u91cd\u65b0\u767b\u5f55',
);
```

The source test must require `Input`, `type='number'`, `maxlength={11}`, a `phone` request, and `onClick`, while forbidding `openType="getPhoneNumber"`, `onGetPhoneNumber`, and `phoneCode`.

- [ ] **Step 2: Run and observe failures**

Run: `node miniapp/src/pages/login/manualPhoneLoginRuntime.test.js && node miniapp/src/utils/miniappPhoneLogin.test.js`

Expected: FAIL because the runtime is absent and the old button remains.

- [ ] **Step 3: Implement the pure runtime**

```js
function normalizeManualPhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}
function validateManualPhone(value) {
  const phone = normalizeManualPhone(value);
  if (!phone) return 'MANUAL_PHONE_REQUIRED';
  return /^1\d{10}$/.test(phone) ? '' : 'MANUAL_PHONE_INVALID';
}
function manualPhoneLoginErrorMessage(code, fallback) {
  const messages = {
    MANUAL_PHONE_REQUIRED: '\u8bf7\u8f93\u5165\u624b\u673a\u53f7',
    MANUAL_PHONE_INVALID: '\u8bf7\u8f93\u5165\u6b63\u786e\u768411\u4f4d\u624b\u673a\u53f7',
    WECHAT_BINDING_REVIEW_REQUIRED: '\u5fae\u4fe1\u8d26\u53f7\u7ed1\u5b9a\u7533\u8bf7\u5df2\u63d0\u4ea4\uff0c\u7ba1\u7406\u5458\u786e\u8ba4\u540e\u8bf7\u91cd\u65b0\u767b\u5f55',
    PHONE_WECHAT_BINDING_CONFLICT: '\u8be5\u624b\u673a\u53f7\u5df2\u7ed1\u5b9a\u5176\u4ed6\u5fae\u4fe1\u8d26\u53f7\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u5904\u7406\u6362\u7ed1',
    OPENID_PHONE_BINDING_CONFLICT: '\u5f53\u524d\u5fae\u4fe1\u5df2\u7ed1\u5b9a\u5176\u4ed6\u624b\u673a\u53f7\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u6838\u9a8c',
    WECHAT_PHONE_MISMATCH: '\u586b\u5199\u624b\u673a\u53f7\u4e0e\u5fae\u4fe1\u6388\u6743\u624b\u673a\u53f7\u4e0d\u4e00\u81f4',
    MINIAPP_LOGIN_DISABLED: '\u8be5\u8d26\u53f7\u5df2\u505c\u7528\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458',
    AUTH_RATE_LIMITED: '\u64cd\u4f5c\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
  };
  return messages[String(code || '')] || fallback || '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
}
module.exports = {
  manualPhoneLoginErrorMessage, normalizeManualPhone, validateManualPhone,
};
```

- [ ] **Step 4: Update the component and styles**

Add `phone` state, validate before `Taro.login()`, and submit:

```tsx
const response = await loginBoundary.run(() =>
  api.post('/api/auth/wechat-login', { code, phone: normalizedPhone }));
```

Replace the old button with an 11-digit numeric `Input` and a normal `Button onClick={handlePhoneLogin}`. Preserve the busy lock, auth boundary, and session committer. Never persist the phone in Taro storage. Add a white 82rpx input with an 18rpx radius and spacing before the button.

- [ ] **Step 5: Run and commit**

Run: `node miniapp/src/pages/login/manualPhoneLoginRuntime.test.js && node miniapp/src/utils/miniappPhoneLogin.test.js && npm --prefix miniapp run typecheck && npm --prefix miniapp run build:weapp`

Expected: all PASS.

```powershell
git add -- miniapp/src/pages/login/manualPhoneLoginRuntime.js miniapp/src/pages/login/manualPhoneLoginRuntime.test.js miniapp/src/pages/login/index.tsx miniapp/src/pages/login/index.scss miniapp/src/utils/miniappPhoneLogin.test.js package.json
git commit -m "feat: add manual phone miniapp login ui"
```

### Task 8: Add admin review UI and truthful copy

**Files:**
- Modify: `miniapp/src/utils/api.ts:258-272`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/pages/account-application/index.tsx`
- Modify: `miniapp/src/pages/login/privacy.tsx`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `miniapp/src/utils/miniappUiCoverage.test.js`

- [ ] **Step 1: Write failing UI coverage assertions**

Require calls to `adminApi.getWechatBindingRequests`, `approveWechatBinding`, and `rejectWechatBinding`. Require the account application and privacy pages to describe a manually entered phone, and forbid the old verified-phone claim. Require `manual-phone-entry` in the UI inventory and forbid `verified-phone-binding` for the login page.

- [ ] **Step 2: Run and observe failures**

Run: `node miniapp/src/utils/miniappUiCoverage.test.js`

Expected: FAIL because the API, review UI, and copy do not exist.

- [ ] **Step 3: Add admin API methods**

```ts
getWechatBindingRequests: (status = 'submitted') =>
  api.get<any>(`/api/miniapp/wechat-bindings/admin?status=${encodeURIComponent(status)}`),
approveWechatBinding: (requestId: string, expectedRevision: number) =>
  api.post<any>(`/api/miniapp/wechat-bindings/${encodeURIComponent(requestId)}/approve`,
    { expectedRevision }),
rejectWechatBinding: (requestId: string, expectedRevision: number, reason = '') =>
  api.post<any>(`/api/miniapp/wechat-bindings/${encodeURIComponent(requestId)}/reject`,
    { expectedRevision, reason }),
```

- [ ] **Step 4: Add the review cards**

Load users and binding requests with `Promise.all`. Display only `targetName`, `phoneMasked`, and `createdAt`. Use the existing `runLocked` guard. Ordinary admins can read; only users with `users:review` see approve/reject buttons. Approval must show a second confirmation naming the target account and warning that existing sessions are revoked.

- [ ] **Step 5: Update copy and page inventory**

Change the application phone label to the equivalent of "phone entered at login" and explain that admins compare it with application data. Explain in privacy copy that the phone is manually entered and not proof of ownership.

Set login inventory states to:

```js
verificationStates: [
  'wechat-login', 'manual-phone-entry', 'binding-review-pending', 'loading',
],
realFeatureBasis: [
  'api.post(/api/auth/wechat-login)',
  'manual phone Input',
  'WECHAT_BINDING_REVIEW_REQUIRED',
  'auth_token storage for successful users only',
],
```

Add `wechat-binding-review` to the admin page.

- [ ] **Step 6: Run and commit**

Run: `node miniapp/src/utils/miniappUiCoverage.test.js && npm --prefix miniapp run typecheck && npm run miniapp:release-check`

Expected: all PASS.

```powershell
git add -- miniapp/src/utils/api.ts miniapp/src/pages/admin/users/index.tsx miniapp/src/pages/admin/users/index.scss miniapp/src/pages/account-application/index.tsx miniapp/src/pages/login/privacy.tsx miniapp/src/utils/miniappUiPageInventory.js miniapp/src/utils/miniappUiCoverage.test.js
git commit -m "feat: add miniapp wechat binding review ui"
```

### Task 9: Run full regression and commit the reviewed implementation

**Files:**
- Modify: `task.md`
- Modify: `docs/reports/2026-07-23-unified-completion-audit.md`

- [ ] **Step 1: Run feature suites**

```powershell
npm run test:miniapp-identity-schema
npm run test:miniapp-identity
npm run test:miniapp-applications
npm run test:desktop-authorization
node backend/src/miniappPhoneLogin.test.js
node backend/src/services/miniappPrivacyRetention.test.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run full verification**

```powershell
npm test
npm run typecheck
npm run build
npm --prefix miniapp run ci:weapp
git diff --check
```

Expected: every command exits 0 and `git diff --check` is empty.

- [ ] **Step 3: Update audit records and scan for secrets**

Record manual login, legacy compatibility, binding review, privacy retention, test, typecheck, and build evidence. Run:

```powershell
rg -n "BEGIN (RSA|OPENSSH) PRIVATE KEY|BACKEND_JWT_SECRET=" backend/src miniapp/src docs task.md
git status --short
```

Expected: no real secret or JWT is present; user-owned untracked files remain untouched.

- [ ] **Step 4: Commit all reviewed tracked work**

```powershell
git add -u
git add -- backend/src/services/cloudRelayHostAuth.js backend/src/services/cloudRelayHostAuth.test.js public/desktopIdentityKind.js public/desktopIdentityKind.test.js
$releaseMessage = -join @([char]0x81EA,[char]0x52A8,[char]0x53D1,[char]0x5E03,' ','2026-07-23')
git commit -m $releaseMessage
```

Do not stage `.codex-task-handoff/`, `.playwright-cli/`, `dist-host/`, `output/`, or `scripts/inspect-paper-template.py`.

### Task 10: Unified release, host upgrade, and Quark delivery

**Files:**
- Modify: `task.md`
- Modify: `docs/reports/2026-07-23-unified-completion-audit.md`

- [ ] **Step 1: Push the formal branch**

Run: `git push gewu HEAD:master`

Expected: `gewu/master` points to the complete implementation.

- [ ] **Step 2: Back up and deploy the cloud backend**

```powershell
python scripts/deploy.py check
python scripts/deploy.py rollback-plan
python scripts/deploy.py deploy
python scripts/deploy.py migrate
node scripts/check_cloud_relay.js
node scripts/check_cloud_relay_host.js
node scripts/check_deploy_readiness.js
```

Expected: production SSH fingerprint verification, code/database backup, PM2 restart, migration, and public health checks all pass.

- [ ] **Step 3: Build and upload the miniapp**

Run: `npm run miniapp:upload`

Expected: CI or DevTools reports `success: true` and the current version. If the platform blocks upload, retain the raw error and mark the matrix partially released.

- [ ] **Step 4: Package both desktop flavors**

Run `npm run dist:win` and verify the automatic semantic bump is at least `6.4.0`. Then run:

```powershell
$env:GEWU_RELEASE_TARGET_VERSION=(node -p "require('./package.json').version")
node scripts/backup-local-host-release.js
npm run publish:desktop-update
npm run dist:win:host
npm run publish:desktop-host-update
npm run rebuild:node
npm.cmd --prefix backend rebuild better-sqlite3
```

Expected: host backup source/copy checks are `ok`, ordinary and host feeds point to the same version, and Node ABI is restored.

- [ ] **Step 5: Install and verify the local primary host**

Preserve `%APPDATA%\gewu-gongfang\gewugongfang.config.json`, `D:\GewuDataHost\data\scheduling.db`, and the question-bank root during installation. Run:

```powershell
node scripts/check_local_storage_readiness.js
node scripts/check_cloud_relay_host.js
```

Verify SQLite `quick_check=ok`, unchanged database/question-bank/store IDs, 200 heartbeat/task processing, and the visible OSS update module.

- [ ] **Step 6: Upload the ordinary installer to Quark**

Run: `node scripts/upload-quark-clean.js`

Expected: upload succeeds, then a second directory read confirms the target date folder, file name, and file size.

- [ ] **Step 7: Commit and push final evidence**

Record formal SHA, cloud backup/health, miniapp upload, installer hashes, OSS feeds, host backup/data paths, and Quark evidence.

```powershell
git add -- task.md docs/reports/2026-07-23-unified-completion-audit.md
git commit -m "docs: record unified release evidence"
git push gewu HEAD:master
git status --short
```

Expected: release evidence is pushed and only user-owned untracked files remain.
