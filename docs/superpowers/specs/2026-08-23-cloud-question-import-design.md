# Cloud-Authoritative Word Question Import Design

**Status:** Confirmed implementation boundary under the cloud-business-authority contract.

## Purpose

Replace the legacy local Word import path with an auditable flow. Cloud owns import tasks, candidate question text, validation, permissions, and final question writes. NAS stores only immutable Word originals, derived rich media, checksums, and backups.

## Flow

1. An online desktop session receives the storage-agent public key, encrypts the selected Word original, and creates an idempotent cloud import task. Cloud holds only expiring ciphertext, never source plaintext.
2. The controlled storage agent verifies and stores the immutable source object on NAS, then returns a receipt. Only that receipt moves the cloud task to parsing.
3. The agent parses the verified NAS original and sends normalized text candidates plus media manifests to cloud. Cloud validates and persists candidate text; the agent does not decide access, task outcome, or question writes.
4. Cloud authorizes derived media by object ID, version, hash, and byte count. The agent can write only matching immutable NAS objects and must submit normal receipts. Candidate rows contain object references only, never binary data or NAS paths.
5. Explicit user confirmation prepares encrypted local `question.create.v1` drafts. A separate user-confirmed online submission sends those drafts to the cloud question-command API. An unconfirmed task never creates a question.

## States

`awaiting_source_storage` -> `queued_for_parse` -> `parsing` -> `candidates_ready` -> `drafts_prepared` -> `submitted`.

`failed`, `cancelled`, and `quarantined` are terminal. `drafts_prepared` means only that local pending drafts exist; it does not mean a cloud question was written.

## Prohibitions

- No calls to legacy `parse-word`, `imports/check`, `imports/:id/commit`, or `storage/status` endpoints.
- No browser IndexedDB media authority and no automatic local-import fallback.
- No storage-agent direct writes to questions, accounts, permissions, or task decisions.
- No import upload while offline, no question creation before explicit confirmation, and no silent draft submission.

## Acceptance evidence

- Each source and derived object has a NAS verification receipt before use.
- Cloud tests prove ownership/role isolation, idempotency, and zero question writes before confirmation.
- Desktop tests prove offline upload denial and encrypted-draft-only behavior.
- Static page tests prove removal of legacy import routes and local fallback.
