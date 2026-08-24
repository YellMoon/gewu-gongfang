# Desktop Business Draft Direct Cloud Submission Design

## Goal

Offline desktop business edits update only the local derived cache and append encrypted `awaiting_confirmation` drafts. After explicit online confirmation, Electron main submits through the existing `cloud-business-api` REST contracts with the current desktop session token. Core business drafts must never enter the legacy `/api/authority/commands` relay.

## Scope and boundaries

- The first closure covers student, teacher, room, and course create/update/delete plus the already-supported schedule update contract.
- Student drafts use the atomic student-record API. Contacts are derived from the student phone, guardian phone, and WeChat fields, with at most three slots.
- Every update and delete carries the record `updated_at` observed before local mutation as `expectedUpdatedAt`. A missing baseline fails closed.
- Business and question confirmation/retry pass the current session token only as IPC call input. The token is never serialized in the outbox, logs, or business payload.
- Schedule create/delete, institution, payment, consumption, grade, and desktop personal-asset drafts currently have no matching cloud lifecycle contract. They fail closed and never fall back to the old relay until an independently tested cloud contract exists.
- Successful cloud responses become local outbox receipts. Conflict, access, validation, and network errors retain a retryable or conflicted draft with a stable code.

## Components and data flow

1. `browserDatabase.ts` captures the prior `updated_at` before changing the derived cache and passes it as draft `baseVersion`.
2. `authorityDraftAdapter.mjs` keeps its existing field allowlist and snake_case draft contract.
3. A focused business-draft adapter validates commands, maps payloads to the camelCase inputs already accepted by `desktopIdentityClient.mjs`, invokes the matching method, and returns a verifiable receipt.
4. `desktopAuthorityRuntime.js` creates a main-process instance of the same desktop identity client using the existing fetch implementation, vault, and cloud base URL. It reads the session token only from confirmation/retry input.
5. `desktopAuthorityClient.mjs` classifies every known business draft as cloud business. Supported types use the adapter; unsupported types fail explicitly and cannot enter legacy transports.
6. `AuthorityOutboxPanel.tsx` supplies the current session token for both question and business cloud drafts, then refreshes the business projection after success.

## Errors and recovery

- Offline confirmation is rejected before the outbox state changes.
- Missing session, base URL, version baseline, or required fields leaves the draft retained with a stable error.
- A network failure after submission retains the same command ID for retry.
- A REST conflict never applies the local cache as authority and never invokes the old relay.

## Verification

- Adapter unit tests cover snake_case mapping, version baselines, contacts, supported and restricted types, and receipts.
- Runtime tests prove business drafts call only `/api/business/**`, never `/api/authority/commands`, and never persist the session token.
- Browser database regression tests prove update/delete operations capture the pre-mutation `updated_at`.
- Panel tests prove both business and question cloud drafts pass the current session token.
- Authority architecture, desktop identity, cloud business API, type checks, and root build require fresh successful output before any completion claim.

## Release and rollback

Rollback is a forward revert commit. It must not delete outbox, audit, migration, or user data. A real cloud deployment requires a database backup and permission-contract checks first. Local code verification is not a multi-end release.
