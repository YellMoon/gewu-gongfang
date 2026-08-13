# vNext Trusted Session Verifier Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a minimal opaque trusted-session assertion boundary so a future read-only AccessContext resolver cannot mistake a caller-supplied session ID for authentication.

**Architecture:** `createVNextTrustedSessionVerifierBoundary` receives only an explicitly injected verifier function. A verified exact `{ sessionId }` result becomes a frozen opaque object branded in a closure-private `WeakMap`; only the creating boundary can unwrap it. The module has no token format, credentials, I/O, database, runtime or route integration.

**Tech Stack:** Node.js CommonJS, built-in `assert`, `WeakMap`, `Object.freeze`.

---

### Task 1: Define the red behavioural contract

**Files:**

- Create: `shared/vNextTrustedSessionVerifierBoundaryReference.test.js`
- Modify: `package.json`

- [x] **Step 1: Write failing tests**

Use the following behavior as the focused contract:

    const boundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: async () => ({ sessionId: 'session-1' }) });
    const assertion = await boundary.verify({ opaque: 'presentation' });
    assert.deepEqual(boundary.unwrap(assertion), { sessionId: 'session-1' });
    assert.throws(() => boundary.unwrap({ ...assertion }), /VNEXT_TRUSTED_SESSION_ASSERTION_INVALID/);

Also assert: missing verifier fails; sync and native-Promise success both work; verifier throw/rejection, thenable result, non-object result, extra result fields, blank/trimmed/invalid session IDs all fail with `VNEXT_SESSION_PRESENTATION_REJECTED`; JSON/spread/manual/cross-boundary assertion copies fail; handle and unwrapped record are frozen; no presentation is returned. Add this focused test to `test:vnext-migration`.

- [x] **Step 2: Run the test and confirm RED**

Run `node shared/vNextTrustedSessionVerifierBoundaryReference.test.js`. Expected: `MODULE_NOT_FOUND`, proving production code does not yet exist.

### Task 2: Implement the minimum opaque boundary

**Files:**

- Create: `shared/vNextTrustedSessionVerifierBoundaryReference.js`

- [x] **Step 1: Add the error and result validators**

    function boundaryError(code) { return Object.assign(new Error(code), { code }); }
    function sessionIdFromVerifiedResult(value) {
      if (!isExactPlainObject(value, ['sessionId']) || !SESSION_ID.test(value.sessionId)) {
        throw boundaryError('VNEXT_SESSION_PRESENTATION_REJECTED');
      }
      return value.sessionId;
    }

The session ID validator accepts only a non-whitespace stable opaque ID made of ASCII letters/digits plus `.`, `_`, `:` and `-`; it never trims or coerces.

- [x] **Step 2: Add the branded factory**

    function createVNextTrustedSessionVerifierBoundary({ verifyPresentation } = {}) {
      if (typeof verifyPresentation !== 'function') throw boundaryError('VNEXT_TRUSTED_VERIFIER_INVALID');
      const assertions = new WeakMap();
      return Object.freeze({
        async verify(presentation) { /* call injected verifier and map failures */ },
        unwrap(assertion) { /* only accept this closure's WeakMap key */ },
      });
    }

`verify` stores a frozen empty opaque object as a `WeakMap` key. It returns neither the presentation nor the verified result. `unwrap` returns only a separately frozen `{ sessionId }` record. Every invalid verification result, rejected promise, thrown verifier error or non-native thenable maps to `VNEXT_SESSION_PRESENTATION_REJECTED`; all assertion-brand failures map to `VNEXT_TRUSTED_SESSION_ASSERTION_INVALID`.

- [x] **Step 3: Run focused test and confirm GREEN**

Run `node shared/vNextTrustedSessionVerifierBoundaryReference.test.js`. Expected: `vNext trusted session verifier boundary checks passed`.

### Task 3: Record and verify the isolated boundary

**Files:**

- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Create: `docs/verification-2026-08-14-vnext-trusted-session-verifier-boundary.md`

- [x] **Step 1: Record the non-claims**

State that trust derives only from a deployment-composed injected verifier, not the assertion object's shape; this reference does not perform cryptographic authentication, issue/validate tokens, query a database, expose an API, or accept a client session ID as credentials.

- [x] **Step 2: Verify integration and whitespace**

Run `node shared/vNextTrustedSessionVerifierBoundaryReference.test.js`, `npm run test:vnext-migration`, and `git diff --check`. Expected: all commands exit `0`.

- [x] **Step 3: Obtain GPT-5.6-sol two-gate audit, commit only task files and push**

The quality audit must first reconfirm this task is still an isolated precondition, then check closure branding, strict result validation, error redaction and full test coverage. Stage only task files and never stage `output/`.

## Exclusions and next gate

- No JWT, cookie, token, signature algorithm, password, passkey, challenge, public/private key, session issuer, API, gateway/runtime import, database read/write, source-data access, cloud deployment, business migration or policy writer.
- A subsequent necessity audit may introduce a read-only AccessContext resolver only after this boundary passes. It must consume the opaque assertion, current V4 policy publication and V3 current state; it may not accept caller-supplied identity/role/capability/scope claims.
