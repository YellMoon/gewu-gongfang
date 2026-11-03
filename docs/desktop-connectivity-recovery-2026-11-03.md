# Desktop connectivity recovery correction (2026-11-03)

Desktop patch 8.34.2 follows Qoder source db1c85e2. Cloud 8.33.0,
storage proxy 8.10.0 and miniapp 8.20.4 sources/protocols remain unchanged.

- Explicit cloud authorization/device rejection now invalidates the local lease
  and locks the business UI, including background and manual session recovery.
  Network outages continue to retry without discarding valid offline drafts.
  Concurrent connectivity events share one renewal; unmounted watchers stop retrying.
- Startup still renders cached workbench data before the cloud projection resolves.
  Projection notifications update personal-asset legacy data in place, preserving
  the mounted finance panel, selected file, reviewed preview and form state.
- Both finance refresh/reconnect buttons recover the identity session before
  fetching ledger/mailbox data. Repeated clicks and session-ready/online events
  coalesce; a rejected recovery performs no finance reads. No duplicate title added.

Verification before packaging:

- TypeScript no-emit check; identity gate/client and offline-login suite passed.
- Finance TSX runtime: 34 tests passed, including reconnect ordering, coalescing,
  retained reviewed file, denial and late callbacks after unmount.
- Actual React reconciliation in Chrome: personal-assets state survives projection
  notifications, manual refresh still resets explicitly, and navigation renders
  while the startup cloud projection remains pending.
- Actual Electron finance/mailbox flow: 17 checks passed at 1280/820 window sizes,
  no browser/runtime errors. Synthetic fixtures only; no production bill writes.
- Release matrix, independent-version and Python release-matrix checks passed.
- Public cloud health and SSH authority/permission contract checks passed;
  fresh NAS 8.10.0 heartbeat/parser evidence matched the unchanged source contract.
  Miniapp retains the original 8.20.4 development-upload receipt; no new miniapp
  build, upload, cloud deployment, NAS deployment or formal WeChat release claimed.

Broader checks are not fully green: npm test stops at unchanged
ScheduleInteraction.browser.test.cjs:118 (time-option list empty; isolated retry
also fails). test:desktop-layout stops at unchanged DataPageLayout.modal.test.js
(SchoolManager baseline predates its alliance fields). Those files and their
product components were not changed by this correction. Their failure logs are
retained under output/desktop-connectivity-20261103; no full-suite pass is claimed.

Release execution, artifact hashes and restored Node ABI results are recorded in
output/desktop-connectivity-20261103 after packaging. Overall multi-end status
remains partial because miniapp is a development upload, not a formal release.
