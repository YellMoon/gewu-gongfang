# Question image delivery compatibility repair

The two reported physics diagrams reference verified cloud asset records. The
newer desktop relay records use `asset_` IDs, while the cloud delivery serializer
and NAS lease validator accepted only `question_asset_` IDs. The latest verified
records were therefore selected and rejected with HTTP 503 before file delivery.
The deployed cloud serializer reproduced the rejection for a real relay ID and
accepted the original import ID; evidence is in `output/media-diagnosis-20261011123937942/`.

Both validators now accept those two existing ID families with the same bounded
character and length restrictions. Asset IDs and stored bytes are not rewritten.
Regression tests cover import and relay IDs through request, export request,
NAS lease and status, plus malformed, empty and excessive-length rejection.
Both new regressions failed before the fix and pass afterward. NAS full tests,
cloud delivery/authorization tests, version tests, release matrix tests and
TypeScript checks pass. The full cloud suite also passes. The root suite passed
through its production/SQL/browser checks but stopped at an old exact-version
release fixture; that fixture was updated and the release checks and all remaining
root checks were rerun successfully. The original root `npm test` exit was 1;
this is component coverage plus a successful targeted continuation, not a claim
that the original command exited successfully.

Prepared versions: desktop 8.19.1, cloud 8.18.3, NAS 8.9.2; miniapp remains 8.10.0
with unchanged reader and wire contracts. The release gate requires NAS 8.9.2
before publishing the desktop feed. The NAS image artifact is
`output/media-fix-20261011/gewu-storage-agent-8.9.2.tar`, SHA-256
`84ffbb4c6f8596b5231a5130b60e766cf80daa0791c9ef7d75ab05b7dbbc140f`.
Its actual image cloud-client regression passes with networking disabled.
The non-secret NAS update card is saved as
`output/media-fix-20261011/nas-gui-release-plan.json`.

The desktop 8.19.1 installer was built in the clean attached worktree. Its
packaged Electron SQLite checks pass for both root and backend (ABI 119).
Installer size: 176429476 bytes. SHA-512 (base64):
`dBAhhBU7BtQqpRcb9Qb+l2dgbe6+6sA9lYJZHaebkZty+5MBHGWqiDRrgKfJe24ZesOSH/Z7GY6nA+2vYTk76w==`.
Artifact evidence is `output/media-fix-20261011/desktop-build-evidence.json`.
The first build stalled downloading Python and was stopped at that downloader;
the Node restoration checks passed. The successful installer attempt reused the
existing Python 3.11.9 runtime after verifying its version and python-docx import.
The final `npm run dist:win` exited 0, including Node native restoration (ABI 137
for root and backend), SQLite GC/teardown checks and questionBankService tests.

Cloud 8.18.3 was deployed from source commit `87ce63a0ae3c` on 2026-10-11.
The pre-deployment database backup is `/root/scheduling-backups/postgres/20261011-130355`,
SHA-256 `c907cdd4391079b1aff2b5a51548d3e058fa97f98196d023fd2c7628077d3878`;
restore, ownership and privilege verification passed. Candidate, internal/public
health, authority contracts and retired-gateway checks passed. The cloud receipt
is in the active 8.19.1/8.18.3/8.9.2/8.10.0 release matrix in the attached
`media-delivery-release` worktree. Real requests for both reported image hashes
now return HTTP 202 with the actual `asset_` record, instead of HTTP 503.
Evidence: `output/media-diagnosis-20261011130647462/checks.json`.

NAS 8.9.2 was deployed through the Codex in-app browser after the user logged in.
The verified image tar was imported and container `gewu-storage-agent-8.9.2` was
created with the existing read-write `/nas-storage` mount, bridge network, no
published ports, `unless-stopped` restart policy and
`node src/launch.js /nas-storage/agent.env` command. The existing configuration
file was reused. The health CLI returned `ok: true`, version 8.9.2 and
`writableAuthority: false` at 2026-10-11T14:07:33.065Z. After candidate validation,
the old 8.9.1 container was stopped and retained for rollback. The new container
is running; evidence is `output/media-fix-20261011/nas-container-switch.png`.

The storage release matrix records actual cloud runtime receipt
`storage_runtime_receipt_15fcacdb-2783-4734-846e-9e3231214b77` with parser SHA-256
`9947e65ae3241aa9638aed9a0b1dcaaf1b2edae795344355a9e258bd4102c6ad`, matching
the parser in the actual Docker image. A subsequent query of the latest receipt
for the agent, without filtering by version, also returned 8.9.2:
`storage_runtime_receipt_de44c586-99de-425f-8930-5e8d315872dd` at
2026-10-11T14:19:58.334118Z. Evidence:
`output/media-fix-20261011/nas-runtime-receipt.json`.

Both reported diagrams now reach `ready` and download with HTTP 200:

| Question | Bytes | SHA-256 |
| --- | ---: | --- |
| 37504a5a-1925-4233-b208-0f9ce797f056 | 71471 | 640b79fddee2aacc1c41e40268d594a392f56c96e94cc10ca7696d12a71de60e |
| 7e7dbdc2-2eaf-42c6-bd40-e6c985eeefd3 | 66072 | e6851f434531d6eca33ff44db5fe124d2c7a0aac3288cc298bff8e9d0d078620 |

The downloaded hashes exactly match the cloud content identities. The normal
desktop identity client then independently fetched both images for the real
`QuestionPreviewCard`, `RichAssetImage` and `questionAssetStore` components,
using an authenticated loopback adapter without exposing credentials to the
browser. The two original cloud question records were rendered in the in-app
browser. Both images decoded successfully (1187x1225 and 2000x1380 pixels), and
the page had zero loading or failure messages. This verifies the actual card
components and production cloud/NAS transport; it does not claim that the user's
already-open installed desktop window was refreshed automatically. Evidence:
`output/media-diagnosis-20261011141437966/checks.json`,
`output/media-fix-20261011/real-card-render/asset-download-proof.json`,
`output/media-fix-20261011/real-card-render/render-report.json` and
`output/media-fix-20261011/restored-question-images.png`.

Desktop 8.19.1 OSS publication completed with HTTP 200 for the installer, archived
installer, archived feed and public `latest.yml`. Public feed version, installer
size and SHA-512 were verified, including a complete download of the 176429476-byte
public installer and the archived feed. Evidence:
`output/media-fix-20261011/oss-verification.json`. Post-publication Node SQLite
GC and teardown verification passed. The miniapp remains the unchanged 8.10.0
development upload; no new miniapp source was required for the asset ID repair.
The matrix is therefore not a claim of a miniapp production release.
