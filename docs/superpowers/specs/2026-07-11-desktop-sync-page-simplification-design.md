# Desktop Sync Entry and System Settings Consolidation Design

Date: 2026-07-11
Status: Approved by user

## Approved consolidation amendment

The standalone sync navigation page will be removed. Daily sync operation and sync configuration will be separated by frequency of use:

- The top application bar shows a real sync status entry. Clicking it opens a compact role-aware sync panel without leaving the current work page.
- Client devices see one explicitly bidirectional host-sync action plus plain-language explanation of preview, confirmation, upload, download, and merge.
- The primary host sees request/conflict management status and review entry points instead of a client-style sync action.
- System Settings contains sync configuration, diagnostics, directional operations, protocol details, and destructive maintenance controls.
- Legacy navigation to `cloud-sync` redirects to the sync section of `system-params` for compatibility.

## Problem

The desktop sync page exposes several peer-level actions and implementation details. Users must interpret upload, pull, bidirectional sync, CRDT, vector clocks, and maintenance controls before they can complete the normal workflow. The label "one-click sync" also fails to explain the direction of data movement.

## Goals

- Make the normal sync workflow understandable from the first viewport.
- Adapt the page to the configured device role.
- Reduce the client surface to one primary sync action.
- Preserve explicit authorization, preview, confirmation, queue retention, and conflict safeguards.
- Keep advanced diagnostics and directional operations available without presenting them as normal choices.

## Non-goals

- No changes to the sync protocol, CRDT/LWW behavior, authorization model, transport selection, cloud relay, or host authority.
- No silent background push of offline changes.
- No removal of maintenance or diagnostic capabilities.
- No redesign of unrelated desktop pages.

## Role-aware surfaces

### Desktop client

The first viewport contains:

1. Host connectivity state.
2. Pending local-change count.
3. Last sync result and time.
4. One primary action: `与数据主机双向同步`.
5. Supporting copy: `同步前先预览并确认；随后上传本机更改，再获取并合并主机最新数据。`

The confirmation dialog separates the preview into `上传到主机` and `从主机获取`. It also calls out deletion and high-risk counts. Cancelling changes no data and preserves the pending queue.

### Primary data host

The first viewport uses a management perspective:

1. Host/service state.
2. Pending sync-request count when available.
3. Pending conflict-review count.
4. A primary request-processing entry point.
5. A secondary conflict-review entry point.

The host surface must not imply that the host is an ordinary client syncing toward another authority.

## Advanced section

A collapsed `高级操作与系统详情` section contains:

- Upload-only action.
- Pull-only action.
- Engine reset with destructive confirmation.
- Client/device identifiers.
- Engine/version information.
- Vector clock and synchronized-table diagnostics.
- Protocol explanation.

Directional actions must use explicit labels. Engine reset remains visually destructive and separated from routine actions.

## Data flow

The client primary action continues to use the existing `runOneClickSync` behavior:

1. Select an available LAN-direct or cloud-relay transport.
2. Preview pending local and incoming host changes.
3. Ask the user to confirm when changes, risks, or offline-host conditions require it.
4. If the host is available, upload authorized pending local operations.
5. Pull host operations, merge them through the existing engine, and apply local data maps.
6. If the relay must queue the request, preserve the local queue and report that the request is waiting for the host.

## States and copy

- Loading: show a stable initialization state.
- No changes: explain that local data is current; the bidirectional action may still check for host updates.
- Host offline: explain that the request can be queued and local changes remain on this device.
- Waiting for host: show a non-success pending state, not "sync complete".
- Failed: state that pending local changes were retained.
- Conflict: surface the count and direct host users to review.
- Disabled: every disabled control must have an obvious reason in adjacent text or tooltip.
- Success: report uploaded, downloaded, and conflict counts separately.

## Layout and accessibility

- Use a calm, compact operations layout consistent with the existing Ant Design desktop shell.
- Keep one clear primary action per role.
- Avoid nested decorative cards and oversized typography.
- Support narrow desktop widths without clipped controls or tables.
- Preserve keyboard focus, button labels, loading indicators, and destructive confirmation.
- Do not add controls or status claims that lack a real route, API, task type, permission, field, or implemented workflow.

## Verification

- Add focused tests for role selection and user-facing action wording where practical.
- Run relevant sync service tests and the production build.
- Verify the rendered route in the desktop/browser runtime for client and host roles when runtime configuration can be exercised safely.
- Capture desktop and narrow screenshots.
- Check page identity, meaningful content, framework overlays, console errors, primary interaction, confirmation content, disabled/empty behavior, and responsive layout.

## Acceptance criteria

- A desktop client sees no more than one routine primary sync button in the first viewport.
- The primary button explicitly communicates bidirectional synchronization with the data host.
- Its supporting copy explains upload followed by download/merge.
- The preview distinguishes upload and download counts before confirmation.
- The primary host sees management/review actions instead of the client sync action.
- Advanced and destructive controls are discoverable but not presented as routine peer actions.
- Existing authorization, queue preservation, conflict handling, and transport behavior remain unchanged.
- Relevant tests, build, and rendered UI verification pass before completion is claimed.
