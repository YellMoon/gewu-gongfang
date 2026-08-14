# vNext production control-plane database decision

**Status:** owner-delegated decision, 2026-08-14
**Decision:** use Alibaba Cloud ApsaraDB RDS for PostgreSQL 17 as a control-plane-only database service. Production uses a fixed-specification, pay-as-you-go High-availability Edition in the existing ECS region and VPC, with cross-availability-zone deployment and required in-transit encryption. Serverless remains a cost-optimized non-production option; it is not the production default while its current PostgreSQL 17 feature matrix lacks SSL encryption.

## Why this option

The current cloud backend and gateway each use `better-sqlite3` on ECS volumes. The V5 control-plane work is an executable SQLite `:memory:` reference contract, not target production DDL. SQLite keeps initial spend low, but couples availability, backup, restore, upgrades, and the only writer to the existing ECS host. ECS Docker PostgreSQL would keep the same operational coupling and makes PostgreSQL backup, point-in-time recovery, monitoring, upgrades, and incident response our responsibility.

RDS PostgreSQL keeps the control plane independently recoverable while retaining PostgreSQL transactions, constraints, triggers, JSON, append-only evidence, and compare-and-swap semantics needed by the V5 contracts. A smallest available fixed HA specification controls the initial cost while preserving the required encryption and recovery posture. High availability is a production availability decision: it is not deferred until traffic grows.

This decision does **not** move business authority to the cloud. The RDS database contains only vNext control-plane records; it is never a question-bank, personal-asset, desktop-business, NAS, removable-drive, or migration-source database.

## Chosen topology and hard boundaries

- **Engine and service:** RDS PostgreSQL 17, fixed-specification pay-as-you-go High-availability Edition, in the same region and VPC as the existing ECS workloads. Production must span availability zones; if the target region cannot provide this, provisioning is blocked until an eligible region or product form is selected.
- **Production network:** ECS-to-RDS private VPC access only. No public database endpoint, public allowlist, desktop direct database connection, or miniapp database connection is permitted.
- **Production sizing:** select the smallest fixed HA specification that passes the target-region capacity, connection-pool, latency, RPO/RTO, TLS, and restore gates. A price/capacity recheck is mandatory immediately before provisioning. Automatic start/stop is not a production feature.
- **Storage:** select the smallest region-supported Premium ESSD or ESSD PL1 capacity at implementation time. Automatic storage expansion is expected to be one-way until manually reduced; a cost alarm is mandatory before production use.
- **Non-production:** development/disposable tests, shadow/staging, and production use different instances, database users, passwords, secrets, security-group rules, backup namespaces, and migration identifiers. They must not be separated merely by schemas in one instance. A local disposable PostgreSQL 17 container is permitted only for tests, never as production authority.
- **Runtime roles:** a migration/bootstrap role is separate from the ordinary gateway/runtime role. Runtime has only the DML privileges necessary for its vetted vNext routes; it cannot create an initial authority by seed data or alter schema.
- **Control-plane data only:** authority, verified-contact evidence, role/capability/scope grants, profile-binding evidence, trusted device/installation/link, sessions, reauthentication evidence, policy publication, command receipt, audit, outbox, bootstrap marker, and trust-root evidence. Legacy tokens, business rows, question contents, personal assets, file objects, NAS locations, and source-desktop payloads are excluded.

## Availability and security gates

