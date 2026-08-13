# vNext File Object Lifecycle Reference Plan

**Goal:** Freeze a pure state contract for question-file objects, storage receipts, independent verification receipts and multiple backup receipts before any NAS, removable-disk, cloud, Docker or production task implementation.

**Boundary:** `shared/vNextFileObjectLifecycleReference.js` is a deterministic in-memory state reducer. It has no filesystem, path, environment, network, database, Docker, NAS or removable-disk access. A `verified` state means only that a future trusted storage worker has supplied structurally consistent write and independent-read receipts; it is not evidence that a real file, a real backup, or a physical disk currently exists.

## State matrix

| State | Active queue task | Current store / verify evidence | Backup receipts | Retry |
| --- | --- | --- | --- | --- |
| `pending_upload` | absent | absent | absent | queue only |
| `storage_queued` | present | absent | absent | same queue replay only |
| `stored` | present | store present, verify absent | absent | store replay or verification |
| `verified` | present | store and independent verification present | zero or more | backup or inspection failure |
| `missing` / `failed_retryable` | absent | both historical store+verify evidence, or neither | historical backups only with historical primary evidence | a fresh, unused queue task clears the current snapshot evidence |
| `quarantined` | absent | same historical form as failure | historical backups only with historical primary evidence | prohibited |

Every state uses an exact presence matrix: a pending or queued object cannot smuggle a receipt, a stored object cannot smuggle verification, and a failure object cannot retain only half of a write/verification pair. A future durable audit/history model must preserve cleared prior receipts; this small current-state object intentionally does not pretend to be that history ledger.

## Receipt and replay rules

- The queue task owns one file ID, version, expected SHA-256 and byte count. Its store receipt must use that same task ID and must match the expected hash and length.
- Verification is a separate task. Its ID must differ from the storage task, must name the same opaque storage locator, and must independently report the expected hash and length.
- A queued/stored failure is bound to the current queue task. A `verified` inspection failure is bound to a separate inspection task ID that differs from all current primary and backup task identities; it cannot relabel a previously successful verification as a later inspection.
- A backup has distinct copy and verification task IDs, binds to the primary verification task and opaque primary locator, and uses an opaque backup locator. It cannot use the primary location and an object may contain multiple distinct backup locations.
- Locators are opaque references only (`sloc_…` and `bloc_…`); this syntax rejects path separators, drive-colons and credential-shaped values. The later trusted minting layer must make them random/non-reversible and must never encode a host, bucket, key or path in the identifier.
- Exact duplicate queue, store, verify, failure and backup events return the current frozen object. A changed event using an existing task identity is rejected. The queue/store/verify replays remain valid after their later lifecycle phase has completed.
- Missing or retryable failure reclaims with a **new, previously unused** queue task. It clears current write, verification and backup evidence so a new storage cycle cannot be confused with a prior one. Quarantine has no automatic release path.

## Strict input and non-goals

All public inputs are exact ordinary own-data records; accessors, symbols, unknown keys, coercible values, unsafe integers, invalid hashes, non-opaque locators and invalid storage classes are rejected. Returned objects and nested receipt arrays are deeply frozen.

This is not a file uploader, a backup copier, a NAS permission adapter, a cloud API, a Docker service, a deletion workflow, a retention system, a recovery process, a database schema, or an authorization mechanism. Those later writers must atomically persist task/audit history and independently establish that the actual source, primary storage and backup copies exist before they may use these receipt shapes.

## Verification

- [x] Focused lifecycle test covers valid transitions, exact replay/conflict, independent primary and backup verification, terminal inspection/retry, dual backups, deep freeze and hostile input rejection.
- [x] `npm run test:vnext-migration`
- [x] `git diff --check`
- [x] GPT-5.6-sol necessity audit: PASS/NARROW; the module remains the smallest Phase 6 pure-state prerequisite and does not access real storage or source data.
- [x] GPT-5.6-sol quality audit: PASS after hostile snapshot, task-identity, array/accessor, backup retry, terminal-state and locator boundary regressions.
