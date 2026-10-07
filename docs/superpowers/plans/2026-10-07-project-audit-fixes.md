# Project audit fixes implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement each task, with regression evidence before integration.

**Goal:** Fix all 11 findings in the 2026 October 7 audit and release the compatible affected components under AGENTS.md.

**Architecture:** Preserve cloud authority and existing route permissions. Validate canonical identity on every authorization; scope native drafts at every read and mutation; retain offline confirmation; bind retry identities to atomic cloud mutation receipts. Keep NAS byte storage only and correct UI evidence rather than widening roles.

**Tech Stack:** Electron/React, Taro, Node/Express, PostgreSQL 17, controlled OSS and cloud/NAS release scripts.

## Accepted repair design

The audit describes the failures and repair requirements; the user's repair instruction authorizes implementing those requirements. Prefer focused fixes over restoring deprecated local authority or introducing a replacement architecture. Additive cloud command receipts require cloud deployment before desktop rollout. Legacy clients keep their REST behavior; new clients carry command identifiers and fail safely when receipt support is unavailable. Current sessions without canonical account evidence fail closed, and any legacy ticket transition must not restore revoked authority.

## Task 1 Desktop identity boundaries

Files: public/desktopAuthorityRuntime.js, src/services/desktopIdentityClient.mjs, src/services/nativeQuestionDraftCreate.js, src/services/questionLocalStore.ts and their runtime tests.

- [x] Turn cross-account, HTTP 503 offline-edit, and in-memory-session reproductions into failing regression tests.
- [x] Filter all draft list/get/submit/confirm/reset/delete operations by current account and business authority, including projection overlays and identity-change races. Reject unscoped legacy drafts rather than assigning them to a new account.
- [x] Keep cloud outages marked unavailable until a usable response succeeds. Mark drafts offline using effective session state as well as network state, and preserve the aggregate confirmation boundary.
- [x] Read the canonical in-memory session for native draft provenance; do not persist access tokens in sessionStorage.
- [x] Run desktop runtime, identity, auto-sync, native-question tests and root typecheck; record results.

## Task 2 Canonical miniapp revocation

Files: cloud-business-api/src/miniappCloudAccountRepository.js, miniappCloudAccountService.js, server.js, additive SQL and integration tests.

- [x] Add failing actual PostgreSQL/HTTP tests for disabled account, revoked authority, changed revocation version, and stale ticket replay.
- [x] Read canonical state through a least-privilege identity-verifier boundary and bind issued tickets to authority/account revocation evidence. Recheck before every authorized request. Keep role scopes and visitor behavior.
- [x] Verify active identity succeeds and each revoked case fails, including after reactivation with an old ticket.

## Task 3 Atomic desktop business receipts

Files: cloud-business-api/src/app.js, server.js, new receipt module/SQL/tests, src/services/desktopCloudBusinessDraft.mjs and desktopIdentityClient.mjs.

- [x] Add failing lost-response create/update tests using actual PostgreSQL and concurrent retries.
- [x] Pass stable command identity from the outbox through authenticated REST metadata. Recompute a canonical HTTP request digest at the cloud boundary.
- [x] Store the mutation and complete receipt in the same writer transaction, serialize duplicate command keys, and replay the exact previous result. Reject changed content or actor scope under the same key. A SQL error handled by a route must not leave the receipt transaction aborted; use statement savepoints. Roll back transient failures and never claim an uncertain write failed.
- [x] Preserve operation audit intent/outcome handling and existing validation, role and tenant checks. Verify concurrent duplicate, changed payload, cross-account, revoked-session, crash/rollback, and response-loss cases.

## Task 4 Classification concurrency

Files: additive cloud-business-api/sql migration, taxonomy service and actual PostgreSQL tests.

- [x] Add failing same-version overwrite and opposing parent-move tests.
- [x] Serialize changes within the checked taxonomy system, recheck versions after locking, and make recursion cycle-safe. Do not silently repair or discard existing data.
- [x] Verify one stale concurrent update conflicts, cycles are rejected, deletion stays bounded, and existing sequential behavior remains.

## Task 5 Miniapp retry and UI evidence

Files: miniapp/src/pages/question-paper/index.tsx, workflow helpers/tests, miniapp UI inventory/scenarios/coverage and capture scripts.

- [x] Add failing actual submit-handler response-loss test; reuse the complete original request/key for unconfirmed retry and use a new key only for a confirmed failed task's new attempt.
- [x] Correct student/family course scenarios to their actual forbidden state without granting access.
- [x] Check inventory against actual role policy, and require current screenshot receipts for a visual-completion claim. Separate source-contract tests from actual visual acceptance.
- [x] Run miniapp typecheck, handler/runtime/UI source checks.
- [ ] Run the current 18-page runtime role/scenario screenshot matrix; WeChat login is pending and no current visual acceptance is claimed.

## Task 6 NAS request deadline

Files: storage-agent/src/cloudClient.js, runtime/config if needed and tests.

- [x] Add failing slow-headers/body and abort tests using an actual local streaming server where useful.
- [x] Set one bounded overall deadline spanning fetch and response-body consumption. Clean timers/signals on success/error and ensure a blocked cloud call cannot outlive task leases indefinitely.
- [x] Test recovery and heartbeat continuity, then run storage-agent's full suite.

## Task 7 Release and CI gates

Files: scripts/release-matrix.js/tests, .github/workflows/release.yml and release-boundary tests.

- [x] Add failing bogus/stale-source commit gate tests.
- [x] Bind build/publish to the declared source commit and compatible versions. Explicitly preserve a reviewed documentation-only source transition if needed, never arbitrary commits.
- [x] Route CI through current controlled packaging/upload/deploy scripts, remove nonexistent legacy deployment calls, validate lock/runtime availability and restore Node native dependencies even on build failure.
- [x] Verify actual workflow command paths and dry-run gate behavior without unintended publication.

## Task 8 Integration and publication

- [x] Review each task for requirements and code quality; rerun targeted checks after review fixes.
- [x] Run npm test (complete no-opt diagnostic mode exit 0), both typechecks, storage tests and affected builds. Update the audit closeout with evidence for all 11 items. Ordinary Node mode remains under verification after two Windows native interruptions.
- [x] Automatically classify and bump each changed component exactly once; update compatibility declarations and deployment ordering.
- [ ] Commit with 自动发布 2026-10-07 and push the integrated master to gewu. Preserve the source checkout's pre-existing document edits and untracked artifacts.
- [ ] Prepare the release matrix, back up and deploy cloud changes, build/upload/verify miniapp, deploy and verify the changed NAS agent, then publish/verify the OSS desktop feed and installer.
- [ ] Restore and verify Node native modules after Electron packaging. If any external platform blocks publication, record that exact target as partial/blocked rather than fabricating a receipt.

## Checkpoint

Implementation starts from a01ba3aa in the attached managed worktree. The audit's npm test and both typechecks passed immediately before this repair run. Existing source-workspace document changes are outside repair scope. Progress and command evidence are retained in output/audit-fixes-20261007.

Final source review found no confirmed remaining issue. Canonical profile changes are included in receipt request digests; NAS 8.9.1 source requires runtime >=8.9.1. Production taxonomy cycle audit returned no rows. Git LFS fonts were materialized; frozen cloud inputs now verify each LFS payload against the committed pointer.

This plan is frozen before the repair commit. Final commit/push, ordinary-Node rerun and publication evidence are recorded separately in output/audit-fixes-20261007/release-outcome.json.
