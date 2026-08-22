# Multi-contact student identity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a student up to three independent verified login accounts: one student account and two guardian accounts, all resolving the same student scope.

**Architecture:** M18 turns a verified desktop password into the existing cloud registration ticket and device challenge, with no second registration protocol. M19 adds an auditable student-access binding rather than sharing accounts, passwords, devices, sessions, receipts, audits, or offline leases. Phone, official WeChat OpenID, and official WeChat UnionID remain verified identity types; a hand-entered WeChat ID is a restricted contact hint and never an authentication credential.

**Tech Stack:** Node.js, Express, PostgreSQL 17 migrations and catalog assertions, Electron desktop identity client, disposable PostgreSQL tests.

---

## Invariants

- At most one active `student` binding and two active `guardian` bindings exist for each `(authority_id, student_id)`.
- Each canonical account has at most one active student access binding.
- Only `phone`, `wechat_openid`, and `wechat_unionid` can resolve an account. Raw contacts, typed WeChat IDs, tokens, passwords, client-selected account IDs, and client-selected roles are never accepted by the binding boundary.
- M19 appends to the frozen M1-M18 catalog. It does not change old migration bytes or hashes.
- All candidate registration paths use the same pending-registration object and only normal online registration may persist a device/session/lease.

### Task 1: Complete the M18 password-to-registration flow

**Files:**
- Modify: `cloud-business-api/src/desktopRegistrationService.js`
- Modify: `cloud-business-api/src/desktopPasswordAuthenticationService.js`
- Modify: `cloud-business-api/src/app.js`
- Modify: `src/services/desktopIdentityClient.mjs`
- Test: matching `*.test.js` files

- [ ] **Step 1: Write failing cloud ticket tests.**

  Require `issueVerificationForVerifiedAccount()` and both password routes to return exactly `{ verificationToken, deviceChallenge }`; reject a ticket missing either property.

- [ ] **Step 2: Run the focused tests and observe RED.**

  Run: `node cloud-business-api/src/desktopRegistrationService.test.js; node cloud-business-api/src/desktopPasswordAuthenticationService.test.js; node cloud-business-api/src/app.test.js`

- [ ] **Step 3: Write failing desktop client tests.**

  Require `beginPasswordVerification()` and `beginPasswordEnrollment()` to POST to their cloud route, require the exact ticket pair, and return a frozen pending registration object. Assert no session, lease, password, or vault record exists before `completeUnifiedOnlineRegistration()`.

- [ ] **Step 4: Run the client test and observe RED.**

  Run: `node src/services/desktopIdentityClient.test.js`

- [ ] **Step 5: Implement the minimum forwarding path.**

  Reuse the existing registration completion. Reject non-plain input, accessors, proxies, unexpected response keys, and blank ticket fields.

- [ ] **Step 6: Verify and commit.**

  Run: `node src/services/desktopIdentityClient.test.js; npm.cmd --prefix cloud-business-api test; node --check cloud-business-api/server.js; git diff --check`

  Commit only Task 1 files and push `gewu master`. Do not deploy before M18 is applied by the controlled server upgrade.

### Task 2: Freeze M19 database behavior with failing disposable tests

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.js`
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Create: `scripts/vnext-migration/cloudControlPlaneM19Upgrade.js`
- Create: `scripts/vnext-migration/cloudControlPlaneM19Upgrade.test.js`

- [ ] **Step 1: Write failing M19 PostgreSQL assertions.**

  Define `vnext_student_access_bindings` with an opaque student ID, relationship, lifecycle, evidence hash, version, and finite timestamps. Test: one student role, two guardian roles, fourth guardian failure, duplicate active account failure, cross-authority failure, bad lifecycle failure, direct DML denial, PUBLIC EXECUTE denial, and exact M18-to-M19 upgrade only.

- [ ] **Step 2: Run focused database tests and observe RED.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js; node shared/vnext-pg17/catalogAssertion.test.js; node scripts/vnext-migration/cloudControlPlaneM19Upgrade.test.js`

- [ ] **Step 3: Add the closed identity-verifier command.**

  Add M19 after M18 only. The command resolves and locks the verified typed contact itself, enforces the cap in PostgreSQL, and never accepts a caller-selected canonical account. Revoke PUBLIC EXECUTE and grant only `vnext_pg17_identity_verifier`; keep writer/runtime/verifier without row DML.

- [ ] **Step 4: Make catalog verification exact.**

  Assert exact columns, constraints, indexes, triggers, function signature/owner/security-definer/search path/definition hash, role memberships, relation ACLs, column ACLs, function ACLs, default ACLs, and zero seed. Add mutations for cap-index drift, PUBLIC EXECUTE, unexpected column privilege, and a public shadow relation.

