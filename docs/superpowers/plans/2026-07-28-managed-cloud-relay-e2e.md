# Managed Cloud Relay E2E Migration and Verification

## Scope and guardrails

- Replace the cloud relay with one managed-host-credential architecture. Do not preserve the legacy shared-token, single-user, or dual-authentication paths.
- Use a separate cloud backend process and database: a cloud database may have only one active primary-host epoch, so this test must never claim or mutate the production host.
- Use two fresh temporary desktop profiles, synthetic address records, and a temporary test identity. Do not copy, read, or show a production token.
- Preserve the existing sidebar design. Test automation may expand and collapse it only to reach existing UI controls.

## 1. Authentication contract and tests

1. Trace the cloud relay host-authentication and renderer request-header paths.
2. Add tests first: no runtime configuration, local call, HTTP request, WebSocket handshake, task assertion, or deployed environment may depend on a desktop sync token.
3. Consolidate host authentication around the safe-storage credential, active epoch, and generation. A host WebSocket uses authenticated upgrade headers, never a credential in a URL query string.
4. Replace shared-secret relay assertions with a cloud-verified, task-bound execution grant: the host verifies an actor through the cloud using its managed credential before applying a task.
4. Run affected service, backend route, and Electron runtime contract tests.

Acceptance: no shared desktop relay secret exists in desktop configuration or the normal deployment environment; diagnostics distinguish missing managed identity from rejected credentials and expired task grants.

## 2. Isolated relay environment

1. Add a named `relay-e2e` deployment environment with its own remote directory, database, port, and PM2 process name.
2. Snapshot only its own database before deployment; a first run creates an empty test database.
3. Add a narrowly scoped, short-lived test-identity bootstrap usable only for this environment. It creates test identity state; the desktop windows still perform actual login, primary-host activation, pairing, and synchronization through visible UI.
4. Add status and cleanup commands and check the isolated health/version/database contract after deployment.

Acceptance: the test relay independently starts and passes health checks; no production database, PM2 process, or host epoch is read or changed.

## 3. Real Electron cloud-relay E2E

1. Generate fresh host and ordinary-desktop profiles pointing only to the isolated cloud relay, with no static shared token.
2. Launch the host package and use the visible identity/device page to log in and bootstrap/activate primary-host identity.
3. Launch the ordinary package, pair through the visible pairing UI, and deliberately use an unreachable LAN endpoint so this must traverse the cloud relay.
4. Create a synthetic record on the ordinary desktop, confirm sync in UI, and verify it at the host. Then create one on the host, sync, and verify it in the ordinary desktop address UI.
5. Retain screenshots, network mode, UI result text, and read-only test-data evidence. Never retain secrets, tokens, real endpoint values, or test passwords.
6. Stop applications and remove only the generated profiles and isolated test records/identity/epoch.

Acceptance: two actual Electron windows complete cloud pairing, identity/device online-binding confirmation, and one synchronization in each direction without LAN success being used as evidence.

## 4. Regression and release gate

1. Run targeted tests, full tests, Electron native-ABI checks, and package runtime contracts.
2. Review current OpenCode changes and remote pull requests without overwriting unrelated dirty work.
3. Only after cloud UI E2E passes: version, build, OSS-feed publish, and push `gewu/master`.
4. Verify feed metadata, installer version, and post-build Node native dependency recovery. Report any non-published platform as partial release, not full release.
