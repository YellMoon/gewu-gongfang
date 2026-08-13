# vNext migration inventory runbook

This tool inventories legacy desktop data before the cloud-authority migration. Phase one is read-only: it does not copy database rows, question files, credentials, or application configuration into the bundle.

## Safety rules

1. Stop application writes before a production inventory when practical. The SQLite connection is read-only and `query_only`, but a quiet source produces the clearest evidence.
2. Pass sources explicitly with `--db`, `--files`, or `--runtime-config`. The tool never scans home directories, drive letters, removable disks, or NAS mounts automatically.
3. Use a brand-new output path. Its parent must already exist. The output must be outside the repository, database directory, question-bank tree, NAS source, and removable-drive source.
4. Never commit an inventory bundle. Reports omit source paths and row values, but structural metadata and hashes are still operational evidence.
5. Keep the original database and files unchanged until cloud import, reconciliation, acceptance, and rollback-window closure are all complete.

## Inventory with explicit paths

PowerShell example:

```powershell
npm run vnext:migration:inventory -- --db "D:\data\scheduling.db" --files "I:\GewuQuestionBank" --output "C:\migration-evidence\inventory-20260813" --json
```

Runtime configuration can provide `mainDbPath`, `questionBankPath`, `questionAssetPath`, `desktopExportPath`, `offlineExportPath`, `localCachePath`, and `nasBackupPath`:

```powershell
npm run vnext:migration:inventory -- --runtime-config "C:\explicit-profile\gewugongfang.config.json" --output "C:\migration-evidence\inventory-20260813" --json
```

An explicit command-line source overrides the matching runtime configuration field. Empty configuration values are ignored; they never resolve to the current directory. Duplicate real directories are inventoried once.

Configured optional file roots that are currently offline (for example, a disconnected removable question disk) are recorded as redacted unresolved sources and do not prevent the online database, local cache, or NAS backup from being inventoried. An explicitly supplied missing path still fails immediately so typing mistakes cannot be silently accepted.

Optional bounds:

```powershell
--max-files 100000 --max-bytes 1099511627776
```

The output directory appears only after all payload JSON files have been written, read back, hashed, and verified. An interrupted attempt leaves `<output>.partial` as evidence and will not overwrite it on retry. Inspect and archive that directory before removing it manually.

## Verify an existing bundle

```powershell
npm run vnext:migration:verify -- --bundle "C:\migration-evidence\inventory-20260813" --json
```

Verification checks the manifest protocol, the exact payload file set, every SHA-256 checksum, the aggregate bundle hash, and closed coverage across logical source declarations, physical inventories, ledger entries, and unavailable-source records. It is read-only. Any changed, missing, added, or semantically inconsistent payload entry fails verification.

## Create and verify a recoverable SQLite snapshot

Create a brand-new external snapshot path:

```powershell
npm run vnext:migration:snapshot -- --db "D:\data\scheduling.db" --output "C:\migration-evidence\authority-snapshot.sqlite" --json
```

The command uses SQLite online backup from one established read transaction. It compares every source/snapshot table row count, primary-key-set hash, and canonical-row hash before atomically renaming the `.partial` snapshot. It checks free space, rejects overlap/reparse ancestors/existing or interrupted outputs, and never checkpoints or copies the source WAL/SHM files.

Verify the snapshot later with the hash returned by creation:

```powershell
npm run vnext:migration:verify-snapshot -- --snapshot "C:\migration-evidence\authority-snapshot.sqlite" --expected-hash "<sha256>" --json
```

Keep snapshot and source on separate failure domains before calling the snapshot recoverable. Phase 2 additionally encrypts/signs closed migration bundles and performs a real restore rehearsal; a single local copy is evidence, not a complete backup policy.

## Bundle contents

- `manifest.json`: bundle identity, mode, all logical source labels/kinds/path hashes, availability, and physical inventory mappings.
- `reports/inventory.json`: SQLite integrity/schema/count/hash evidence and filesystem count/size/hash evidence.
- `reports/migration-ledger.json`: phase-one `discovered` entries only.
- `reports/unresolved.json`: skipped reparse points, unsupported entries, or files changed during scanning.
- `checksums/sha256sums.json`: payload checksums and aggregate bundle hash.

No database row plaintext or question-file content is stored. Absolute paths are retained only in process memory long enough to open explicitly selected sources. Available SQLite sources are inventoried in one read transaction. WAL sources without an existing SHM file are rejected before opening; Phase 2 must create a controlled online-backup snapshot instead of relaxing this rule.

## Failure handling

The JSON error code is stable and deliberately contains no path. Stack traces are disabled unless `GEWU_MIGRATION_DEBUG=1` and the environment is not production. Do not enable debug output when collecting shareable evidence because dependency errors may include local paths.

If `quick_check` is not `ok`, foreign-key findings are unexpected, a source changes during scanning, bounds are exceeded, or verification fails, do not continue to migration. Preserve the original source and the redacted evidence, then diagnose before another attempt.