1. The Basic Edition is limited to dev, shadow, staging, or a separately approved, time-boxed production trial with an explicit downtime acceptance and every other production gate, including TLS. Basic is a single-node topology and is not the default production target. While the current PostgreSQL 17 Serverless SSL limitation exists, every Serverless form is non-production only; a future production use requires a new ADR and an independent gate, not merely downtime acceptance.
2. Before production traffic, define RPO, RTO, and maximum authorization outage; verify that the selected HA SKU, backup retention, restore procedure, and failover behavior satisfy them. No traffic cutover occurs before a successful isolated restore exercise with recorded evidence.
3. Production requires TLS/in-transit encryption and must recheck the target-region PG17 feature matrix, fixed-HA TLS and encryption support, storage options, backup capabilities, and recovery features. As of 2026-08-14, the published PostgreSQL 17 matrix shows normal Serverless HA lacks SSL encryption, cloud-disk encryption, cross-region backup, high-frequency snapshots, and database/table restoration. It is therefore not eligible for production under this ADR. Standard data backup and whole-instance restoration for the selected fixed HA form still require a successful restore exercise; no capability is assumed from a product name.
4. Application connections use bounded pools, connection/transaction timeouts, idempotent command receipts, and limited retries. Transaction replay is allowed only where the existing vNext receipt contract makes it safe.
5. The initial fixed specification is not a performance promise. Load testing and monitoring must set operational thresholds for CPU, memory, connection usage, transaction latency, error rate, and failover/restore behavior before changing it.

## Cost model and guardrails

The choice favors a predictable operational boundary over the zero incremental cost of self-hosting PostgreSQL. It does not promise a fixed bill.

For Chinese mainland Serverless RDS PostgreSQL, Alibaba Cloud's public documentation last checked on 2026-08-14 lists USD 0.0497 per RCU-hour and USD 0.00024 per GB-hour. HA bills two nodes. That price is a comparison point for non-production Serverless only, not the chosen production form:

`monthly estimate = nodes × hours × (actual RCU × RCU price + provisioned GB × storage price) + backup/DAS/audit/network extras`

At 0.5 RCU, 20 GB, 730 hours, and two nodes, the Serverless comparison illustration is about USD 43.3/month before optional services, overage backup, tax, discounts, currency conversion, and region-specific changes. The selected fixed HA production form must be separately quoted in the target-region purchase page; its price is not inferred from this figure. Actual purchase-page pricing and the account bill are authoritative. Set a monthly budget and alerts for instance specification, storage growth, backup overage, DAS/monitoring, audit, and any cross-region recovery traffic.

Sources checked on 2026-08-14:

- [RDS PostgreSQL Serverless pricing](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/pricing-of-serverless-apsaradb-rds-for-sql-server-instances)
- [Serverless creation and edition guidance](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/create-a-serverless-apsaradb-rds-for-postgresql-instance)
- [PostgreSQL 17 feature matrix](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/features-of-apsaradb-rds-for-postgresql)
- [RDS billing items](https://www.alibabacloud.com/help/zh/rds/apsaradb-rds-for-postgresql/billable-items-billing-methods-and-pricing)

## SQLite V5 to PostgreSQL implementation boundary

The reference kernel establishes semantics, not a portable DDL file. The next bounded design/implementation task must map and test, control-plane table by control-plane table:

- explicit transaction isolation, row locking, and CAS update predicates;
- PostgreSQL constraints, partial unique indexes, composite foreign keys, append-only trigger behavior, and trigger security;
- JSONB exact-shape validation and canonical JSON/SHA-256 verification performed by the trusted writer rather than assumed from JSON storage;
- UTC instant validation, expiration windows, and database/application clock boundaries;
- receipt/audit/outbox atomicity, retry/replay semantics, and failure injection;
- connection-pool and migration-role privilege boundaries;
- backup, restore, rollback, and environment-isolation evidence.

No target DDL, compatibility shim, cloud connection, container, secret, import, or deployment is created by this ADR.

## Consequences and next gate

The next task is a PostgreSQL 17 control-plane-only DDL and disposable integration-test design. It remains local and synthetic until the design is independently audited. Before any real RDS creation, the implementation plan must recheck the target region/VPC/SKU, capture the final price, choose the exact HA/TLS form, define RPO/RTO and backup retention, and obtain a separate authorization to create cloud resources. Source desktop data, `D:\新建文件夹`, NAS, removable drives, question data, and business tables remain out of scope until later migration gates.
