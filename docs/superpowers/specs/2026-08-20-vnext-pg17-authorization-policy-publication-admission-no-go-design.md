# PG17 vNext Authorization-Policy Publication Admission No-Go

## Decision

Do not admit any `vnext_authorization_policy_publications` source rows into the
synthetic copy-only rehearsal. This is an explicit no-go decision, not a
missing convenience feature. No policy publication, policy manifest, bootstrap
marker, trust-root evidence, session, or reauthentication row may be copied by
the current boundary.

## Why Policy Is Different

The completed historical evidence boundary admits only a fixed
`account_device_link.revoke` command envelope and its exact companion rows.
It cannot establish that an arbitrary historical receipt was a valid
`authorization_policy.publish` command, nor can it prove that its manifest
was the policy selected by an authorization resolver.

A policy publication is an ordered authority-local history:

- its revision must be the exact next revision;
- its contract version and canonical manifest hash participate in the meaning
  of the policy;
- its insert guard requires a matching accepted publish receipt or the
  separately guarded bootstrap receipt;
- a changed policy can alter current authorization, unlike revoked/expired
  historical grants or opaque metadata.

Treating such rows as harmless archive data would create a plausible but
unproven current authorization source.

## Rejected Alternatives

- **Copy only the newest publication.** Rejected: it loses the append-only
  revision proof and still cannot prove the selected manifest was published by
  an authorized actor.
- **Copy policy rows as inactive history.** Rejected: the target relation has
  no inactive state; any inserted revision is a candidate authorization policy.
- **Reuse link-revoke receipts/audit/outbox.** Rejected: their command type,
  target, result shape, request hash, and companion payload do not establish a
  policy publication.

## Future Admission Prerequisites

A later, separately approved policy-publication boundary may be designed only
after all of the following have their own exact, testable contracts:

1. a canonical `authorization_policy.publish` source envelope, including
   authority, previous revision, next revision, contract version, canonical
   manifest bytes/hash, idempotency key, and stable request hash;
2. an explicit resolver/read-selection contract proving which authority policy
   revision/manifest is used for an AccessContext and how a publication cannot
   be substituted or reordered;
3. atomic accepted receipt, audit, and accepted-only outbox companion rules
   whose typed result/payload hashes match the publication and source envelope;
4. source-side replay, revision-continuity, unchanged-manifest, duplicate-key,
   authority-scope, and companion-integrity validation before any target write;
5. a disposable-only transaction proof for the entire publication/evidence
   bundle: exact static SQL trace, reread hashes, each write-stage rollback,
   post-read mismatch rollback, and uncertain commit/rollback target poison.

Completion of a prerequisite does not authorize source rows by itself. A new
admission specification and independent audit must still approve the complete
bundle.

## Explicit Non-Goals and Prohibitions

This decision does not implement or enable a policy writer, policy evaluator,
AccessContext resolver, procedure, writer DML/EXECUTE, runtime privilege,
bootstrap, recovery, trust root, session, reauthentication, dispatcher, API,
CLI, RDS/ECS access, real SQLite source, desktop/NAS/D-drive access, or real
data migration. It does not modify M1--M15, catalog assertions, current
synthetic fixtures, or the link-revocation evidence boundary.

## Safety and Cost Rationale

This no-go keeps the current authority state fail-closed at effectively zero
infrastructure cost: no new database shape, privilege, container, cloud
resource, or secret is needed. The cost of waiting for a verifiable policy
envelope and resolver contract is materially lower than recovering from an
incorrectly activated authorization policy or a fabricated publication chain.
