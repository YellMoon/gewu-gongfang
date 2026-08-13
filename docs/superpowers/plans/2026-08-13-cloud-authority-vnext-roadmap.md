# Cloud Authority vNext Implementation Roadmap

> **Superseded execution order (2026-08-13):** This file describes the final destination, but its full-business migration steps are not the next executable phase. The active order is in `2026-08-13-vnext-control-plane-first.md`: control plane first, then one business domain at a time after explicit parity gates.

> **Execution policy:** The user requires direct serial execution by the primary agent. Do not dispatch parallel agents. Each phase receives its own file-level plan, tests, commits, and evidence.

**Goal:** Preserve all business logic and existing desktop/question-bank data while moving Gewu Workshop to a cloud-authoritative architecture with one desktop build and a NAS or storage agent that handles files but never business authorization.

**Architecture:** Build read-only inventory, immutable migration bundles, shadow imports, and rollback evidence first. Then replace the cloud schema, identity/device/access layer, business repositories, desktop offline partitions, and question-file jobs in bounded phases. Long-lived dual writes are forbidden, and legacy data stays recoverable through the observation period.

**Tech Stack:** Electron 28, React 18, TypeScript, Node.js, Express, SQLite/better-sqlite3, target cloud database, WebSocket, Taro/WeChat miniapp, Windows safeStorage, NAS/filesystem storage agent.

---

## Authoritative inputs and execution rules

- Design: `docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md`
- Phase-one plan: `docs/superpowers/plans/2026-08-13-vnext-migration-foundation.md`
- Progress state: the Cloud Authority vNext section at the top of `task.md`.
- The paused `codex/account-permission-device-trust` worktree is a source of reusable identity/device/access design only. Never merge or publish it wholesale.
- Do not write production data into the new authority until verified backups, a successful shadow import, and an approved cutover window exist.
- Each phase must test migration/file hashes and rollback behavior, commit, and push `gewu/master`. Build and publish OSS updates only after runtime changes reach a release phase.

## Phase 0: Freeze the old direction and preserve evidence

- [x] Record the paused worktree HEAD, dirty paths, untracked paths, and reusable module map without storing private data.
- [x] Prevent the paused worktree from being released to `gewu/master`.
- [ ] Add vNext feature flags and phase gates on stable master.
- [x] Record only redacted production/local source summaries; never commit secrets or private absolute paths.

## Phase 1: Read-only inventory and migration bundle

- [x] Inventory SQLite consistently and read-only, including schema, counts, keys, and hashes.
- [x] Inventory online question/NAS/cache files with size, SHA-256, and collision reports; retain disconnected removable roots as unresolved prerequisites.
- [x] Define manifest, source inventory, migration ledger, unresolved report, and checksums.
- [x] Accept explicit runtime config, database, file roots, desktop export roots, and output paths.
- [x] Never read private keys, copy tokens, write source paths, or upload automatically.
- [x] Test WAL, corrupt databases, reruns, interrupted writes, overlapping paths, CJK filenames, 64-bit integers, and bundle semantic consistency.
- [x] Run two real inventory-only dry-runs without copying business payloads; evidence is in `docs/verification-2026-08-13-vnext-migration-foundation.md`.

## Phase 2: Cloud vNext schema and shadow import

- [ ] Record the target database choice and isolate dev/staging/prod.
- [ ] Create authoritative account, profile, role, capability, scope, device, installation, link, business, question metadata, file object, audit, outbox, and migration-ledger schemas.
- [ ] Implement an idempotent SQLite-to-canonical-to-shadow importer.
- [ ] Preserve stable business IDs; fail closed and ledger every collision.
- [ ] Import twice into a clean shadow environment and prove that the second run creates no duplicates.
- [ ] Verify row counts, primary-key sets, canonical row hashes, foreign keys, financial/hour aggregates, and file references.
- [ ] Restore an empty environment from backup and repeat the import.

## Phase 3: Account, profile, access, and device trust

- [ ] Selectively port stable subjects, profile bindings, capability/scope, device/installation/link, and account-partition protocols from the paused worktree.
- [ ] Replace host receipts, host epochs, and host-signed contexts with cloud transactions and cloud-signed AccessContext.
- [ ] Implement registration, verified contacts, teacher/student profile matching, and reviewed duplicate-profile merging.
- [ ] Implement same-device multi-account use, installation-key proof, clone risk, layered revocation, and reauthentication.
- [ ] Implement short access/session tokens, restricted initialization sessions, and up-to-30-day read/draft-only offline licenses.
- [ ] Gate the super-admin review center by cloud role, capability, valid device/link, and recent elevation.
- [ ] Prove through the formal HTTP app that client-supplied subject and scope IDs cannot elevate access.

