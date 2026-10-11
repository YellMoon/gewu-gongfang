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

NAS deployment and actual image download/render checks remain pending. The user has
opened NAS in Edge, but browser automation currently fails to load the request
header policy and the native control runtime fails to write its kernel assets.
No NAS configuration or container has been changed. Desktop `dist:win` is allowed
to prepare the installer; OSS publication requires the verified storage-proxy receipt.
The existing 8.19.0 OSS feed remains active. This is a partial release and does
not yet restore image display. Retain the running 8.9.1
container as rollback when updating; verify candidate health and cloud runtime
receipt before stopping it. Do not claim the reported images are restored until
the real delivery download and display checks pass.

Browser recovery needs the desktop app/browser connection restored. The last
Edge tab-list attempt still failed before any NAS page access. Official connection
troubleshooting includes restarting the browser and desktop app, and checking
the extension connection in Settings > Computer Use:
https://learn.chatgpt.com/docs/chrome-extension#troubleshooting.

Resume after the browser/native control connection is restored: use the user's
already-open Edge NAS page, import the verified 8.9.2 image, preserve mount,
network and configuration, health-check it, then stop the retained 8.9.1
container. Record the exact cloud runtime receipt; verify real downloads and
their SHA-256 values, then render the reported cards. Finally publish and verify
the 8.19.1 desktop OSS update using the attached clean release worktree.
