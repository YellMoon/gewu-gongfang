# Legacy Local Draft Intake Admission Boundary

## Status

No-go for implementation. This document records the boundary for a future, separately approved intake of local schedule changes. It does not authorize a source read, an import, a cloud write, a release, or a cutover.

## What is known

- The approved legacy scheduling snapshot is initialization evidence only. It does not contain a durable, independently verified proof for the reported 3013 local changes.
- The reported change family may include schedule creation, editing, deletion, attendance edits, student tuition edits, and teacher-hour-fee edits.
- Question-bank and asset data are absent from the approved legacy scope and remain excluded.

## Required future command boundary

Each future change must be admitted as an individual cloud command, never as an opaque database-row copy:

1. The user explicitly authorizes one read-only local source root and a consistent snapshot.
2. The source is classified into a bounded command: create, edit, delete, attendance, student tuition, or teacher fee.
3. The command carries a stable local change identity, canonical request hash, affected business identities, and expected versions.
4. An authenticated unified desktop session uploads only an impact preview. The user sees conflicts and confirms one submission.
5. The cloud command is idempotent: the same identity and hash replay the stored result; the same identity with a changed hash conflicts.
6. The cloud is the only writer. The desktop never silently pushes a local draft, and the legacy SQLite database is never treated as authoritative after admission.

## Offline rule

Offline operation may create an encrypted `awaiting_confirmation` draft only when the desktop already holds an unexpired session and no locally persisted revocation blocks it. A new offline login is denied. Reconnection refreshes session/revocation state before a one-time user confirmation; a rejected or conflicted draft remains uncommitted.

## Explicit exclusions

- No source path discovery, filesystem scan, SQLite read, row export, RDS write, API route, writer privilege, procedure, relay, or deployment is authorized here.
- No question-bank, asset, media, NAS, credential, token, session issuance, or reauthentication data may enter this intake.
- The 3013 count alone is not an import key, reconciliation proof, or authorization to manufacture missing change detail.

## Reopening gate

Implementation may start only after the user approves one immutable read-only source root and the project has a reviewed command contract, source snapshot identity, PII/redaction policy, conflict policy, and synthetic tests for replay, offline confirmation, failure rollback, and zero silent submission.