- [ ] **Step 5: Implement the controlled M18-to-M19 upgrade and verify.**

  Reject every ledger prefix except exact M1-M18. Apply only frozen M19 SQL and its ledger write in one transaction; validate the final catalog before commit.

- [ ] **Step 6: Verify and commit.**

  Run: `npm.cmd run test:vnext-migration; node shared/vnext-pg17/catalogAssertion.test.js; node scripts/vnext-migration/cloudControlPlaneM19Upgrade.test.js; git diff --check`

### Task 3: Extend canonical resolution and add the student-access service

**Files:**
- Modify: `cloud-business-api/src/canonicalAccountRepository.js`
- Modify: `cloud-business-api/src/canonicalAccountService.js`
- Create: `cloud-business-api/src/studentAccessIdentityService.js`
- Test: matching `*.test.js` files

- [ ] **Step 1: Write failing typed-contact resolver tests.**

  `resolveVerifiedContact({ authorityId, contactType, normalizedValueHash })` accepts only the three verified contact types. It returns exactly one active account; zero rows produce `NOT_PROVISIONED`, and multiple rows produce `CONFLICT`. Test revoked contact, authority mismatch, raw contact, blank field, proxy, and accessor rejection.

- [ ] **Step 2: Run resolver tests and observe RED.**

  Run: `node cloud-business-api/src/canonicalAccountRepository.test.js; node cloud-business-api/src/canonicalAccountService.test.js`

- [ ] **Step 3: Implement typed resolution and frozen output.**

  Do not expose SQL or a raw-contact creation API. Reject hand-entered WeChat ID as an identity type.

- [ ] **Step 4: Write failing student access service tests.**

  A trusted proof adapter calls the M19 function and returns only canonical account ID, opaque student ID, relationship, and non-secret status. Test two guardian success, third guardian failure, second student failure, replay, revocation, and cross-authority failure.

- [ ] **Step 5: Implement the minimal service adapter and verify.**

  The browser never supplies account ID, role, password, token, or raw contact. The server supplies only the normalized verified identity after its separate proof check.

- [ ] **Step 6: Run and commit.**

  Run: `npm.cmd --prefix cloud-business-api test; node --check cloud-business-api/server.js; git diff --check`

### Task 4: Make miniapp and desktop read the same student scope

**Files:**
- Modify: `cloud-business-api/src/server.js`
- Modify: `cloud-business-api/src/app.js`
- Modify: `cloud-business-api/src/miniappCloudAccountRepository.js`
- Modify: `cloud-business-api/src/miniappCloudAccountService.js`
- Test: matching service and route tests

- [ ] **Step 1: Write failing context tests.**

  Both miniapp login and desktop registration resolve the same active opaque student ID and relationship for a canonical account. They do not return other accounts, contact identities, evidence, password data, or hand-entered WeChat IDs.

- [ ] **Step 2: Implement one read-only M19 projection.**

  Add one read-only active-binding projection to `miniappCloudAccountRepository.js`, consume it from `miniappCloudAccountService.js`, and use the same result in `app.js` and the desktop registration context assembled by `server.js`. Revoked binding means no student scope; sessions/devices remain account-specific.

- [ ] **Step 3: Add negative route tests and verify.**

  A teacher has no student scope without a binding, guardians cannot use each other’s sessions, and a manual WeChat ID never unlocks access.

- [ ] **Step 4: Run and commit.**

  Run: `npm.cmd --prefix cloud-business-api test; git diff --check`

### Task 5: Controlled deployment and final release audit

**Files:** deployment/readiness files discovered by the existing controlled-upgrade workflow only.

- [ ] **Step 1: Add pre-deployment smoke checks.**

  Require exact M18/M19 ledger versions, least-privilege function execution, malformed-request secrecy, and no raw contact/secret response.

- [ ] **Step 2: Run local verification.**

  Run: `npm.cmd run test:vnext-control-plane-target; npm.cmd --prefix cloud-business-api test; node src/services/desktopIdentityClient.test.js; git diff --check`

- [ ] **Step 3: Upgrade production through the exact M17-to-M18-to-M19 procedure.**

  Stop on backup, prefix, catalog, or health failure. Do not use manual SQL or release a client on failure.

- [ ] **Step 4: Validate authorized account scenarios.**

  Verify phone-first and official-WeChat-first resolution, desktop password login, one student plus two guardians with distinct sessions, cap/revocation denial, and online registration plus signed-lease offline draft behavior.

- [ ] **Step 5: Obtain the required 5.6-sol audit before the unified release.**

  Release cloud, desktop update feed, and miniapp only after PASS and per-client version/health/upload evidence. Otherwise report partial release.
