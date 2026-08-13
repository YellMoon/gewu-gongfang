# Source recovery package verification record

Date: 2026-08-13

Scope: synthetic verification plus one controlled local source-copy preservation and empty-directory restore rehearsal. No NAS, removable drive, cloud database, cloud API, package build, or deployment was accessed.

Evidence:

- `node scripts/vnext-migration/sourceRecoveryPackage.test.js` passed. It creates a temporary SQLite/WAL source, temporary desktop metadata, and temporary question file; rejects missing source-exit confirmation; detects a source-tree change; rejects unexpected package entries; creates a recovery package; checks copied hashes; restores into a new directory at the original database-relative layout; and rejects reuse of the restore destination and source/output overlap.
- `node scripts/vnext-migration/cli.test.js` passed. It verifies explicit CLI paths, exact `--application-exited yes` acknowledgement, verification, restore, no source-path output exposure, and rejection of an invalid acknowledgement.
- `npm run test:vnext-migration` passed with recovery, SQLite snapshot, path-safety, inventory, and other pre-existing bundle tests. Pre-existing signing and encryption tests do not sign or encrypt a source recovery package.
- `git diff --check` passed.

Controlled local source-copy rehearsal:

- A source copy supplied by the operator was read only. The original copy was not modified.
- A package with 67 payload files was created under a separate local recovery directory, verified, and restored into a new empty directory. Package hash: `753dd5186bbf65e3e5361a9ab9792dd02a8d2d2a24684ebab44aa9048c0261d4`. SQLite snapshot hash: `e5653c797c1dec544b83fe1c137d23ae398a0e8c9f548cd27f51bd1c8fc0ddae`.
- The restored SQLite inventory has 99 tables and 2,551 total rows. `questions` and `question_contents` each have 80 rows; `question_assets` has 911 rows. The personal-asset tables (`asset_accounts`, `personal_asset_categories`, and `personal_asset_records`) each have 0 rows.
- The source runtime config has no configured question-bank, question-asset, or NAS backup path. This proves only that no separate file root was configured; it does not mean the SQLite question data was empty.

Limitations:

- The package is a preservation and restore artifact, not an authorization migration or cloud import.
- Separate question files are included only when an explicit source path is supplied; their actual path must be read from the source runtime config after receipt.
- The current recovery package is plaintext and self-verified only. It must remain on a controlled local medium until an approved encrypted transfer and independently retained expected hash/signature process exists.
