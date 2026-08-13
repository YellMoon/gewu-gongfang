# vNext Role Mutation Reference Verification

Date: 2026-08-14

## Boundary

`shared/vNextRoleGrantMutationReference.js` is a synchronous, injected SQLite reference service. Its tests use only `:memory:` databases. It has no gateway, HTTP, WebSocket, CLI, worker, desktop path, cloud connection, session/token/reauth resolver, real business table, NAS, removable-drive, or deployment integration.

## Verified behavior

- Only `role.grant` and `role.revoke` are accepted. `admin`, scheduled grants, expiry changes, batch changes, capability/scope/device mutations, and caller-supplied authority/actor fields are outside the contract.
- A guard must explicitly permit the command. Guard exceptions, async results, false/malformed verdicts, inactive authority, and inactive actor fail closed before any control-plane write.
- Grant/revoke obey the frozen target CAS and account-version matrix. The final active, currently effective `super_admin` on an active account cannot be revoked.
- Same actor/key/same request replays the canonical receipt without new writes; same key/different request conflicts. Replay verifies canonical JSON/hash, strict result shape, target binding, committed version shape, exactly one audit, and accepted-command outbox intent.
- Accepted commands atomically write target, account versions, receipt, audit, and one immutable outbox intent. Rejected/noop commands atomically write receipt plus audit only. Injected failure rolls back the complete transaction.

## Checks

```text
node shared/vNextRoleGrantMutationReference.test.js
npm run test:vnext-migration
git diff --check
```

This is not yet a production authorization API or a cloud deployment. The next bounded task must separately design session/reauth context resolution before any runtime route can invoke this reference service.
