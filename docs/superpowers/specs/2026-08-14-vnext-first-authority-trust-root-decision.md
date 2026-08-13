# vNext First-Authority Trust-Root Decision

Status: awaiting owner decision; no bootstrap implementation is authorized.

## Decision required

Before any vNext authority, initial account, initial device link, first `super_admin` role, or first policy publication can be created, the owner must select the human trust root that proves who may perform that one-time action.

This decision cannot be inferred from an old database flag, desktop installation, old device record, local session, phone number, hardware fingerprint, data-host role, recovery package contents, or source-machine possession. Those may be retained only as archival or human-review evidence.

This project is **single-authority at bootstrap**: an empty vNext control-plane deployment may create exactly one authority in its lifetime. A second authority is not a second bootstrap opportunity. Future multi-authority support requires a separately designed tenant-provisioning authority and cannot reuse this ceremony.

## Recommended decision

Use a two-part, owner-controlled bootstrap ceremony:

1. The owner supplies an independently retained, high-entropy one-time recovery secret through an approved confidential channel.
2. The owner performs an explicit out-of-band confirmation against a displayed bootstrap intent fingerprint before the service accepts the ceremony.

The recovery package is preservation evidence only. It does not contain, create, or substitute for the recovery secret, and it is never uploaded by this ceremony.

This choice avoids inheriting effective authority from legacy control-plane data while preserving a human-verifiable recovery path. It must be concretely approved before implementation.

## Alternatives the owner may choose instead

- An external identity provider issues a one-time, manually reviewed bootstrap approval.
- Two independent factors approve the same intent, for example a manually verified external identity flow plus an independently retained recovery secret.

Any alternative must define how the out-of-band verifier resists client forgery and how its approval can be revoked before consumption.

## Frozen ceremony invariants

- The external verifier returns only a closure-branded opaque bootstrap assertion. It never returns a role, capability, raw recovery secret, password, one-time code, private key, token, or user-controlled identity claim.
- Each independent factor is bound to the same `bootstrap_intent_id`, authority identifier, account identifier, device identifier, installation public-key fingerprint, purpose, expiry, and approval-version. It cannot be redirected to another target.
- A successful ceremony is permitted only while the whole control-plane deployment has no authority. It atomically creates its sole authority, initial account, trusted device, installation, account-device link, sole initial `super_admin` role grant, explicit canonical V4 policy publication, command receipt, audit event, and outbox intent.
- The initial policy is an explicitly supplied, canonicalized and hash-pinned manifest. `DEFAULT_POLICY_MANIFEST` is never an automatic fallback or seed.
- The one-time approval is short-lived, single-use, CAS/idempotency protected, audited, and permanently unavailable for that authority after success. Replays return the durable receipt only; a changed request with the same idempotency key is rejected.
- All later role, device, policy, session and authorization changes require normal trusted-session AccessContext checks. There is no system administrator, development bypass, first-call exemption, legacy-admin mapping, host-only bypass, or client-supplied session/role/device claim.
- No legacy session, token, challenge, host epoch, host key, old device authorization, recovery package metadata, phone number or hardware fingerprint becomes an active vNext credential or grant.

## Non-goals of this decision

This document neither creates a secret nor specifies secret storage, token format, API route, cloud deployment, database migration, data import, desktop UI, NAS access, or production identity-verifier implementation. Those require the selected trust root and a subsequent bounded design and implementation review.

## Owner confirmation template

The owner must explicitly confirm one sentence before code is written:

> I confirm this vNext deployment is **single-authority**. I select the first-authority trust root as **[recovery secret plus out-of-band confirmation | external one-time approval | two independent factors]**. If selecting the recovery-secret option, I confirm the secret and the out-of-band confirmation are independently verified against the same displayed short-lived intent fingerprint, including target authority/account/device/installation public-key fingerprint; the recovery package neither contains nor substitutes for the secret. The confirmation's trusted human or external verifier is **[name/process]**. This may create only the sole initial vNext authority and first `super_admin` through a one-time, audited ceremony; legacy data must not itself grant vNext authority.
