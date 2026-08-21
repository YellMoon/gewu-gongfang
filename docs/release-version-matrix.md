# Unified Release Version Matrix

## Rule

One user-facing release has one `Major.Minor.Patch` version. The unified desktop installer, Backend, Gateway, and the WeChat miniapp development build must all use that exact version. There is no separate local-host installer target. If any required endpoint has no same-version receipt, the release is **partial**, never complete.

The source of truth is the root `package.json`. `scripts/update-version.js` synchronizes the root, Backend, Gateway, lockfiles, and generated desktop version. The generated local manifest at `output/release-matrix/active.json` is the runtime release ledger: it contains the source commit, the single version, and exact receipts. It is not a second version source and must not be hand-edited.

| Target | Required evidence |
| --- | --- |
| `desktop` | OSS installer and `latest.yml` uploaded, with an exact feed version |
| `backend` | Backup, migration/restart, then exact `/api/health` version |
| `gateway` | Backup/restart, then exact Gateway health version |
| `miniapp` | Successful WeChat development upload; this is not review submission or production publication |

## Required order

1. Run compatibility tests and select exactly one semantic bump with `npm run version:bump:major|minor|patch`.
2. Commit and push the synchronized source version.
3. Run `npm run release:prepare`. It refuses a root/Backend/Gateway mismatch and creates the one release ledger.
4. Run `npm run dist:win`. Packaging reads the ledger and cannot bump the version again.
5. Deploy Backend and Gateway. Each script creates its normal backup, verifies the exact health version, then records its receipt.
6. Run `npm run miniapp:upload`. The upload refuses a manual `--version` that differs from the ledger and writes the miniapp receipt only after success.
7. Publish OSS with `npm run publish:desktop-update`; it refuses to update the unified desktop feed until Backend, Gateway, and Miniapp have exact-version receipts. The successful feed and installer upload records the desktop receipt.
8. Use `npm run release:status`, then `npm run release:complete`. Completion requires all four exact-version receipts.

## Failure and rollback boundary

- A failed endpoint stays pending. Fix the environment and retry with the same manifest and version; never create a second bump merely because a retry occurred.
- A verified endpoint cannot be published again under the same version. A different artifact requires a new release version.
- `npm run publish:desktop-rollback -- --rollback=<archived-version>` changes only the OSS desktop feed. It does not claim that cloud services or miniapp builds were rolled back.
- A successful miniapp development upload must be reported as a development upload, not as review approval or production release.
- No endpoint may be called directly for a formal release without its release-manifest gate.

## Regression checks

```powershell
npm run test:release-matrix
node scripts/check_deploy_readiness.js
npm run miniapp:release-check
```

Post-release evidence must include the live OSS feed, Backend health, Gateway health, and WeChat upload receipt. Git state or a local build is not substitute evidence.
