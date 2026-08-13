# Source-machine recovery package runbook

Use this procedure before any cloud migration when a desktop computer holds the only real Gewu Workshop data. The recovery package is a local preservation artifact with a manifest and SHA-256 integrity checks. It is not encrypted, signed, or safe to upload or send through an unapproved channel. It is not a cloud import, and it never turns copied sessions, device records, keys, tokens, challenges, or offline licenses into valid new-system credentials.

## Preconditions

1. Exit Gewu Workshop completely on the source computer. Confirm no Electron or `node` process belonging to the app remains in Task Manager.
2. Identify the exact paths. Do not guess them and do not use a repository, NAS root, or the source directory as the output location.
   - `--user-data`: the application user-data directory. Identify it first by looking for `gewugongfang.config.json`.
   - `--db`: the exact `mainDbPath` from `gewugongfang.config.json`; without an override it is `<user-data>/data/scheduling.db`.
   - `--question-files`: optional exact `questionBankPath` from the same config. Do not provide it until the disk is connected and has sufficient read access.
   - `--output`: a new directory under an external/transfer drive with enough free space for all copied data plus a SQLite snapshot.
3. Do not put the output under any selected source path. The command rejects overlap and existing targets.

## Create the package

PowerShell example without a separate question disk:

```powershell
npm run vnext:migration:recover-package -- `
  --db "C:\source-user-data\data\scheduling.db" `
  --user-data "C:\source-user-data" `
  --output "F:\GewuTransfer\source-recovery-20260813" `
  --application-exited yes --json
```

When `gewugongfang.config.json` has a separate `questionBankPath`, add it exactly:

```powershell
--question-files "E:\GewuQuestionBank"
```

The command uses SQLite online backup to create `database/scheduling.sqlite`, copies the remaining user-data files and optional question files, records both explicit-empty and not-provided question roots, hashes every copied payload with SHA-256, writes a manifest, verifies the package, and only then atomically renames its `.partial` directory. It rejects source changes detected across the database contents and complete file trees. On interruption it preserves `<output>.partial` with a `FAILED` marker for inspection; never delete it automatically.

## Verify and restore rehearsal

Verify the received or copied package before relying on it:

```powershell
npm run vnext:migration:verify-recover-package -- `
  --package "F:\GewuTransfer\source-recovery-20260813" --json
```

Then restore it to a new empty directory on a different local/transfer location:

```powershell
npm run vnext:migration:restore-recover-package -- `
  --package "F:\GewuTransfer\source-recovery-20260813" `
  --output "G:\GewuRestoreCheck\source-recovery-20260813" --json
```

The restore command verifies every payload and the SQLite snapshot before copying, restores desktop files beneath `user-data`, restores the database at its original user-data-relative location (or an explicitly labeled external-database path), verifies each restored payload, and atomically promotes its `.partial` directory. A successful package creation without a successful empty-directory restore is only a collected package, not verified rollback evidence.

## After successful recovery

1. Keep the original source computer unchanged and retain the recovery package for the whole migration and observation period.
2. Create a separate disposable working copy from the verified package for data dictionary and migration-rehearsal work.
3. Do not point a development server, cloud service, or a new desktop build at the original package or source computer.
4. Do not upload, email, or send the package to cloud storage. The current command has no encryption, signature, or independently pinned expected hash. Any future transfer requires an approved encrypted container and separately retained expected package hash (preferably also a signature).
