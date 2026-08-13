# Source recovery package verification record

Date: 2026-08-13

Scope: synthetic-only verification. No source desktop data, NAS, removable drive, cloud database, cloud API, package build, or deployment was read or modified.

Evidence:

- `node scripts/vnext-migration/sourceRecoveryPackage.test.js` passed. It creates a temporary SQLite/WAL source, temporary desktop metadata, and temporary question file; rejects missing source-exit confirmation; detects a source-tree change; rejects unexpected package entries; creates a recovery package; checks copied hashes; restores into a new directory at the original database-relative layout; and rejects reuse of the restore destination and source/output overlap.
- `node scripts/vnext-migration/cli.test.js` passed. It verifies explicit CLI paths, exact `--application-exited yes` acknowledgement, verification, restore, no source-path output exposure, and rejection of an invalid acknowledgement.
- `npm run test:vnext-migration` passed with recovery, SQLite snapshot, path-safety, inventory, and other pre-existing bundle tests. Pre-existing signing and encryption tests do not sign or encrypt a source recovery package.
- `git diff --check` passed.

Limitations:

- No real source package has been received or examined yet.
- The package is a preservation and restore artifact, not an authorization migration or cloud import.
- Separate question files are included only when an explicit source path is supplied; their actual path must be read from the source runtime config after receipt.
- The current recovery package is plaintext and self-verified only. It must remain on a controlled local medium until an approved encrypted transfer and independently retained expected hash/signature process exists.
