# vNext production cloud business authority database decision

**Status:** owner-delegated topology, cost and availability decision; its data boundary is aligned to the current cloud-business-authority architecture on 2026-08-21.
**Decision:** use Alibaba Cloud ApsaraDB RDS for PostgreSQL 17 as the cloud business authority database service. Production uses a fixed-specification, pay-as-you-go High-availability Edition in the existing ECS region and VPC, with cross-availability-zone deployment and required in-transit encryption. Serverless remains a cost-optimized non-production option; it is not the production default while its current PostgreSQL 17 feature matrix lacks SSL encryption.

## Why this option

The current cloud backend and gateway each use `better-sqlite3` on ECS volumes. The V5 control-plane work is an executable SQLite `:memory:` reference contract, not target production DDL. SQLite keeps initial spend low, but couples availability, backup, restore, upgrades, and the only writer to the existing ECS host. ECS Docker PostgreSQL would keep the same operational coupling and makes PostgreSQL backup, point-in-time recovery, monitoring, upgrades, and incident response our responsibility.

RDS PostgreSQL keeps the cloud business authority independently recoverable while retaining PostgreSQL transactions, constraints, triggers, JSON, append-only evidence, and compare-and-swap semantics. A smallest available fixed HA specification controls the initial cost while preserving the required encryption and recovery posture. High availability is a production availability decision: it is not deferred until traffic grows.

云端是适用业务数据与题库结构化文字内容的唯一可写权威。学生、教师、课程、排课、收费、课耗、资产、题库结构化内容、账户、权限、会话、审计和任务状态均通过云端业务服务进入 RDS；旧桌面数据仅在受控迁移和观察期中作为来源与恢复材料。题库富媒体、导入原件、Word/PDF 产物和备份仍由 NAS/存储代理承载，不以 RDS 的文件字段或桌面路径替代。

## Chosen topology and hard boundaries

- **Engine and service:** RDS PostgreSQL 17, fixed-specification pay-as-you-go High-availability Edition, in the same region and VPC as the existing ECS workloads. Production must span availability zones; if the target region cannot provide this, provisioning is blocked until an eligible region or product form is selected.
- **Production network:** ECS-to-RDS private VPC access only. No public database endpoint, public allowlist, desktop direct database connection, or miniapp database connection is permitted.
- **Production sizing:** select the smallest fixed HA specification that passes the target-region capacity, connection-pool, latency, RPO/RTO, TLS, and restore gates. A price/capacity recheck is mandatory immediately before provisioning. Automatic start/stop is not a production feature.
- **Storage:** select the smallest region-supported Premium ESSD or ESSD PL1 capacity at implementation time. Automatic storage expansion is expected to be one-way until manually reduced; a cost alarm is mandatory before production use.
- **Non-production:** development/disposable tests, shadow/staging, and production use different instances, database users, passwords, secrets, security-group rules, backup namespaces, and migration identifiers. They must not be separated merely by schemas in one instance. A local disposable PostgreSQL 17 container is permitted only for tests, never as production authority.
- **Runtime roles:** a migration/bootstrap role is separate from the ordinary business-service/runtime role. Runtime receives only the command-specific DML or procedure capabilities approved by the cloud business authority contract; it cannot create an initial authority by seed data or alter schema.
- **Cloud authoritative relational data:** authority, verified-contact evidence, role/capability/scope grants, profile-binding evidence, trusted device/installation/link, sessions, reauthentication evidence, policy publication, command receipt, audit, outbox, bootstrap marker, trust-root evidence, and the applicable business tables and structured question-bank content. NAS object bytes, NAS locations, desktop paths, raw legacy credentials and unapproved source payloads remain outside RDS.

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

## Local V5 foundation to cloud business schema boundary

The local V5 reference kernel establishes only a security foundation, not a portable full-business DDL file. The next bounded design/implementation task must map and test the cloud business schema, domain by domain, while preserving the control-plane guarantees:

- explicit transaction isolation, row locking, and CAS update predicates;
- PostgreSQL constraints, partial unique indexes, composite foreign keys, append-only trigger behavior, and trigger security;
- JSONB exact-shape validation and canonical JSON/SHA-256 verification performed by the trusted writer rather than assumed from JSON storage;
- UTC instant validation, expiration windows, and database/application clock boundaries;
- receipt/audit/outbox atomicity, retry/replay semantics, and failure injection;
- connection-pool and migration-role privilege boundaries;
- backup, restore, rollback, and environment-isolation evidence.

No target DDL, compatibility shim, cloud connection, container, secret, import, or deployment is created by this ADR.

## Consequences and next gate

The next task is an end-to-end cloud business schema and migration implementation plan: first define domain contracts, shadow import, incremental catch-up, empty-environment restore and rollback evidence; then map business data and structured question-bank text into RDS while mapping rich-media objects through the NAS/存储代理 boundary. Before any real RDS creation, the implementation plan must recheck the target region/VPC/SKU, capture the final price, choose the exact HA/TLS form, define RPO/RTO and backup retention, and obtain a separate authorization to create cloud resources. Real desktop data, NAS and removable drives remain out of scope until those migration gates are independently approved.