## Phase 4: Business repositories and API cutover

- [ ] Introduce repository interfaces without rewriting scheduling, billing, consumption, or asset algorithms.
- [ ] Move schools/institutions, profiles, courses/schedules, billing/consumption, and assets in dependency order.
- [ ] Require session, device, capability, scope, row version, idempotency, audit, and outbox for every write.
- [ ] Temporarily adapt legacy reads; safely adapt legacy writes or retire them with HTTP 410 and replacement metadata.
- [ ] Remove every local-host business-write path that could form a second authority.
- [ ] Retain existing domain tests and add formal HTTP/database outcome assertions.

## Phase 5: Unified desktop and offline layer

- [ ] Collapse ordinary/primary-host flavors into one build; build flavor must not grant permission.
- [ ] Create per-account encrypted partitions for snapshot, cache, drafts, outbox, and quarantine.
- [ ] Close the old partition and clear AccessContext/subscriptions/caches before account switching.
- [ ] Offline mode permits authorized cached reads and drafts only; sync, privileged work, and formal question writes require online access.
- [ ] Show an impact preview and require explicit user confirmation before submission.
- [ ] Let revoked/out-of-scope/conflicted drafts be viewed, exported, or discarded, never submitted.
- [ ] Mount super-admin pages by capability and reject direct routes/local tampering.

## Phase 6: Question files and storage agent

- [ ] Move structured question content, taxonomy, versions, and audit to the cloud authority.
- [ ] Implement file-object states from `pending_upload` through `verified`, plus failure/quarantine/deletion states.
- [ ] Implement short-lived jobs, allowed roots, idempotent writes, and SHA-256 receipts.
- [ ] Support images, DOCX/PDF, MathType/OLE, import sources, and export artifacts.
- [ ] Validate DX4600 Docker directory isolation; otherwise run the agent on a controlled Windows/Linux device.
- [ ] Implement NAS snapshots/versioning and NAS-to-removable-drive offline backups with restore checks.
- [ ] Test NAS offline, read-only media, full disks, missing/hash-mismatched files, duplicate jobs, and agent restarts.

## Phase 7: Miniapp and unified contracts

- [ ] Move all miniapp business calls to cloud-authoritative APIs.
- [ ] Preserve the read-mostly/limited-write miniapp surface even for super-admin accounts.
- [ ] Cover all registered and navigable pages for the applicable admin/student roles and critical states.
- [ ] Run question selection, paper assembly, and DOCX/PDF export through cloud jobs and the storage agent.
- [ ] Verify UI coverage, permission matrices, empty/offline/denied/limited-write states, and a real development build.

## Phase 8: Shadow migration, cutover, and rollback rehearsal

- [ ] Perform at least one full shadow migration and one incremental catch-up.
- [ ] Restore cloud data, bundle state, and question-file indexes into an empty environment.
- [ ] Test packaged Electron with two isolated userData roots and multi-account/admin/teacher paths.
- [ ] Verify miniapp, cloud, desktop, storage agent, NAS, and removable backup versions and runtime evidence.
- [ ] Rehearse legacy read-only mode, final delta, feature-flag cutover, and rollback compensation bundles.
- [ ] Schedule production cutover only when all P0 differences are zero.

## Phase 9: Production release and observation

- [ ] Back up and restore-verify cloud code/database, legacy local DB, question files, runtime config, and migration bundle.
- [ ] Freeze legacy writes and run final row/aggregate/file verification.
- [ ] Enable the cloud-only writer and release the unified desktop OSS feed, cloud, storage agent, and applicable miniapp build.
- [ ] Verify first login, installation proof, account partition initialization, snapshot, and imported draft review.
- [ ] Keep the old app, DB, and source question files for a 30-90 day observation period.
- [ ] Report partial release or blocked status when platform review or NAS capability remains outstanding.

## Completion audit

The goal is complete only when every design success criterion has current evidence; cloud is the sole formal business writer; all legacy rows/files have ledger outcomes and verified recovery copies; domain, question/export, miniapp, access, device, offline, NAS/storage, and backup flows pass automated and real runtime verification; and every applicable release target has a matching-version receipt.
