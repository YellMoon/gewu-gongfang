# vNext Read-Only Inventory and Migration Foundation Implementation Plan

> **For agentic workers:** The user requires direct serial execution by the primary agent; do not dispatch parallel agents. Before each task, read `docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md` and this plan. Track checkboxes and commit each bounded task.

**Goal:** Build a default-read-only, recoverable, verifiable, and redacted migration foundation that inventories legacy SQLite, desktop exports, question files, and offline drafts without modifying any source.

**Architecture:** Separate path safety, SQLite inventory, file hashing, source discovery, bundle protocol/writing, and CLI orchestration into focused modules. Open sources with `readonly + fileMustExist`; when a consistent copy is later required, use SQLite online backup into an explicit external output. Phase one emits inventory-only bundles, not business payload copies.

**Tech Stack:** Node.js, better-sqlite3, crypto, fs/path, existing CommonJS tests, Windows UTF-8/CJK paths.

---

## File map

- `shared/migrationBundleProtocol.js`: canonical bundle schema and ledger states.
- `scripts/vnext-migration/pathSafety.js`: absolute path validation, overlap rejection, and redacted summaries.
- `scripts/vnext-migration/sqliteInventory.js`: read-only integrity/schema/count/key/hash inventory.
- `scripts/vnext-migration/fileInventory.js`: bounded streaming file-tree hashes and unresolved entries.
- `scripts/vnext-migration/sourceDiscovery.js`: explicit runtime-config/source discovery.
- `scripts/vnext-migration/bundleWriter.js`: atomic manifest/report/checksum output and verification.
- `scripts/vnext-migration/cli.js`: `inventory` and `verify` commands.
- Matching `.test.js` files for each module.
- `docs/vnext-migration-runbook.md`: operator procedure and safety/rollback notes.
- `package.json`: migration commands and exact test suite.
- `task.md`: current vNext progress block; preserve all legacy history below it.

### Task 1: Freeze the bundle protocol

- [ ] Write `shared/migrationBundleProtocol.test.js` first. Assert schema version 1, `inventory-only` mode, deterministic source sorting, duplicate source rejection, allowed ledger terminal states, and absence of absolute path text.
- [ ] Run `node shared/migrationBundleProtocol.test.js`; expect module-not-found failure.
- [ ] Implement `shared/migrationBundleProtocol.js` with `createInventoryManifest`, `validateManifest`, `validateLedgerEntry`, and recursive-key-sorted `canonicalJson`. Allowed source kinds are `sqlite`, `filesystem`, `desktop-export`, and `cloud-control`; allowed ledger outcomes are `discovered`, `migrated`, `archived`, `quarantined`, and `intentionally_excluded`.
- [ ] Run the test; expect `migration bundle protocol checks passed`.
- [ ] Commit only the two protocol files as `feat: define vNext migration bundle protocol`.

### Task 2: Enforce path safety

- [ ] Write `scripts/vnext-migration/pathSafety.test.js` covering source/output equality, either path containing the other, drive-root output, case-insensitive Windows equivalence, CJK paths, missing input, and redacted path hashes.
- [ ] Run it; expect module-not-found failure.
- [ ] Implement `resolveExistingFile`, `resolveExistingDirectory`, `assertDisjointPaths`, `assertSafeOutputRoot`, and `summarizePath` in `pathSafety.js`. Resolve real paths when they exist, compare case-insensitively on Windows, never enumerate drives, reject filesystem roots, and store only SHA-256 path hashes plus caller-provided labels.
- [ ] Run the test; expect PASS.
- [ ] Commit as `feat: enforce migration path safety`.

### Task 3: Inventory SQLite read-only

- [ ] Write `sqliteInventory.test.js` with a temporary WAL database containing tables, primary keys, indexes, triggers, CJK values, BLOBs, and committed non-checkpointed rows. Capture source hash/mtime before and after. Add corrupt/missing/no-primary-key cases.
- [ ] Run it; expect module-not-found failure.
- [ ] Implement `inventorySqlite({dbPath, includeRowHashes})` using `new Database(dbPath,{readonly:true,fileMustExist:true})`, `query_only=ON`, and `quick_check`. Inventory `sqlite_master`, table columns, foreign keys, indexes, triggers, row counts, primary-key-set hashes, and canonical row hashes. Values feed hashes only; report no row plaintext. Represent BLOBs by bytes and hash.
- [ ] Run the test; expect PASS and unchanged source hash/mtime.
- [ ] Commit as `feat: inventory SQLite sources read-only`.

### Task 4: Inventory files with streaming hashes

