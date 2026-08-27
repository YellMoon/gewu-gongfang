# Release Compatibility Matrix

## Rule

Desktop, cloud business service, NAS storage proxy, and the WeChat miniapp have independent semantic versions. A version increase in one component never rewrites another component’s package or lockfile.

Every formal deployment is instead gated by one reviewed protocol and data-compatibility declaration in `config/release-compatibility.json`. The release ledger records the source commit, all four component versions, that exact declaration, and a separately verified receipt for every target. It is generated under a path containing the complete component-version matrix and must not be hand-edited.

| Target | Version source | Required evidence |
| --- | --- | --- |
| `desktop` | root `package.json` | OSS installer and `latest.yml` match the desktop component version |
| `cloud_business` | `cloud-business-api/package.json` | backup, migration/restart, and health evidence match the cloud component version |
| `storage_proxy` | `storage-agent/package.json` | Docker-UI artifact and health evidence match the storage component version |
| `miniapp` | `miniapp/package.json` | WeChat development upload for compatibility; production receipt before a formal matrix is complete |

## Bumping and release order

1. Run relevant protocol/data contract tests. Choose the semantic increment for the component that changed.
2. Use the component command, for example `npm run version:bump:cloud-business:minor`. The four component families are `desktop`, `cloud-business`, `storage-proxy`, and `miniapp`.
3. Commit and push the changed component version. Run `npm run release:prepare`; it snapshots the independent versions and the reviewed compatibility declaration.
4. Deploy only the changed component, then record its receipt. A receipt must match that component’s version, not the desktop version.
5. Before publishing an OSS desktop update, cloud, storage, and miniapp must each have compatible verified receipts in the same ledger. Their version strings may differ.
6. `npm run release:complete` additionally requires the miniapp production receipt. A development upload remains partial.

### Storage proxy update policy

The NAS storage proxy is not rebuilt or switched merely because the desktop, cloud business service, or miniapp has a new version. Build a storage-proxy candidate only when its own change affects object storage, import parsing, media or artifact delivery, storage transport compatibility, or a security fix. A failed upload or deployment is retried with the same verified artifact; it is not a reason to increment the storage-proxy version. Keep the last verified rollback container until the replacement has passed its health and compatibility checks.

## Compatibility boundary

- Changes to a REST protocol, export protocol, storage transport, or business-data schema must first update `config/release-compatibility.json`, their contract tests, and every affected component’s release plan.
- Cloud business data remains cloud-write-authoritative. Desktop offline mutations stay drafts until user confirmation; miniapp retains only its approved limited task writes; NAS remains media/artifact-only.
- A failed target stays pending. Retrying it does not require another version bump. A changed artifact or changed compatibility declaration requires a new component release matrix.
- OSS rollback only changes the desktop feed; it does not claim a cloud, NAS, or miniapp rollback.

## Regression checks

```powershell
node scripts/update-version.test.js
node scripts/release-matrix.test.js
node scripts/independent-release-version.test.js
node scripts/release-matrix-python.test.js
```
