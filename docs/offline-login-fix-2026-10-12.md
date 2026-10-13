# Desktop offline login repair

Desktop 8.22.0 (2026-10-13) supersedes the separate offline-entry button below.
It uses the same account/password form for online and offline login, following
the user's explicit choice. The 8.20.0 notes remain a historical release record.

The cloud signed offline leases with the same one-hour expiry as online sessions.
An overnight restart therefore blocked a previously registered desktop account.
The desktop also lacked a cached-account entry from the password login screen,
and Chromium network errors wrapped by Electron were not all recognized.

Desktop 8.20.0 and cloud 8.19.0 negotiate `offlineLeaseVersion: 2`. Cloud signs a
separate 14-day lease; online tokens remain valid for one hour. Older clients omit
the option and retain v1 leases. The vault verifies the signature, account,
installation, role and maximum duration. No lease is extended locally. First
login still requires online verification. Local offline mutations remain drafts
requiring one batch confirmation after online revalidation.

Cached accounts can explicitly resume offline from the login screen. Cloud
session recovery times out after 10 seconds so an unresponsive connection can
fall back to a valid signed lease. Known cloud authorization rejection invalidates
the persisted offline lease. A read-only canonical PostgreSQL check distinguishes
ordinary online expiry from revocation without creating or renewing an expired
online session. No database migration, NAS or miniapp source change is required.

Verification:

- `npm run test:offline-login`: next-day restart, timeout, first-device denial,
  expiry, signature tampering, old-client compatibility, renewal, role switching,
  and persisted revocation pass.
- The same regression fails against the prior vault with
  `DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID`.
- `node shared/vnext-pg17/cloudDesktopSessionControl.postgres.test.js`: actual
  writer-role checks distinguish expiry from revocation; neither creates a session.
- Desktop renderer Chromium checks cover cached manual entry, offline cold start,
  expired lease and first-device states, with no page errors. Screenshots and
  `checks.json` are under `output/playwright/offline-login-20261012/`. These use
  isolated identity bridge fixtures; vault cryptography is checked separately.
- Typecheck and full-test logs: `output/offline-login-typecheck-20261012.log` and
  `output/offline-login-full-tests-20261012.log`.

Release source: `b651705dbb28be4859340507b3b5a49e6672633f`, pushed to `gewu/master`.
The full `npm test` completed with exit code 0. Focused affected checks were
rerun after the final source edits, including `npm run posttest`, typecheck,
cloud identity repository checks and actual PostgreSQL session controls.

Cloud 8.19.0 was deployed with no schema changes. Public/internal health,
permission contracts and retired gateway boundaries passed. The deployment
receipt is in
`output/release-matrix-desktop-8.20.0__cloud-business-8.19.0__storage-proxy-8.9.2__miniapp-8.10.0/active.json`.
Final permission checks passed in
`output/offline-login-cloud-final-contract-20261012.log`.

Pre-deployment backups:

- Code: `/root/scheduling-backups/cloud-code/20261012-043926/cloud-code.tar.gz`,
  SHA-256 `64ce02e69211310a6c4be52fd24ceac7aa2abbe0b70c3be48a88f60c07a1f6bc`.
- Database: `/root/scheduling-backups/postgres/20261012-045349/gewu_cloud.dump`,
  SHA-256 `d026d9405ee6c8c7e62149efe7b50a4e6ad97dd8446795963d4afec8d05039ac`.
  Isolated restore verified required schemas, ownership and privileges.

No disk-capacity check was performed before code-backup staging. The staging
and archive occupied additional space on an already near-full root filesystem.
The first database backup attempt encountered a full server root filesystem and
PostgreSQL recovery could not write its checkpoint. No new cloud service was
promoted in that attempt. A failed partial dump and disposable Docker build
cache were removed; the code tar archive was verified before its duplicate
extracted source copies were removed. Temporarily reducing ext4 reserved
blocks allowed PostgreSQL to recover, and the subsequent backup and deployment
passed. Old reproducible build inputs were archived locally before remote
cache removal. Tagged images, containers and valid backups were preserved.
Final reserve restoration and public health evidence are recorded below.

Miniapp 8.10.0 and NAS 8.9.2 executable inputs are unchanged. Their existing
verified receipts were retained with the exact source-delta evidence. Miniapp
receipt level remains development; no new miniapp production release is claimed.
Existing unrelated working-tree documents and browser artifacts are preserved.

Desktop 8.20.0 OSS release:

- `npm run dist:win` completed with exit code 0 from the clean managed checkout
  of the release commit, preserving unrelated dirty documents in the main checkout.
  Packaged Electron SQLite ABI checks and the final automatic Node dependency
  restoration passed, including real SQLite GC and question-bank tests.
- Actual packaged Electron startup, embedded Python `docx` import, Ruby runtime,
  and offline identity sources passed. Source comparison accounts only for Git's
  CRLF/LF checkout conversion. The initial runtime junction was replaced with
  real copied runtime files before the successful build.
- `npm run test:offline-login` passed again after packaging and Node restoration.
- `npm run publish:desktop-update` uploaded the installer and update feed.
  Public `latest.yml` equals the reviewed local feed; the publicly downloaded
  `GewuGongfang-Desktop-8.20.0-x64.exe` is 176458727 bytes and matches SHA-512
  `/wo+9TGM0IxUrNyYmnL11PRJbnDl+UtY8bryq70zjZnNu1i8hdnKURfryS1s9aOUMOU1xNmKotm1KudJR2YJHA==`.
