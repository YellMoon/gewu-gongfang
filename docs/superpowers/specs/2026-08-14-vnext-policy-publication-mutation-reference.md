# vNext Existing-Authority Policy Publication Mutation Reference

Only an already published authority may use this reference writer. It accepts a closure-branded trusted session assertion, derives every authority, actor, role, capability, surface and reauthentication fact from the existing read-only AccessContext resolver, and writes exactly one later authority policy publication.

The command is exact: `type`, `expectedPolicyRevision`, `idempotencyKey`, `reasonCode` and `manifest`. It never accepts caller authority, account, role, capability, surface, session, reauthentication, manifest hash or canonical JSON claims. The writer re-canonicalizes the manifest with the pure policy contract and computes its own SHA-256.

Only a desktop context with the formal `super_admin` role, `access.manage`, and `reauthenticatedUntil > now` may proceed. Revision zero always returns `FIRST_POLICY_BOOTSTRAP_REQUIRED`; this module cannot create the first policy, first administrator, first authority, seed or bypass. Later writes compare the caller's expected revision to the authority's highest current publication.

A successful publish atomically creates an accepted receipt, the next immutable publication, its receipt-bound audit and a single immutable `authorization_policy.published` outbox intent. An immediately identical manifest produces a durable `POLICY_UNCHANGED` noop receipt/audit and no publication/outbox. A prior policy may be activated again after an intervening different policy, creating a new revision. Idempotency replay revalidates the request hash and every receipt, publication, audit and outbox companion before returning its frozen result.

This is an injected `:memory:` SQLite reference writer. It does not bootstrap, create identities, issue or verify credentials, expose an API, access a gateway/runtime/cloud database, change account/session/device versions, write business data, read D: data, operate NAS/Docker or perform a migration/deployment.
