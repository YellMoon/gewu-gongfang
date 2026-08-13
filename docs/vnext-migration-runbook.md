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

Verification checks the manifest protocol, the exact payload file set, every SHA-256 checksum, and the aggregate bundle hash. It is read-only. Any changed, missing, or added payload entry fails verification.

## Bundle contents

- `manifest.json`: bundle identity, mode, source labels, source kinds, and path hashes.
- `reports/inventory.json`: SQLite integrity/schema/count/hash evidence and filesystem count/size/hash evidence.
- `reports/migration-ledger.json`: phase-one `discovered` entries only.
- `reports/unresolved.json`: skipped reparse points, unsupported entries, or files changed during scanning.
- `checksums/sha256sums.json`: payload checksums and aggregate bundle hash.

No database row plaintext or question-file content is stored. Absolute paths are retained only in process memory long enough to open explicitly selected sources.

## Failure handling

The JSON error code is stable and deliberately contains no path. Stack traces are disabled unless `GEWU_MIGRATION_DEBUG=1` and the environment is not production. Do not enable debug output when collecting shareable evidence because dependency errors may include local paths.

If `quick_check` is not `ok`, foreign-key findings are unexpected, a source changes during scanning, bounds are exceeded, or verification fails, do not continue to migration. Preserve the original source and the redacted evidence, then diagnose before another attempt.
