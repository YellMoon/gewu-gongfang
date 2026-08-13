begin;

create table if not exists audit.authorization_events (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: audit.authorization_events(tenant_id)
  account_id text references identity.accounts(id), -- fk-index: audit.authorization_events(account_id)
  installation_id text references access.installations(id), -- fk-index: audit.authorization_events(installation_id)
  capability_key text not null,
  scope_snapshot jsonb not null,
  decision text not null check (decision in ('allow','deny')),
  reason_code text not null,
  policy_version text not null,
  correlation_id text not null,
  occurred_at timestamptz not null
);
create index if not exists audit_authorization_events_tenant_id_idx on audit.authorization_events (tenant_id);
create index if not exists audit_authorization_events_account_id_idx on audit.authorization_events (account_id);
create index if not exists audit_authorization_events_installation_id_idx on audit.authorization_events (installation_id);
create index if not exists audit_authorization_events_correlation_id_idx on audit.authorization_events (correlation_id);

create table if not exists audit.operation_events (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: audit.operation_events(tenant_id)
  actor_account_id text references identity.accounts(id), -- fk-index: audit.operation_events(actor_account_id)
  installation_id text references access.installations(id), -- fk-index: audit.operation_events(installation_id)
  operation_type text not null,
  entity_type text not null,
  entity_id text not null,
  before_hash text,
  after_hash text,
  outcome text not null check (outcome in ('accepted','rejected','failed')),
  correlation_id text not null,
  occurred_at timestamptz not null
);
create index if not exists audit_operation_events_tenant_id_idx on audit.operation_events (tenant_id);
create index if not exists audit_operation_events_actor_account_id_idx on audit.operation_events (actor_account_id);
create index if not exists audit_operation_events_installation_id_idx on audit.operation_events (installation_id);
create index if not exists audit_operation_events_entity_idx on audit.operation_events (entity_type, entity_id);
create index if not exists audit_operation_events_correlation_id_idx on audit.operation_events (correlation_id);

create table if not exists audit.outbox_events (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: audit.outbox_events(tenant_id)
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending','leased','published','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  published_at timestamptz
);
create index if not exists audit_outbox_events_tenant_id_idx on audit.outbox_events (tenant_id);
create index if not exists audit_outbox_events_dispatch_idx on audit.outbox_events (status, available_at);
create index if not exists audit_outbox_events_aggregate_idx on audit.outbox_events (aggregate_type, aggregate_id);

