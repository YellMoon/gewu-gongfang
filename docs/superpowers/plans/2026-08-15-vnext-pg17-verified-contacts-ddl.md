# PostgreSQL 17 Verified Contacts Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add only the V5 verified-contacts relation as ordered PostgreSQL 17 migration 8.

**Architecture:** Migration 8 appends one immutable ledger entry after migrations 1-7 and creates `vnext_control_plane.vnext_verified_contacts`. The relation depends only on migration 2's composite account identity. Contact values and evidence remain opaque canonical-collated text; no plaintext contact value, normalization implementation, verification channel, seed, or writer is introduced.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

---

## Fixed scope

- Append migration 8 only: a 12-column verified-contacts relation whose primary key plus `UNIQUE(authority_id, contact_type, normalized_value_hash)` are its complete index set.
- Nonblank `COLLATE "C"` values are required for contact, authority, account, normalized-value-hash, and evidence-hash. Both hash-named fields remain opaque text; no SHA-256 shape is inferred.
- Allowed values are exactly `phone|wechat_openid|wechat_unionid` and `verified|revoked`; `row_version` is positive `bigint`; nullable verification/revocation timestamps must be finite.
- The lifecycle permits verified rows only with `verified_at` and no `revoked_at`, and revoked rows only with both. It requires `updated_at >= created_at`, but invents no other timestamp order.
- The only foreign key is the composite account key using `ON UPDATE RESTRICT ON DELETE RESTRICT`. No contact, business-profile, or recovery relation is referenced.
- Add no trigger, function, seed, writer, API, runtime integration, real contact identifier, real cloud connection, or deployment artifact. Migrations 1-7 and schema meta remain unchanged.

### Task 1: Write manifest tests before migration SQL

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] **Step 1: Require migration 8 in the manifest test.**

  Import `VERIFIED_CONTACTS_MIGRATION`; require ordered semantic versions `[1,2,3,4,5,6,7,8]`; assert its stable ID, version, checksum, table, composite account FK, and contact-identity unique rule.

- [x] **Step 2: Run the focused test to observe RED.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: failure because migration 8 is absent.

- [x] **Step 3: Add the minimum immutable migration.**

  Define and export `VERIFIED_CONTACTS_MIGRATION`; append it to `MIGRATIONS` and add the relation to the exact alphabetical target catalog. The SQL must create only:

  ```sql
  CREATE TABLE vnext_control_plane.vnext_verified_contacts (
    contact_id text COLLATE "C" PRIMARY KEY CHECK (btrim(contact_id) <> ''),
    authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
    account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
    contact_type text COLLATE "C" NOT NULL CHECK (contact_type IN ('phone','wechat_openid','wechat_unionid')),
    normalized_value_hash text COLLATE "C" NOT NULL CHECK (btrim(normalized_value_hash) <> ''),
    verification_state text COLLATE "C" NOT NULL CHECK (verification_state IN ('verified','revoked')),
    verification_evidence_hash text COLLATE "C" NOT NULL CHECK (btrim(verification_evidence_hash) <> ''),
    verified_at timestamptz,
    revoked_at timestamptz,
    row_version bigint NOT NULL CHECK (row_version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
    CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
    CHECK (verified_at IS NULL OR (verified_at <> 'infinity'::timestamptz AND verified_at <> '-infinity'::timestamptz)),
    CHECK (revoked_at IS NULL OR (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz)),
    CHECK (updated_at >= created_at),
    CHECK ((verification_state = 'verified' AND verified_at IS NOT NULL AND revoked_at IS NULL) OR (verification_state = 'revoked' AND verified_at IS NOT NULL AND revoked_at IS NOT NULL)),
    UNIQUE (authority_id, contact_type, normalized_value_hash),
    FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
  );
  GRANT SELECT ON TABLE vnext_control_plane.vnext_verified_contacts TO vnext_pg17_verifier;
  ```

- [x] **Step 4: Run the focused test to observe GREEN.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Write real PG behavior and catalog tests before catalog implementation

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Add behavior tests.**

  Add a contact fixture and cover three types, both valid states, opaque non-SHA text, globally reserved same-authority type/hash identity even after revocation, distinct type/authority legality, cross-authority account rejection, verifier insert/runtime select denial, and zero seed.

- [x] **Step 2: Add non-masked validation tests.**

  Use unique fixtures for each blank required value, bad enum, zero version, infinity timestamp, backward update time, missing verified time, verified-with-revoked-time, and revoked-without-revoked-time. Each must assert its exact PostgreSQL constraint name rather than a generic check failure.

- [x] **Step 3: Add migration-7 prefix failure coverage.**

  Apply only migrations 1-7 and ledger records, call both catalog apply and assert, then require ledger `[1,2,3,4,5,6,7]` and `to_regclass('vnext_control_plane.vnext_verified_contacts') IS NULL`.

- [x] **Step 4: Run the focused catalog test to observe RED.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Expected: failure because relation, constraints, and ledger facts are absent.

- [x] **Step 5: Extend the catalog assertion minimally.**

  Add the full column map, named constraints, composite RESTRICT FK, unique constraint/index, owner, verifier-only SELECT ACL, no-target-trigger expectation, and ledger hash. Obtain catalog hash constants from a temporary local diagnostic that uses the assertion query ordering exactly; remove it before commit.

- [x] **Step 6: Add isolated drift regressions.**

  In fresh handles, assert schema drift for altered unique key, extra ordinary index, removed FK, widened same-name type/state/lifecycle checks, unexpected default, verifier/runtime ACL changes, extra target trigger, and public shadow relation. Each fixture has only one drift.

- [x] **Step 7: Run focused tests and the aggregate gate.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Run: `npm.cmd run test:vnext-control-plane-target`

  Expected: passing tests and no remaining disposable PG container.

### Task 3: Review, evidence, and publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-verified-contacts-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Run complete scoped verification.**

  Run `node shared/vnext-pg17/migrationManifest.test.js`, `node shared/vnext-pg17/catalogAssertion.test.js`, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and the Docker label query from the target verification instructions. All tests must exit zero, diff check must be silent, and no labeled container may remain.

- [x] **Step 2: Request independent quality review.**

  Submit the scoped diff to the existing audit task. For each finding, write a failing regression first, make the smallest correction, then re-run focused and aggregate verification.

- [x] **Step 3: Record verified synthetic evidence.**

  Mark completed plan steps and append a Migration 8 entry to the master control-plane plan. It must state that evidence came from disposable synthetic PG17 and must not claim RDS, ECS, real contacts, or production deployment.

- [x] **Step 4: Commit and push only scope files.**

  Stage the two plan files plus the four PG17 manifest/catalog implementation and test files, use the repository-required dated commit message, and push `gewu HEAD:master`. Exclude output directories, artifacts, and unrelated files.

## Self-review

- This plan maps every approved column, constraint, permission, no-seed/no-trigger rule, prefix failure, and catalog drift behavior to a testable task.
- It excludes sessions, reauthentication, receipts, audit, outbox, policy, bootstrap, evidence, writers, APIs, and real-resource work.
- It requires disposable PG17 behavior and exact catalog verification; static SQL inspection alone cannot claim success.
