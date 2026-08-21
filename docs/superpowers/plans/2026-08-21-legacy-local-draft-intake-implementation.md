# Legacy Local Draft Intake Implementation Plan

> Status: blocked by the admission design. Do not execute any step until the reopening gate is met.

## Scope when separately authorized

Handle only local schedule create/edit/delete, attendance, student tuition, and teacher-hour-fee changes as command-level drafts. Do not mix this work with the legacy initialization snapshot or with question-bank and asset data.

1. Freeze the user-approved read-only source root and consistent snapshot identity.
2. Build a synthetic, command-level parser for the six approved change categories; reject every other record.
3. Prove canonical request hashes, expected-version conflicts, exact replay, and redacted impact previews.
4. Prove that offline drafts remain encrypted and `awaiting_confirmation`, including restart and network-retry cases; confirmation is the only submission transition.
5. Only after separate writer-identity approval, implement one cloud command at a time and verify the unified desktop, server, and release matrix.

## Stop condition

Without the separately approved source root and command contract, this plan remains documentation only. It must not read local files, create a database connection, or alter the cloud/business schema.
