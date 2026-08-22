# Multi-contact student identity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a student up to three independent verified login accounts: one student account and two guardian accounts, all resolving the same student scope.

**Architecture:** M18 turns a verified desktop password into the existing cloud registration ticket and device challenge, with no second registration protocol. The existing `business.miniapp_cloud_role_grants` relation becomes the auditable student-access binding by adding a relationship discriminator and a database-enforced cap, rather than creating another parallel control-plane identity table. Phone, official WeChat OpenID, and official WeChat UnionID remain verified identity types; a hand-entered WeChat ID is a restricted contact hint and never an authentication credential.

**Tech Stack:** Node.js, Express, PostgreSQL 17 migrations and catalog assertions, Electron desktop identity client, disposable PostgreSQL tests.

---

## Invariants

- At most one active `student` binding and two active `guardian` bindings exist for each `(authority_id, student_id)`.
- Each canonical account has at most one active student access binding.
- Only `phone`, `wechat_openid`, and `wechat_unionid` can resolve an account. Raw contacts, typed WeChat IDs, tokens, passwords, client-selected account IDs, and client-selected roles are never accepted by the binding boundary.
- The student-access migration is additive to the deployed `business` schema. It does not change frozen M1-M18 control-plane bytes or hashes.
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

### Task 2: Add a database-enforced student/guardian cap to the existing business grant relation

**Files:**
- Create: `cloud-business-api/sql/20260822-miniapp-student-access.sql`
- Create: `cloud-business-api/sql/miniapp-student-access.test.js`
- Modify: `cloud-business-api/package.json`

- [ ] **Step 1: Write the failing SQL contract test.**

  Require a `student_relationship` column on `business.miniapp_cloud_role_grants`. It must allow `student` and `guardian` only for student grants, retain NULL for all other roles, and use a SECURITY DEFINER trigger with a per-profile advisory transaction lock. The test requires one self relationship maximum, two guardian maximum, a stable failure code, and no raw phone or WeChat value.

- [ ] **Step 2: Run the test and observe RED.**

  Run: `node cloud-business-api/sql/miniapp-student-access.test.js`

- [ ] **Step 3: Add the additive business migration.**

  Add the relationship column and exact lifecycle check to the existing role grant table. The trigger counts active student grants for the profile excluding the current account, rejects a second self or third guardian, and is not executable by PUBLIC. It remains a database integrity guard; service-level actor authorization remains separate.

- [ ] **Step 4: Add a disposable PostgreSQL behavior test.**

  Build the current account/profile tables in a temporary schema and prove one student plus two guardians succeeds, a fourth account is rejected, a revoked guardian no longer counts, and an account cannot hold a second active role. Preserve the existing teacher/student profile existence guard.

- [ ] **Step 5: Register, verify, and commit.**

  Run: `npm.cmd --prefix cloud-business-api test; git diff --check`

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

  A trusted proof adapter calls the existing canonical resolver and the business grant repository, returning only canonical account ID, opaque student ID, relationship, and non-secret status. Test two guardian success, third guardian failure, second student failure, replay, revocation, and cross-authority failure.

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

- [ ] **Step 2: Implement one read-only student-access projection.**

  Add one read-only active student-grant projection to `miniappCloudAccountRepository.js`, consume it from `miniappCloudAccountService.js`, and use the same result in `app.js` and the desktop registration context assembled by `server.js`. Revoked binding means no student scope; sessions/devices remain account-specific.

- [ ] **Step 3: Add negative route tests and verify.**

  A teacher has no student scope without a binding, guardians cannot use each other’s sessions, and a manual WeChat ID never unlocks access.

- [ ] **Step 4: Run and commit.**

  Run: `npm.cmd --prefix cloud-business-api test; git diff --check`

### Task 5: Controlled deployment and final release audit

**Files:** deployment/readiness files discovered by the existing controlled-upgrade workflow only.

- [ ] **Step 1: Add pre-deployment smoke checks.**

  Require the exact M18 ledger version, applied business student-access migration, least-privilege function execution, malformed-request secrecy, and no raw contact/secret response.

- [ ] **Step 2: Run local verification.**

  Run: `npm.cmd run test:vnext-control-plane-target; npm.cmd --prefix cloud-business-api test; node src/services/desktopIdentityClient.test.js; git diff --check`

- [ ] **Step 3: Upgrade production through the exact M17-to-M18 procedure and the reviewed business migration.**

  Stop on backup, prefix, catalog, or health failure. Do not use manual SQL or release a client on failure.

- [ ] **Step 4: Validate authorized account scenarios.**

  Verify phone-first and official-WeChat-first resolution, desktop password login, one student plus two guardians with distinct sessions, cap/revocation denial, and online registration plus signed-lease offline draft behavior.

- [ ] **Step 5: Obtain the required 5.6-sol audit before the unified release.**

  Release cloud, desktop update feed, and miniapp only after PASS and per-client version/health/upload evidence. Otherwise report partial release.
