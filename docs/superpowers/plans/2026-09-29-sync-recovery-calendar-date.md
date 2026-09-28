# Failed sync recovery and calendar date correction

User scope: restore removal of stale/failed local sync changes, make failures
actionable, and keep lessons before 08:00 on their intended calendar date.

Design: preserve native encrypted drafts until explicit discard; classify known
permanent business/validation failures as rejected receipts, retain unknown
transport failures for idempotent retry, and show discard on pending rows.
Never infer deletion from absence in a filtered course table or invent a missing
optimistic concurrency version. Use the same local date parser for day columns
as for week filtering, labels, editing and drag geometry. No protocol/schema change.

1. Add failing native adapter/outbox/controller tests for old drafts without
   versions, deleted/version-conflicted targets, transport failures and durable
   removal. Add actual calendar component regression around midnight/08:00,
   Monday/month boundaries, local/UTC/offset encodings.
2. Correct rejection classification, retry error readback, pending discard and
   explanatory copy; correct day membership. Preserve completed history hiding.
3. Exercise actual Ant Design discard/cancel/reopen and actual calendar output;
   run relevant and full lifecycle tests, typecheck and self-review.
4. Automatically bump desktop patch; commit/push gewu/master. Check unchanged
   cloud/NAS/miniapp compatibility, build desktop, verify packaged runtime and
   restored Node ABI, publish and verify OSS feed and installer. Record limits.

No new agent/worktree is required; preserve unrelated user documentation.
