# NAS 8.8.4 deployment — 2026-09-30

The pending NAS update was deployed through the existing logged-in UGOS Docker UI. This is an operational deployment of the previously built image, not a new desktop or cloud application release.

- Image: `gewu-storage-agent:8.8.4-570f96c1`.
- Archive: 74,350,592 bytes; SHA-256 `cb33a18c5417f47eadfdf824e8cbb897494687a7c231db2e40046af84631d840`.
- New container: `gewu-storage-agent-8.8.4-candidate`, started at `2026-09-30T03:01:50Z`.
- Preserved configuration: `存储空间1/GewuStorageAgent → /nas-storage` read/write, bridge network, no published ports, `unless-stopped`, and `node src/launch.js /nas-storage/agent.env`.
- NAS terminal health at `2026-09-30T03:03:34.698Z`: `ok=true`, version `8.8.4`, agent `nas-dx4600-agent`, `writableAuthority=false`; its write/read/checksum/cleanup storage probe passed.
- Cloud acknowledged parser bundle SHA-256 `958c2b0e7f292266141ff1eb4a17d30c234b4fc8bc8f928aadf5ab52817b3245`, exactly matching the read-only, network-disabled check of the actual release image. Protocols remain export 3, storage transport 3, parser proof 1.
- After candidate health passed, the previous `gewu-storage-agent-8.8.3-candidate` was stopped. Its container, image and persistent data remain available for rollback.

Before cutover, cloud read-only checks showed no storage, media-delivery or artifact-delivery tasks in flight. Seven imports awaiting source storage and three exports with no render lease are historical records last updated on 2026-08-28; this deployment did not modify or delete those records. These records are not evidence of a currently executing NAS task.

Evidence is in `output/operation-audit-20260930/`: `nas-before-cutover.json`, `nas-candidate-runtime.json`, `nas-final-runtime.json`, `nas-884-health.jpg`, `nas-884-cutover.jpg`, and `nas-deployment-result.json`. The existing frozen desktop release manifest retains its historical 8.8.3 compatibility receipt; the new NAS follow-up receipt records the actual deployment. The compatibility allowlist now includes the verified 8.8.4 runtime for future releases; protocol checks remain unchanged.

Desktop 8.10.0 remains published to OSS, cloud 8.13.0 remains deployed, and miniapp 8.8.27 remains a verified development upload, not a formal public miniapp release. The NAS update is complete; formal miniapp release is still separate.

Rollback: stop the 8.8.4 container and start the retained 8.8.3 container, then verify health and cloud runtime receipt. Do not delete either container or the storage directory.
