# PostgreSQL 17 vNext AccessContext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Execute inline in this worktree; do not dispatch subagents. Track each step with checkboxes.

**Goal:** Add a synthetic-only same-handle trusted-session assertion boundary and a read-only PG17 AccessContext resolver.

**Architecture:** A closure-private verifier boundary snapshots only an injected verifier's exact `{ sessionId }` result into a handle-bound opaque assertion. The resolver consumes that assertion in one read-only M1-M15 snapshot, applies the pure policy contract, and returns a deeply frozen context or a single fail-closed public error.

**Tech Stack:** Node.js, `node:util`, existing disposable PostgreSQL 17 runtime/catalog boundary, and `vNextAuthorizationPolicyReference`.

---

## File map

- Create `shared/vnext-pg17/trustedSessionVerifierBoundary.js` and `.test.js` for exact verifier-result snapshots and same-handle opaque assertions.
- Create `shared/vnext-pg17/accessContextResolver.js` and `.test.js` for read-only state resolution and policy evaluation.
- Modify `shared/vnext-pg17/runPg17IntegrationTests.js` and `.test.js` to run both suites in the existing one-runtime lifecycle.
- Modify `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` only after verified tests to append synthetic evidence.

## Task 1: Trusted-session boundary

**Files:**
- Create: `shared/vnext-pg17/trustedSessionVerifierBoundary.test.js`
- Create: `shared/vnext-pg17/trustedSessionVerifierBoundary.js`

- [x] **Step 1: Write failing boundary cases**

```js
const boundary = createVNextPg17TrustedSessionVerifierBoundary({
  databaseBinding: handleA,
  verifyPresentation: async () => ({ sessionId: 'session-1' }),
});
const assertion = await boundary.verify(null);
assert.deepStrictEqual(Reflect.ownKeys(assertion), []);
assert.deepStrictEqual(boundary.unwrap(assertion), { sessionId: 'session-1' });
assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleA), true);
assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleB), false);
```

Cover copied/JSON/manual/cross-boundary assertions; accessor/symbol/non-enumerable/proxy/class-instance/thenable/invalid-ID results; sync throw/rejected Promise redaction; and exact config accessor/symbol/extra/proxy/function-proxy rejection. Complete valid-shape getters and Proxy traps must have zero reads.

- [x] **Step 2: Prove red state**

Run: `node shared/vnext-pg17/trustedSessionVerifierBoundary.test.js`

Expected: `MODULE_NOT_FOUND`.

- [x] **Step 3: Implement minimal opaque boundary**

```js
function exactResult(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== 'sessionId') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'sessionId');
  return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
    && typeof descriptor.value === 'string' && SESSION_ID.test(descriptor.value) ? descriptor.value : null;
}
```

Snapshot exact own-data `{ databaseBinding, verifyPresentation }`; reject Proxy functions. Await only `types.isPromise(result)`, then descriptor-snapshot the session ID once. Keep assertion data in closure-private WeakMaps; map verifier/result failure to `VNEXT_PG17_SESSION_PRESENTATION_REJECTED` and unknown assertions to `VNEXT_PG17_SESSION_ASSERTION_INVALID`. Export a predicate that first checks `bindings.has(boundary)`.

- [x] **Step 4: Verify focused boundary suite**

Run: `node shared/vnext-pg17/trustedSessionVerifierBoundary.test.js`

Expected: `vNext PG17 trusted session verifier boundary checks passed`.

## Task 2: Resolver test fixture and red cases

**Files:**
- Create: `shared/vnext-pg17/accessContextResolver.test.js`

- [x] **Step 1: Create the synthetic M1-M15 fixture**

Apply M1-M15 through the catalog boundary; use the existing PG17 bootstrap writer for the sole authority. With only the fixture-provisioner facade, insert one active online session with matching nine vectors, matching recent reauthentication, role/allow/deny/scope rows, and a valid highest policy publication. Use fixed canonical UTC instants.

- [x] **Step 2: Write failing success and state matrix tests**

```js
const resolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: boundary, surface: 'desktop', now: () => NOW });
const context = await resolver.resolve(assertion);
assert.strictEqual(context.authorityId, 'authority-1');
assert.deepStrictEqual(context.roles, ['super_admin']);
assert.strictEqual(context.reauthenticatedUntil, REAUTH_EXPIRES_AT);
assert.strictEqual(Object.isFrozen(context), true);
```

