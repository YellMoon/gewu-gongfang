# Runtime Architecture Reset

## Decision

Replace the current renderer-coupled desktop identity and notification-only host processing model with three explicit planes:

1. Cloud control plane: account identity, device grants, renewable device leases, durable commands, receipts, notifications, and host discovery.
2. Primary-host data plane: the sole authority for business records, role grants, role bindings, merges, exports, and scoped snapshots.
3. Client plane: ordinary desktop and miniapp UX, encrypted local cache, explicit command outbox, and read-only scoped projections.

## Non-negotiable boundaries

- An account has one immutable `user_id`. A role is a grant, not an account type.
- `visitor` is the default active role. `teacher` and `student` are additive application-backed grants. `admin` is never self-service. `super_admin` is bootstrap-only.
- Cloud login never queues work to the primary host. A local password unlocks a device key; the cloud independently issues or renews a device lease. The host validates a lease when executing a business command.
- WebSocket is a latency optimization only. Every command is durable and the host agent claims it by periodic polling as well as notification wakeup.
- Only the host writes canonical business data. The cloud retains commands, receipts, host-signed scope grants, and host-published read projections.
- No client directly replays database mutations. Offline edits are typed idempotent domain commands.

## Evidence from the current system

- The current schema has both a legacy scalar role on `users` and `user_role_grants`, while Gateway, Backend, miniapp, and desktop each still branch on legacy role fields.
- The current host wakeup was notification-only. A real cloud sync task was queued but not processed until the local host endpoint was invoked manually.
- A real desktop identity vault reported unlocked while the renderer remained outside the business runtime pending cloud-host session completion.
- Packaged role behavior depends on build metadata and runtime role. A host profile launched with an ordinary build was silently demoted to a desktop client and therefore did not start the embedded host backend.

## Canonical control records

`accounts(user_id, phone, status)`

`device_grants(device_id, user_id, public_key, host_generation, status, grant_version, approved_by)`

`device_leases(lease_id, device_id, user_id, grant_version, expires_at, revoked_at)`

`role_grants(grant_id, user_id, role, binding_kind, binding_id, status, granted_by)`

`role_applications(application_id, user_id, requested_role, binding_hint, status, reviewed_by)`

`host_commands(command_id, target_host_id, type, idempotency_key, payload_hash, status, claim_token, row_version)`

`host_receipts(command_id, result_hash, result_payload, completed_at)`

The host owns the authoritative copy of role grants and publishes a signed control-plane mirror. Old `users.role` and legacy bindings remain read-only compatibility inputs during migration, then cease to be authorization inputs.

## Command protocol

1. Client appends a domain command to its local outbox.
2. Client explicitly previews and submits the command batch to the control plane.
3. Host agent wakes through WebSocket or polling, claims commands with a lease, validates device lease and scope, then executes one database transaction with a backup marker.
4. Host writes a hashed receipt. The client applies only receipt-authorized projections and updates its outbox acknowledgement.
5. A retry never creates a duplicate because `(user_id, device_id, idempotency_key)` is unique.

## Migration order

1. Create additive control tables and a migration ledger.
2. Seed every existing account with a source-audited grant, never infer elevated privilege from a client request.
3. Introduce server-side access scopes and run parity tests against existing data.
4. Move host processing to the independent agent lifecycle and provide build-flavor diagnostics.
5. Move desktop login to local unlock plus cloud lease. Remove host session exchange from normal login.
6. Replace mutation sync with typed commands and receipts.
7. Add role application, asset-account ownership, scoped snapshot publishing, and miniapp visitor UX.
8. Run migration rehearsal on database copies, then real LAN and cloud relay tests before release.

## Success criteria

- A host task is eventually processed when WebSocket delivery is absent.
- A valid device can sign in when the host is temporarily unavailable; business writes remain unavailable until the host is reachable.
- A visitor sees at most ten question previews and no other user data, as verified by server-side queries.
- Student, teacher, admin, and super-admin data scopes are verified at the API, host command, ordinary desktop, and miniapp layers.
- Two packaged apps with isolated profiles prove LAN and cloud-relay binding plus bidirectional command delivery without manual local API calls.