create table if not exists audit.identity_provisioning_events (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  occurred_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists audit.legacy_sync_events (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  occurred_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists audit.legacy_sync_rejections (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  occurred_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists audit.question_delete_events (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  occurred_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists audit.storage_events (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  occurred_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists migration.batches (
  id text primary key,
  environment text not null,
  source_bundle_hash char(64) not null check (source_bundle_hash ~ '^[0-9a-f]{64}$'),
  source_inventory_hash char(64) not null check (source_inventory_hash ~ '^[0-9a-f]{64}$'),
  catalog_hash char(64) not null check (catalog_hash ~ '^[0-9a-f]{64}$'),
  importer_version text not null,
  mode text not null check (mode in ('shadow','production')),
  status text not null check (status in ('prepared','running','verified','failed','rolled_back')),
  started_at timestamptz not null,
  completed_at timestamptz,
  unique(environment, source_bundle_hash, importer_version)
);

create table if not exists migration.source_snapshots (
  id text primary key,
  migration_batch_id text not null references migration.batches(id), -- fk-index: migration.source_snapshots(migration_batch_id)
  logical_source_id text not null,
  physical_source_id text not null,
  snapshot_sha256 char(64) not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  inventory_hash char(64) not null check (inventory_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null,
  unique(migration_batch_id, logical_source_id)
);
create index if not exists migration_source_snapshots_migration_batch_id_idx on migration.source_snapshots (migration_batch_id);

create table if not exists migration.record_ledger (
  id text primary key,
  migration_batch_id text not null references migration.batches(id), -- fk-index: migration.record_ledger(migration_batch_id)
  logical_source_id text not null,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  target_table text,
  target_record_id text,
  target_row_hash char(64),
  disposition text not null check (disposition in ('imported','archived','local_partition','rebuildable_cache','quarantined')),
  recorded_at timestamptz not null,
  unique(migration_batch_id, logical_source_id, source_table, source_record_key)
);
create index if not exists migration_record_ledger_migration_batch_id_idx on migration.record_ledger (migration_batch_id);
create index if not exists migration_record_ledger_source_lookup_idx on migration.record_ledger (logical_source_id, source_table, source_record_key);
create index if not exists migration_record_ledger_target_lookup_idx on migration.record_ledger (target_table, target_record_id);

create table if not exists migration.quarantine_records (
  id text primary key,
  migration_batch_id text not null references migration.batches(id), -- fk-index: migration.quarantine_records(migration_batch_id)
  logical_source_id text not null,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  encrypted_payload jsonb not null,
  reason_code text not null,
  reason_detail text,
  quarantined_at timestamptz not null,
  unique(migration_batch_id, logical_source_id, source_table, source_record_key)
);
create index if not exists migration_quarantine_records_migration_batch_id_idx on migration.quarantine_records (migration_batch_id);

create table if not exists migration.quarantine_resolution_events (
  id text primary key,
  quarantine_record_id text not null references migration.quarantine_records(id), -- fk-index: migration.quarantine_resolution_events(quarantine_record_id)
  action text not null check (action in ('accepted','remapped','discarded','deferred')),
  target_table text,
  target_record_id text,
  actor_reference text not null,
  evidence_hash char(64) not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null
);
create index if not exists migration_quarantine_resolution_events_quarantine_record_id_idx on migration.quarantine_resolution_events (quarantine_record_id);

create table if not exists migration.restore_receipts (
  id text primary key,
  migration_batch_id text not null references migration.batches(id), -- fk-index: migration.restore_receipts(migration_batch_id)
  backup_set_id text references storage.backup_sets(id), -- fk-index: migration.restore_receipts(backup_set_id)
  target_environment text not null,
  restored_inventory_hash char(64) not null check (restored_inventory_hash ~ '^[0-9a-f]{64}$'),
  verification_report_hash char(64) not null check (verification_report_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('verified','failed')),
  restored_at timestamptz not null
);
create index if not exists migration_restore_receipts_migration_batch_id_idx on migration.restore_receipts (migration_batch_id);
create index if not exists migration_restore_receipts_backup_set_id_idx on migration.restore_receipts (backup_set_id);

create table if not exists migration.legacy_record_ledger (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists migration.legacy_schema_events (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists migration.source_metadata (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists migration.source_provenance (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create or replace function audit.reject_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable audit or migration evidence cannot be changed'
    using errcode = '55000';
end;
$$;

drop trigger if exists authorization_events_immutable on audit.authorization_events;
create trigger authorization_events_immutable
before update or delete on audit.authorization_events
for each row execute function audit.reject_immutable_mutation();

drop trigger if exists operation_events_immutable on audit.operation_events;
create trigger operation_events_immutable
before update or delete on audit.operation_events
for each row execute function audit.reject_immutable_mutation();

drop trigger if exists record_ledger_immutable on migration.record_ledger;
create trigger record_ledger_immutable
before update or delete on migration.record_ledger
for each row execute function audit.reject_immutable_mutation();

drop trigger if exists quarantine_records_immutable on migration.quarantine_records;
create trigger quarantine_records_immutable
before update or delete on migration.quarantine_records
for each row execute function audit.reject_immutable_mutation();

drop trigger if exists restore_receipts_immutable on migration.restore_receipts;
create trigger restore_receipts_immutable
before update or delete on migration.restore_receipts
for each row execute function audit.reject_immutable_mutation();

revoke all on all tables in schema identity, access, business, question, storage, audit, migration from public;
revoke all on function audit.reject_immutable_mutation() from public;

grant select, insert, update on all tables in schema identity, access, business, question, storage to gewu_vnext_runtime;
grant select, insert on audit.authorization_events, audit.operation_events to gewu_vnext_runtime;
grant select, insert, update on audit.outbox_events to gewu_vnext_runtime;

grant select, insert, update on all tables in schema identity, access, business, question, storage to gewu_vnext_migrator;
grant select, insert on all tables in schema audit, migration to gewu_vnext_migrator;

grant select on all tables in schema audit, migration to gewu_vnext_auditor;

commit;
