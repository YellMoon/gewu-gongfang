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
TypeScript checks pass. Broader root/cloud suites are still running at this point.

Prepared versions: desktop 8.19.1, cloud 8.18.3, NAS 8.9.2; miniapp remains 8.10.0
with unchanged reader and wire contracts. The release gate requires NAS 8.9.2
before publishing the desktop feed. The NAS image artifact is
`output/media-fix-20261011/gewu-storage-agent-8.9.2.tar`, SHA-256
`84ffbb4c6f8596b5231a5130b60e766cf80daa0791c9ef7d75ab05b7dbbc140f`.
Its actual image cloud-client regression passes with networking disabled.

Deployment and actual image download/render checks are pending. The user has
opened NAS in Edge, but browser automation currently fails to load the request
header policy and the native control runtime fails to write its kernel assets.
No NAS configuration or container has been changed. Retain the running 8.9.1
container as rollback when updating; verify candidate health and cloud runtime
receipt before stopping it. Do not claim the reported images are restored until
the real delivery download and display checks pass.
