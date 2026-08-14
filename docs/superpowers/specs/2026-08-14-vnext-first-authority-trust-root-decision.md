# vNext First-Authority Trust-Root Decision

Status: owner decision recorded; implementation remains limited to reviewed isolated reference contracts.

## Decision required

Before any vNext authority, initial account, initial device link, first `super_admin` role, or first policy publication can be created, the owner must select the human trust root that proves who may perform that one-time action.

This decision cannot be inferred from an old database flag, desktop installation, old device record, local session, phone number, hardware fingerprint, data-host role, recovery package contents, or source-machine possession. Those may be retained only as archival or human-review evidence.

This project is **single-authority at bootstrap**: an empty vNext control-plane deployment may create exactly one authority in its lifetime. A second authority is not a second bootstrap opportunity. Future multi-authority support requires a separately designed tenant-provisioning authority and cannot reuse this ceremony.

## Owner decision

The owner selected a single-operator model:

1. On a new, empty vNext deployment, the owner personally performs the one-time initialization from the prepared deployment computer.
2. The computer is not trusted merely because it claims a device ID, hardware fingerprint, localhost address, or old installation record. Before service start, deployment configuration fixes the intended installation public-key fingerprint on the server side. The bootstrap verifier requires a valid signature by that installation private key over a server-generated, intent-bound statement; a caller cannot satisfy this condition by copying the public fingerprint.
3. First initialization atomically creates the sole authority, the owner's first account and device link, the first `super_admin` role, and an explicit policy publication. It becomes permanently unavailable after success.
4. This decision includes no recovery secret, telephone confirmation, phone application, second administrator, legacy credential, recovery package, or hidden system administrator.
5. If the owner later loses all super-admin access, recovery is a separately authorized server-maintenance operation. It creates a replacement owner super-admin, revokes every existing active super-admin grant and every active session for that authority, and preserves all business data.

## Frozen bootstrap invariants

- A deployment-provisioned verifier returns only a closure-branded opaque bootstrap assertion. It never returns a role, capability, raw secret, password, one-time code, private key, token, or user-controlled identity claim.
- The verifier checks an installation-private-key signature over a server-generated nonce and statement bound to one short-lived `bootstrap_intent_id`, authority identifier, account identifier, device identifier, installation public-key fingerprint, explicit policy-manifest hash, purpose, expiry, and approval version. The raw signature, nonce, and private key never enter an assertion, receipt, or audit event. The assertion cannot be redirected to another target.
- A successful ceremony is permitted only while the whole control-plane deployment has no authority. It atomically creates its sole authority, initial account, trusted device, installation, account-device link, sole initial `super_admin` role grant, explicit canonical V4 policy publication, command receipt, audit event, and outbox intent.
- A deployment-global append-only bootstrap-consumed marker is absent before the ceremony and written in the same transaction as success. Bootstrap requires both zero authorities and an absent marker. The marker can never be updated or deleted, so damage or deletion of authority rows cannot reopen bootstrap.
- The initial policy is an explicitly supplied, canonicalized and hash-pinned manifest. `DEFAULT_POLICY_MANIFEST` is never an automatic fallback or seed.
- The deployment-bound approval is short-lived, single-use, CAS/idempotency protected, audited, and permanently unavailable for that authority after success. Replays return the durable receipt only; a changed request with the same idempotency key is rejected.
- All later role, device, policy, session and authorization changes require normal trusted-session AccessContext checks. There is no system administrator, development bypass, first-call exemption, legacy-admin mapping, host-only bypass, or client-supplied session/role/device claim.
- No legacy session, token, challenge, host epoch, host key, old device authorization, recovery package metadata, phone number or hardware fingerprint becomes an active vNext credential or grant.

## Frozen emergency-recovery invariants

- Emergency recovery is not a second bootstrap and never creates a second authority. It operates only on an existing authority.
- Every recovery is bound to one authority, replacement account, replacement installation public-key fingerprint, event identifier, expiry, and reason. It requires a fresh, deployment-side, closure-branded opaque recovery assertion; there is no permanent recovery credential, Codex bypass, localhost bypass, or hidden system administrator.
- Before a real recovery operation, the owner must explicitly authorize that specific event. The future production runbook must create and verify a restorable control-plane backup before changing records.
- A successful recovery is one transaction: capture the active-super-admin and active-session sets; revoke every captured super-admin grant by CAS; create one fresh recovery grant for the assertion-bound replacement account; and require that the final authority state has exactly one active `super_admin` grant on that replacement account. It then revokes every captured active session by CAS, advances the documented account/grant/session authorization and revocation versions exactly once, and writes receipt, audit, and outbox evidence.
- Bootstrap receipt/audit records use the trust-root actor kind `deployment_bootstrap`; recovery records use `owner_recovery_event`. Neither records a newly created or replacement account as an actor that authorized itself. Recovery evidence includes the verified backup identifier and backup-manifest hash; an assertion is unusable without that backup evidence.
- Recovery preserves business, question-bank, asset, ordinary-role, profile-binding, data-scope, and authority records. It does not delete, import, reinterpret, or upload business data.
- Recovery replay returns only the durable result for the same event and canonical request; changed input is rejected. Failure at any write boundary leaves no partial recovery state.

## Non-goals of this decision

This document does not connect to a server, create deployment configuration, alter a production database, create a real user, issue a token, specify an API route, migrate/import data, open a desktop UI, access NAS/Docker, or implement the production verifier. Those require separately reviewed implementation and explicit runtime authorization.

## Recorded owner confirmation

The owner confirmed a single-authority deployment and selected personal first initialization from the deployment-bound computer. Later emergency recovery occurs only after the owner explicitly authorizes that concrete server-maintenance event; it revokes old super-admin access and sessions while preserving business data.
