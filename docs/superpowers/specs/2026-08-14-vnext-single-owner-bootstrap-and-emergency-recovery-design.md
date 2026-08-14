# vNext Single-Owner Bootstrap and Emergency-Recovery Design

Status: direction approved by the owner; wait for owner review of this written design before implementation planning.

## Scope

There is one authority. Bootstrap answers who creates the first super-admin on an empty control plane. Emergency recovery answers how the owner regains control of an existing authority after every super-admin path is lost. Neither inherits authority from legacy data or touches business repositories, question-bank data, assets, NAS, removable storage, or real source data.

The immediate deliverables are injected SQLite `:memory:` reference schema and reference transactions only. They are not a server deployment, API, desktop UI, production recovery executor, or data migration.

## Selected design

The selected design is single-owner, deployment-bound, one-time bootstrap plus explicitly authorized emergency recovery.

- A permanently open create-admin call is rejected: a caller could race to become the owner.
- Manual production database edits are rejected: they lack backup, atomicity, audit, and rollback evidence.
- The stated trust assumption is limited: during bootstrap, the owner controls both the deployment computer and server deployment configuration. A compromised computer at that moment is outside the system's ability to repair.

## Bootstrap flow

Before service start, deployment configuration fixes the intended desktop installation public-key fingerprint. The server generates a nonce and canonical bootstrap statement. The target installation signs that statement with its private key; the verifier checks that signature against the configured public fingerprint before producing a short-lived opaque bootstrap assertion. The statement binds bootstrap intent, authority/account/device/installation identifiers, policy hash, expiry, and approval version. A copied public fingerprint, IP address, hardware identifier, old desktop data, local session, or caller-supplied role is insufficient. The raw signature, nonce, and private key are never stored in assertion, receipt, or audit data.

Only while the authority count is zero and a deployment-global append-only bootstrap-consumed marker is absent, one transaction creates the sole authority, first account, trusted device, installation, account-device link, sole initial `super_admin` grant, explicitly supplied canonical policy manifest/publication, receipt, audit event, outbox intent, and that marker. `DEFAULT_POLICY_MANIFEST` is never seeded automatically. The marker cannot be updated or deleted; deleting authority rows cannot reopen bootstrap.

An exact retry returns its durable receipt. A changed request with the same idempotency key, a second bootstrap, or a second authority fails closed. Any failed write rolls back the whole operation.

## Emergency recovery flow

Emergency recovery is neither automatic nor a hidden administrator. In production, it may be run only after the owner explicitly authorizes the concrete recovery event. Before any real operation, the runbook must create and verify a restorable control-plane backup. The reference implementation never connects to a real server.

The recovery assertion binds the authority, replacement account, replacement installation public-key fingerprint, recovery event identifier, reason, expiry, verified backup identifier, and backup-manifest hash. One transaction first captures the active-super-admin and active-session sets. It revokes every captured super-admin grant by CAS, creates one fresh recovery grant for the assertion-bound replacement account, and requires the final state to have exactly one active `super_admin` grant on that account. It then revokes every captured active session by CAS, advances the documented account/grant/session authorization and revocation versions exactly once, and writes recovery receipt, immutable audit, and one outbox intent.

Bootstrap evidence uses trust-root actor kind `deployment_bootstrap`; recovery evidence uses `owner_recovery_event`. A new or replacement account is never recorded as the actor that authorized its own creation or recovery. The verified backup identifier and manifest hash are mandatory recovery evidence, not a runbook-only note.

Ordinary roles, profile bindings, data scopes, accounts, and all business data remain. The replacement owner must subsequently use the normal AccessContext, device, and reauthentication rules.

## Failure and verification contract

Reference tests must reject fake or cross-database assertions, expired or wrongly bound assertions, second authority creation, changed replays, CAS conflicts, and tampered receipt/audit/outbox evidence. Injected failures after every write boundary must leave no partial state.

Real recovery remains a later, separately authorized operation. Its runbook must prove backup restoration, maintenance-window handling, replacement-owner access, old-session invalidation, audit completeness, and unchanged business data before it can be called complete.
