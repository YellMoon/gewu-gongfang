# vNext Local Business Repository Retention and Control-Plane Projection No-Export

## Decision

The local data host remains the authority for all business repositories. The
PG17 vNext target is a control-plane store only. No business table, question
bank row, document, file-object reference, desktop path, raw contact value, or
offline business change is a source collection for the current PG17 rehearsal
or any control-plane projection.

## Purpose

This preserves the project's required architecture: the local host retains
complete business truth and the managed question-bank disk; cloud authority is
limited to identity, device trust, authorization, heartbeats, relay metadata,
miniapp task coordination, and queue metadata. A future approved snapshot
capability, if separately designed, must be non-authoritative, minimized, and
subject to its own encryption, retention, recovery, and access contract; this
decision does not authorize creating, reading, hashing, uploading, or using a
business snapshot as a PG17 source or projection. A control plane must never
become a backdoor business repository merely because it is easier to copy a
local table during migration work.

## Boundary

- Existing local business repositories retain their current domain semantics,
  ownership rules, transaction behavior, and storage paths.
- A future repository adapter may use synthetic fixtures to prove that its
  public domain interface remains compatible with existing business logic.
- It may not read, enumerate, hash, export, or copy a real desktop repository,
  question-bank disk, document directory, NAS path, removable drive, or local
  business database as part of that proof.
- A vNext control-plane projection is one-way and cannot write back to any
  local repository. Each projected control-plane relation needs its own
  admission specification, canonical data contract, synthetic proof, rollback
  rule, and independent audit.
- No projection may infer an account, profile, capability, policy, session,
  reauthentication, contact, or business owner from an untrusted business row.

## Explicitly Excluded Sources

The following are never PG17 control-plane source collections under this
decision: schedules, courses, teachers, students, payments, consumptions,
personal or household assets, institutions, rooms, question-bank content,
question attachments, document exports, import files, business audit trails,
offline drafts, sync queues, local snapshots, data-host paths, and raw
telephone/WeChat/contact data.

Offline edits remain local drafts until the local host's separately authorized
sync/review process accepts them. A cloud relay may coordinate an approved task
or hold non-authoritative progress metadata, but it cannot silently receive or
apply an offline business mutation.

## Future Real-Rehearsal Gate

Any proposal to read real local business state must be a separately approved
task and first provide all of these:

1. a relation-by-relation source inventory and explicit local-authority reason;
2. a privacy-minimized snapshot manifest with stable fingerprints, redaction,
   retention, and access controls;
3. a reversible dry-run with an independently verified rollback artifact that
   leaves local repositories, question-bank storage, and desktop configuration
   unchanged;
4. a multi-endpoint compatibility matrix covering local host, other desktops,
   cloud relay, and miniapp paths; and
5. explicit authorization for the exact host, data scope, backup location, and
   recovery procedure.

None of these conditions is currently satisfied or implied by the synthetic
control-plane work.

## Non-Goals

This decision does not create a PG17 business schema, repository adapter,
source reader, export tool, shadow import, cloud storage bucket, API, writer
credential, synchronization route, migration job, backup job, or deployment.
It does not change the existing desktop data, business logic, question-bank
disk, NAS, removable drives, Docker, RDS/ECS, or miniapp behavior.

## Cost and Safety Rationale

The boundary has no infrastructure cost and prevents the highest-cost failure:
accidentally converting a local-authoritative business system into an
unreviewed cloud copy with unclear ownership, rollback, privacy, and offline
conflict behavior. Synthetic compatibility fixtures let the project continue
refactoring its control plane without touching user data.
