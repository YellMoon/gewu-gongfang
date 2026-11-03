# Finance cloud materialization correction

Status: active, not released. This supersedes a client-only timeout/Worker fix.

User requirements confirmed during investigation:

- Imports, corrections and rule-version changes trigger cloud-owned computation.
- Persist the resulting economic transactions, balance/summary facts and review
  decisions by owner, ledger revision, rules version and valuation date.
- Opening a desktop or miniapp page reads completed results; it must not download
  all original observations or rerun full-history classification on the client.
- Transaction lists and original evidence are paginated/on demand. Date/account
  selection is a query over completed facts, not another historical reconciliation.
- Keep original bills and decisions immutable; avoid stale results appearing current.
  Offline clients may show their last verified result with its version/time.
- Recovery jobs are durable, version guarded, owner isolated, bounded and observable;
  a service restart must not force every unchanged ledger to recompute.

Evidence already obtained from the actual installed 8.34.2 user session:

- 61,506 original observations, 872 imports, 73 accounts; 41,553 derived transactions.
- A ledger response is HTTP 200 with gzip Content-Length 15,720,751 bytes.
  An observed transfer took about 57 seconds, close to the fixed 60-second abort.
  The visible failure was numeric DOMException code 20, rendered as a cloud error.
- Existing desktop reconstructs the full view in personalFinance.worker.ts.
  Existing miniapp cloud projection service caches only a live Worker for ten
  minutes; it does not persist the completed computation.
- A real-data baseline result SHA-256 is retained only as a digest in local
  diagnostic evidence. No production business data was changed.
- Repeated client diagnostic Worker calculation has been stopped as requested.

Current implementation persists the cloud computation state in PostgreSQL and
restores completed facts after service restart. A single durable leased job runs
per service, with bounded attempts, stale-revision checks and cache retention.
Desktop requests summary facts and at most 50 transactions per page. Original
evidence is read only when expanded or explicitly searched. Miniapp retains its
compact statistics contract. Tuition candidates are generated from the complete
cloud facts rather than the currently visible transaction page.

Verified on the actual revision 3886 ledger: 61,506 observations and 41,553
transactions. The original committed algorithm and restored materialized state
produce the identical full-result SHA-256:
`b27be0b404b334306cb28e036cee9c6fef3fe06b7ffba8107c85900bf0f67f46`.
Initial cloud computation took 428,268 ms in an isolated one-CPU container.
Warm page-two queries took 165 ms. The reduced JSON response gzips to about
213 KB instead of the former 15,720,751-byte compressed source ledger.

The real 30,709,741-byte artifact and default projection were persisted in a
disposable PostgreSQL database with runtime-role grants. Three default desktop
queries took 50/49/45 ms without a calculation worker. Wrong leases, cross-owner
reads and stale-revision visibility were rejected. Production business data was
not modified by these validation runs.

184 shared financial test files, 35 desktop interaction cases and TypeScript
passed. Real Electron mailbox/fund/account interactions and tuition confirmation
flows passed with synthetic data. The default page now reads its stored summary
immediately while the query worker warms asynchronously. Calculation and paper
exports share a resource gate; the deployed worker container budget is raised to
1 GiB after real-data 768-MiB/384-MiB-heap limits proved insufficient. Candidate
containers explicitly disable materialization jobs before promotion.

The current broad `npm test` passed its calendar interaction checks and then
stopped at `cloud_postgres_security_fingerprint.test.cjs` because the disposable
Docker PostgreSQL runtime is unavailable on this Windows host. The separate
server PostgreSQL artifact/permission tests above passed. No current build has
been published yet; release evidence will be recorded after deployment.
