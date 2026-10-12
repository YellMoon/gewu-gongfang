# Desktop offline login repair

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

Release evidence is appended after deployment and OSS verification. Existing
unrelated working-tree documents and browser artifacts are preserved.
