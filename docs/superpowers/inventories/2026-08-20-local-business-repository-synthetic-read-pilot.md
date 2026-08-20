# Local Business Repository Synthetic Read Pilot Inventory

- Retained owner: `backend/src/services/personalAssetAccountService.js`
- Admitted operation: `list({ actor, authorityId, ownerUserId })`
- Existing proof: `backend/src/services/personalAssetAccountService.test.js`
- Runtime caller change: none; the synthetic adapter has no production import.
- Intentionally not reused: the `asset_accounts` SQLite query.
- Synthetic dependency: only a closure-owned fictional fixture.
- Result: accountId, authorityId, ownerUserId, accountType, provider, label,
  maskedIdentifier, balance, currency, status, createdAt, updatedAt.
- Errors: ASSET_ACCOUNT_ACTOR_REQUIRED, ASSET_ACCOUNT_AUTHORITY_REQUIRED,
  ASSET_ACCOUNT_FORBIDDEN.
- Prohibited: real SQLite, file/path/environment access, network, cloud/PG,
  projection, sync, snapshots, exports, task dispatch, runtime wiring, mutators.