- [ ] Write `fileInventory.test.js` with nested/CJK/empty/duplicate-content fixtures. Assert deterministic order, total bytes, per-file SHA-256, duplicate groups, unchanged sources, and default refusal to follow symlinks/reparse points.
- [ ] Run it; expect module-not-found failure.
- [ ] Implement bounded traversal and streaming SHA-256 in `fileInventory.js`. Store root-relative path hashes, safe extensions, byte size, mtime, and content hash; never store absolute paths. Mark files changed during scan as unresolved. Default max file count and total bytes must fail closed and be explicitly overridable.
- [ ] Run the test; expect PASS.
- [ ] Commit as `feat: inventory question files read-only`.

### Task 5: Discover only explicit sources

- [ ] Write `sourceDiscovery.test.js` proving that explicit `--db` overrides runtime config, empty values never resolve to the workspace, duplicate real paths merge safely, missing optional roots remain absent, and output contains only labels/path hashes.
- [ ] Run it; expect module-not-found failure.
- [ ] Implement `sourceDiscovery.js` for explicit runtime config, authority DB, question bank/assets, desktop export, and offline export roots. Never scan user directories or drive letters implicitly.
- [ ] Run the test; expect PASS.
- [ ] Commit as `feat: discover explicit migration sources`.

### Task 6: Write and verify bundles atomically

- [ ] Write `bundleWriter.test.js`. Assert writes begin in `<bundle>.partial`, final directory appears only after all reports/checksums validate, failures leave no final bundle, existing output is never overwritten, and tampering makes verification fail.
- [ ] Run it; expect module-not-found failure.
- [ ] Implement `bundleWriter.js`. An inventory-only bundle contains `manifest.json`, `reports/inventory.json`, `reports/migration-ledger.json`, `reports/unresolved.json`, and `checksums/sha256sums.json`. Write canonical UTF-8 JSON, read it back, verify hashes, then atomically rename. Do not copy DB rows or question files in phase one.
- [ ] Run the test; expect PASS.
- [ ] Commit as `feat: write atomic vNext inventory bundles`.

### Task 7: Add CLI, package scripts, and runbook

- [ ] Write `cli.test.js` as a process-level test for `inventory --db ... --files ... --output ... --json` and `verify --bundle ... --json`. Assert exit codes, JSON-only/redacted stdout, unchanged sources, and stable error codes for missing output, overlap, corrupt DB, and existing output.
- [ ] Run it; expect failure.
- [ ] Implement `cli.js` to serially invoke discovery, path safety, SQLite/file inventory, and bundle writing. `verify` is read-only. Print stack traces only with `GEWU_MIGRATION_DEBUG=1` in non-production environments.
- [ ] Add `vnext:migration:inventory`, `vnext:migration:verify`, and `test:vnext-migration` scripts to `package.json`; the test script runs every exact migration test.
- [ ] Write `docs/vnext-migration-runbook.md`: explicit sources/output, output outside repository/source/system roots, inventory-only behavior, verification, partial-bundle handling, redaction, and prohibition on committing bundles.
- [ ] Run `npm run test:vnext-migration`; expect all PASS.
- [ ] Commit as `feat: provide vNext migration inventory CLI`.

### Task 8: Integrated verification and real inventory-only dry-run

- [ ] Run `npm run test:vnext-migration`.
- [ ] Run `node backend/src/databaseImportSafety.test.js` and `node backend/src/services/authorityMigrationService.test.js`.
- [ ] Confirm the real runtime config and a new output root that is outside the repository, DB parent, question bank, and NAS source. Run `npm run vnext:migration:inventory -- --runtime-config <explicit-config> --output <explicit-new-dir> --json`.
- [ ] Verify `quick_check=ok`, source hashes/selected file hashes unchanged, no business payload copied, and no full paths/credentials/private keys in stdout or reports.
- [ ] Run `npm run vnext:migration:verify -- --bundle <bundle-dir> --json`; expect PASS.
- [ ] Write `docs/verification-2026-08-13-vnext-migration-foundation.md` with redacted labels/path hashes, counts, bytes, quick check, unresolved count, bundle hash, and limitations only.
- [ ] Update the vNext section of `task.md`, run `git diff --check` and `git status --short`, then commit and push.

## Phase-one gate

Source read-only behavior, unchanged source hashes, redacted inventory-only output, repeatable SQLite/file/checksum verification, safe handling of interruption/corruption/overlap/CJK paths, and a real redacted inventory report must all be proven. Phase two schema work must be derived from that evidence rather than guessed from legacy schema files.