Cover desktop/miniapp capability behavior, visitor, fake/cross-handle brands, malformed assertion/config/clock, all five parent states, nine vector mismatches, initialization/revoked/expired/future sessions, policy absence/hash/text/contract failure, role/override time windows, deny precedence, invalid scope, and absent/expired/future reauth. For the existing `vnext_recent_reauthentication_events.factor_class` enum, independently prove password, passkey, and verified_contact rows select only their expiry and never expose factor/evidence fields; this does not read or admit `vnext_verified_contacts` metadata as a credential. Every failure must be `VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE`.

- [x] **Step 3: Add read-only evidence**

Take before/after sorted logical snapshots of every target relation and catalog facts through a peer verifier facade. Add a controlled peer write after the first resolver read and prove the resulting context is one coherent snapshot, never a mixed vector/policy view. Catalog drift must produce the same public error with no row change.

- [x] **Step 4: Record focused red-to-green evidence**

Run: `node shared/vnext-pg17/accessContextResolver.test.js`

Expected final state: `vNext PG17 AccessContext resolver checks passed`.

## Task 3: Implement the read-only resolver

**Files:**
- Create: `shared/vnext-pg17/accessContextResolver.js`
- Test: `shared/vnext-pg17/accessContextResolver.test.js`

- [x] **Step 1: Implement exact factory and handle-bound resolver brand**

Accept only exact own-data `{ runtime, handle, verifierBoundary, surface, now }`. Before SQL require a branded handle, boundary for that handle, direct function clock, and `desktop|miniapp` surface. Bind the frozen resolver to the same handle with a WeakMap and export `isVNextPg17AccessContextResolverForHandle`.

- [x] **Step 2: Implement one explicit snapshot**

```js
await catalog.assert(handle);
await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
try {
  // parameterized session/parent, publication, grants/overrides/scopes, and reauth reads
  await facade.query('COMMIT');
  return context;
} catch (_) {
  await facade.query('ROLLBACK');
  throw unavailable();
}
```

Unwrap once and read one canonical UTC clock. Require online active session, active authority/account/device/installation/link, `issued_at <= at < expires_at`, and all nine vectors. Select the highest policy revision, re-canonicalize with the pure policy reference, and require exact canonical text/hash. Do not read capability catalog as a second policy truth.

- [x] **Step 3: Normalize/freeze exact output and errors**

Map snake_case grant/override/scope rows to policy inputs and use the half-open time window. Derive visitor only when formal roles are absent. Filter reauth by same session, time, and nine vectors; return only its expiry. Deep-freeze exactly `{ authorityId, accountId, deviceId, installationId, linkId, sessionId, surface, policyRevision, policyManifestSha256, roles, capabilityIds, capabilitySha256, scopes, scopeSha256, reauthenticatedUntil }`. Map all factory/assertion/clock/catalog/SQL/parent/vector/policy/reauth errors to `VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE` without database or verifier detail.

- [x] **Step 4: Verify resolver suite**

Run: `node shared/vnext-pg17/accessContextResolver.test.js`

Expected: `vNext PG17 AccessContext resolver checks passed`.

## Task 4: Integrate, verify, and publish

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Register one-runtime suite order**

```js
const { runTrustedSessionVerifierBoundaryCases } = require('./trustedSessionVerifierBoundary.test');
const { runAccessContextResolverCases } = require('./accessContextResolver.test');
// manifest -> catalog -> bootstrap -> recovery -> trusted-session-boundary -> access-context -> stop
```

Extend runner tests to prove this order and exactly one `stop` after either new-suite failure.

- [x] **Step 2: Run focused and aggregate checks**

Run: `node shared/vnext-pg17/trustedSessionVerifierBoundary.test.js`; `node shared/vnext-pg17/accessContextResolver.test.js`; `node shared/vnext-pg17/runPg17IntegrationTests.test.js`; `npm.cmd run test:vnext-control-plane-target`; `git diff --check`.

Expected: every command exits `0`.

- [x] **Step 3: Record evidence and final-check**

Append only verified synthetic evidence to the control-plane plan. Run `npm.cmd test`, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and `docker ps -a --format '{{.ID}}|{{.Labels}}' | Select-String -Pattern 'vnext-pg17-' -SimpleMatch`. Tests must exit `0`, diff check must be silent, and no labelled container may remain.

- [ ] **Step 4: Review and scope-publish**

Turn valid necessity/quality findings into regression tests, rerun affected checks, then stage only boundary/resolver/runner/docs files. Commit with the repository-required dated message and push `gewu HEAD:master`. Do not package or publish desktop software because this remains a synthetic internal target reference.

## Plan self-review

- Tasks 1-2 cover exact opaque assertions and the complete read-only state matrix; Task 3 maps every resolver invariant; Task 4 covers integration, evidence, cleanup, and publishing.
- No step creates a token verifier, writer, API, production connection, business relation, real session, or data migration.