- Feed: <https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/latest.yml>.
  Public download receipt: `output/offline-login-oss-verification-20261012.json`.
  Packaging/runtime evidence: `output/offline-login-desktop-build-final-20261012.log`,
  `output/offline-login-packaged-smoke-final-20261012.log`,
  `output/offline-login-packaged-runtime-20261012.json` and
  `output/offline-login-postpackage-tests-20261012.log`.
- The successful installer, block map and feed were retained in the main
  checkout's ignored `dist/` directory before the managed build checkout was archived.

Final server recovery evidence:

- 125 reproducible old build-input directories were archived to
  `output/offline-login-archived-build-inputs-20261012.tar.gz` before removing
  their remote cache copies. Archive size is 1259812889 bytes; SHA-256 is
  `a1d0f17048008b04467d7e4eccfe2e1c680ce47595e36cfddd8468b289e41be2`.
  The directory list and receipt are in the adjacent `.json` file.
- Original ext4 reserved block count 468496 was restored and independently
  asserted. PostgreSQL accepts connections and public cloud health reports
  `ok: true`, version 8.19.0, at `2026-10-12T05:45:44.801Z`.
  Receipt: `output/offline-login-cloud-final-health-20261012.json`.
- Root filesystem ordinary available space is 914 MiB after restoration.
  Capacity remains limited; subsequent deployment backups/builds require a
  capacity check before staging. Valid database/code backups, tagged Docker
  images and containers were retained.

## 2026-10-13: unified password login

The desktop now provisions an optional local password verifier only when cloud
password verification finishes signed desktop registration. It stores a random
32-byte salt and a 32-byte scrypt digest (N=32768, r=8, p=1) inside the existing
OS-encrypted vault; plaintext passwords are not persisted. Verification binds
the cached login type/identifier to the signed account. A different account
does not inherit another account's verifier; QR recovery for the same account
preserves its prior verifier. Online password login refreshes it.

Offline cold start and renderer reload show the usual password form. The same
submit action verifies the password locally when disconnected or after a
transport failure. Incorrect cloud credentials never trigger that fallback.
Locked accounts also use this form. The separate offline and passwordless
session-recovery buttons were removed. Existing authenticated sessions can
continue offline while their cloud-signed lease is valid.

First devices and older vaults without a verifier require one successful online
password login. Local verification does not issue a cloud token, extend the
14-day lease or grant cloud role elevation. Known revocation and expired leases
block access. Replaying a cached signed lease cannot authenticate a cold start.
Offline drafts retain the existing single batch-confirmation rule.

Focused signed-vault, real password REST registration, cold-start, role recovery
and expiry/revocation checks pass. Typecheck passes. Eight Chromium scenarios
cover teacher/admin entry, transport failure, incorrect password/account,
expired lease, old cache and first device. They use real signed leases and the
real vault/scrypt implementation with injected AES-GCM storage, not production
accounts or Windows DPAPI. Screenshots and checks are in
`output/playwright/offline-password-20261013/`.
Full `npm test` passed with exit code 0, including posttest. Affected signed-vault
checks were rerun after the replay guard, and the eight UI checks were rerun
after the final QR-button availability change. Logs are
`output/offline-password-full-tests-20261013.log`,
`output/offline-password-focused-20261013.log` and
`output/offline-password-ui-check-20261013.log`.
Automatic minor version classification and release-matrix checks passed.
OSS release evidence follows after publication.

Desktop 8.22.0 was published from source commit
`0e98a6028b90db40ac46aedd3f241f372bbad2d0`, pushed to `gewu/master`.
`npm run dist:win` completed successfully, verified both packaged Electron
database modules, restored both Node database modules and passed the restoration
checks. The affected offline-login tests also passed after packaging.
The packaged application passed its actual fresh-profile startup check; bundled
Python/Ruby worked and packaged identity sources matched the reviewed sources.
Evidence is in `output/offline-password-desktop-build-20261013.log`,
`output/offline-password-post-package-tests-20261013.log`,
`output/offline-password-packaged-smoke-20261013.log` and
`output/offline-password-packaged-runtime-20261013.json`.

OSS publication succeeded. The public `latest.yml` matched the local feed and
selected `GewuGongfang-Desktop-8.22.0-x64.exe`. A full public download matched
the feed size (176473992 bytes) and SHA-512:
`xLiAPf5jNEG4Vwmil5+cYnNKESnCPf24JWOcTA9XeMFJGMz7t8IWJICPFiySzj9frI9QDvHeI/15DcQ88kmENQ==`.
Feed: https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/latest.yml.
Receipts: `output/offline-password-oss-publish-20261013.log` and
`output/offline-password-oss-verification-20261013.json`.

The desktop-only contract was checked against unchanged executable sources for
cloud business 8.20.0, NAS/storage proxy 8.9.2 and miniapp 8.10.1. Existing
component receipts were retained; the public cloud health check passed.
The miniapp receipt remains development, so this is a desktop update, not a
claim that all components have a new production release.
Evidence: `output/offline-password-compatibility-20261013.json` and the
8.22.0 desktop release matrix.
