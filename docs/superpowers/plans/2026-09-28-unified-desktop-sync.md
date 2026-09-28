# Unified desktop synchronization implementation plan

Execute sequentially in the existing checkout; no subagents. User has specified
the interaction and authorized this correction. Status: implemented, tested and delivered; see docs/desktop-sync-2026-09-29.md.

Goal: silent online saves, one reconnect batch decision, one pending-only modal,
and reliable cloud address selection for course editing.

Architecture: retain encrypted native outbox and cloud REST authority. Share a
single scheduler/review surface; do not treat its visibility as synchronization.
Use existing business summaries for review; completed receipts stay in storage.
Refresh business projections independently from question pagination, with session
guards. Recover addresses proven by the teacher's historical courses/lessons,
including legacy name-valued references; never expose all unowned addresses.
Ownership-only address edit/delete permission remains unchanged.

Evidence: installed desktop is 8.9.16; new source baseline is 8.9.21. Public
production read-only query found nine active addresses whose historical courses
store address names in legacy_room_id rather than canonical room IDs. They have
no creator or exact-ID history links. Current teacher projection excludes them. Course
save turns a missing room ID into an address name and creates a local draft.
The scheduler also remains paused after conflicts are removed; merged online
drafts do not become offline when further edits happen offline.

## Steps and files

- [x] Extend cloud-business-api/sql/historical-room-scope.postgres.test.js with
  legacy historical links, unique names, tenant scope and unchanged edit/delete denial;
  run RED, then correct projection in cloud-business-api/src/app.js, run GREEN.
- [x] Add actual CourseList save-handler regression: cloud-only known address
  must resolve its existing ID, unknown existing ID cannot become a room name,
  new typed names are created only on save. Update CourseList.tsx accordingly.
- [x] Add cache regression for business refresh despite unavailable question
  page, while preserving atomic full question replacement and identity scope.
  Add a business-only refresh option in browserDatabase.ts and use it in course
  open/reconnect/background refresh without clearing existing question data.
- [x] Add native outbox merge regression: any offline edit taints its merged
  draft as requiring review, even if first created online. Update native runtime.
- [x] Replace permanent pause with current conflict/error state; add immediate
  online/draft-change triggers and current-session guards in DesktopAutoSync.
- [x] Make DesktopAutoSync own one modal. SyncQuickPanel becomes a normal Cloud
  Sync button; App cloud-sync navigation requests that modal without leaving
  the current editor. AuthorityOutboxPanel shows actionable items only, one
  batch submit, safe conflict controls and unresolved assets. No per-row submit
  confirmation or completed statistics. Extract reusable attachment helpers as
  needed so automatic submission also completes attachment transfer.
- [x] Test actual component and native bridge: online silent, offline no writes,
  reconnect opens once, single approval submits all reviewed rows, postpone,
  changed payload, dependencies, errors/conflicts, account switch, completed
  history hidden and scheduler resumes after resolved conflicts.
- [x] Verify rendered wide/narrow desktop and keyboard path with existing
  Ant Design/modal visuals. Record safe visual-check metadata and local evidence
  paths. Read-only compare historical-address projection against production records;
  use disposable fixtures for writes, preserve exact cleanup evidence.
- [x] Run full lifecycle regressions and typecheck; version/compatibility matrix;
  cloud database/code backup before deployment, deploy cloud and verify private/
  public health/permissions; build/verify desktop, publish OSS, download/hash,
  restore Node ABI; commit/push gewu/master and current task/evidence update.

Direction brief and rollback constraints are recorded in task.md. Existing
user-owned changes remain untouched. Do not claim formal miniapp release or
whole architecture completion from this correction.
