begin;

create table if not exists storage.file_objects (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: storage.file_objects(tenant_id)
  logical_kind text not null,
  logical_name text not null,
  media_type text,
  created_at timestamptz not null,
  deleted_at timestamptz,
  unique(tenant_id, logical_kind, logical_name)
);
create index if not exists storage_file_objects_tenant_id_idx on storage.file_objects (tenant_id);

create table if not exists storage.file_versions (
  id text primary key,
  file_object_id text not null references storage.file_objects(id), -- fk-index: storage.file_versions(file_object_id)
  version_number bigint not null check (version_number > 0),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  status text not null check (status in ('pending','staged','verified','missing','quarantined','deleted')),
  verified_receipt_id text,
  created_at timestamptz not null,
  check (status <> 'verified' or verified_receipt_id is not null),
  unique(file_object_id, version_number),
  unique(file_object_id, sha256, byte_size)
);
create index if not exists storage_file_versions_file_object_id_idx on storage.file_versions (file_object_id);
create index if not exists storage_file_versions_verified_receipt_id_idx on storage.file_versions (verified_receipt_id);

create table if not exists storage.storage_locations (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: storage.storage_locations(tenant_id)
  location_kind text not null check (location_kind in ('cloud_object','nas','removable_drive','local_cache')),
  root_uri text not null,
  credential_reference text,
  status text not null check (status in ('active','read_only','offline','retired')),
  created_at timestamptz not null,
  unique(tenant_id, root_uri)
);
create index if not exists storage_storage_locations_tenant_id_idx on storage.storage_locations (tenant_id);

create table if not exists storage.storage_agents (
  id text primary key,
  installation_id text not null references access.installations(id), -- fk-index: storage.storage_agents(installation_id)
  location_id text not null references storage.storage_locations(id), -- fk-index: storage.storage_agents(location_id)
  public_key_fingerprint text not null,
  status text not null check (status in ('pending','active','restricted','revoked')),
  last_seen_at timestamptz,
  unique(installation_id, location_id)
);
create index if not exists storage_storage_agents_installation_id_idx on storage.storage_agents (installation_id);
create index if not exists storage_storage_agents_location_id_idx on storage.storage_agents (location_id);

create table if not exists storage.file_verification_receipts (
  id text primary key,
  file_version_id text not null references storage.file_versions(id), -- fk-index: storage.file_verification_receipts(file_version_id)
  location_id text not null references storage.storage_locations(id), -- fk-index: storage.file_verification_receipts(location_id)
  storage_agent_id text references storage.storage_agents(id), -- fk-index: storage.file_verification_receipts(storage_agent_id)
  observed_sha256 char(64) not null check (observed_sha256 ~ '^[0-9a-f]{64}$'),
  observed_byte_size bigint not null check (observed_byte_size >= 0),
  verified_at timestamptz not null,
  signature text not null,
  unique(file_version_id, location_id, observed_sha256, observed_byte_size)
);
create index if not exists storage_file_verification_receipts_file_version_id_idx on storage.file_verification_receipts (file_version_id);
create index if not exists storage_file_verification_receipts_location_id_idx on storage.file_verification_receipts (location_id);
create index if not exists storage_file_verification_receipts_storage_agent_id_idx on storage.file_verification_receipts (storage_agent_id);

alter table storage.file_versions
  add constraint storage_file_versions_verified_receipt_fk
  foreign key (verified_receipt_id) references storage.file_verification_receipts(id); -- fk-index: storage.file_versions(verified_receipt_id)

create table if not exists storage.file_replicas (
  id text primary key,
  file_version_id text not null references storage.file_versions(id), -- fk-index: storage.file_replicas(file_version_id)
  location_id text not null references storage.storage_locations(id), -- fk-index: storage.file_replicas(location_id)
  verified_receipt_id text references storage.file_verification_receipts(id), -- fk-index: storage.file_replicas(verified_receipt_id)
  relative_path text not null check (relative_path !~ '(^|[\\/])\.\.([\\/]|$)'),
  state text not null check (state in ('staged','verified','missing','quarantined','deleted')),
  created_at timestamptz not null,
  unique(file_version_id, location_id, relative_path),
  check (state <> 'verified' or verified_receipt_id is not null)
);
create index if not exists storage_file_replicas_file_version_id_idx on storage.file_replicas (file_version_id);
create index if not exists storage_file_replicas_location_id_idx on storage.file_replicas (location_id);
create index if not exists storage_file_replicas_verified_receipt_id_idx on storage.file_replicas (verified_receipt_id);

create table if not exists storage.storage_jobs (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: storage.storage_jobs(tenant_id)
  requested_by_account_id text not null references identity.accounts(id), -- fk-index: storage.storage_jobs(requested_by_account_id)
  job_type text not null check (job_type in ('import_copy','paper_export','backup','restore_verify','replicate','garbage_collect')),
  idempotency_key text not null,
  request_payload jsonb not null,
  status text not null check (status in ('queued','leased','running','succeeded','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  completed_at timestamptz,
  unique(tenant_id, idempotency_key)
);
create index if not exists storage_storage_jobs_tenant_id_idx on storage.storage_jobs (tenant_id);
create index if not exists storage_storage_jobs_requested_by_account_id_idx on storage.storage_jobs (requested_by_account_id);
create index if not exists storage_storage_jobs_dispatch_idx on storage.storage_jobs (status, available_at);

create table if not exists storage.storage_job_receipts (
  id text primary key,
  storage_job_id text not null references storage.storage_jobs(id), -- fk-index: storage.storage_job_receipts(storage_job_id)
  storage_agent_id text references storage.storage_agents(id), -- fk-index: storage.storage_job_receipts(storage_agent_id)
  result_payload jsonb not null,
  result_hash char(64) not null check (result_hash ~ '^[0-9a-f]{64}$'),
  signature text not null,
  created_at timestamptz not null
);
create index if not exists storage_storage_job_receipts_storage_job_id_idx on storage.storage_job_receipts (storage_job_id);
create index if not exists storage_storage_job_receipts_storage_agent_id_idx on storage.storage_job_receipts (storage_agent_id);

create table if not exists storage.backup_sets (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: storage.backup_sets(tenant_id)
  location_id text not null references storage.storage_locations(id), -- fk-index: storage.backup_sets(location_id)
  manifest_hash char(64) not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('building','sealed','verified','failed','expired')),
  created_at timestamptz not null,
  verified_at timestamptz
);
create index if not exists storage_backup_sets_tenant_id_idx on storage.backup_sets (tenant_id);
create index if not exists storage_backup_sets_location_id_idx on storage.backup_sets (location_id);

create table if not exists storage.backup_members (
  backup_set_id text not null references storage.backup_sets(id), -- fk-index: storage.backup_members(backup_set_id)
  file_version_id text not null references storage.file_versions(id), -- fk-index: storage.backup_members(file_version_id)
  relative_path text not null,
  primary key (backup_set_id, file_version_id)
);
create index if not exists storage_backup_members_backup_set_id_idx on storage.backup_members (backup_set_id);
create index if not exists storage_backup_members_file_version_id_idx on storage.backup_members (file_version_id);

create table if not exists question.taxonomy_systems (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.taxonomy_systems(tenant_id)
  name text not null,
  version_label text not null,
  status text not null check (status in ('draft','active','retired')),
  unique(tenant_id, name, version_label)
);
create index if not exists question_taxonomy_systems_tenant_id_idx on question.taxonomy_systems (tenant_id);

create table if not exists question.taxonomy_nodes (
  id text primary key,
  taxonomy_system_id text not null references question.taxonomy_systems(id), -- fk-index: question.taxonomy_nodes(taxonomy_system_id)
  parent_id text references question.taxonomy_nodes(id), -- fk-index: question.taxonomy_nodes(parent_id)
  node_kind text not null,
  label text not null,
  sort_order integer not null default 0,
  unique(taxonomy_system_id, parent_id, node_kind, label)
);
create index if not exists question_taxonomy_nodes_taxonomy_system_id_idx on question.taxonomy_nodes (taxonomy_system_id);
create index if not exists question_taxonomy_nodes_parent_id_idx on question.taxonomy_nodes (parent_id);

create table if not exists question.chapters (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.chapters(tenant_id)
  subject_id text references business.subjects(id), -- fk-index: question.chapters(subject_id)
  parent_id text references question.chapters(id), -- fk-index: question.chapters(parent_id)
  title text not null,
  sort_order integer not null default 0
);
create index if not exists question_chapters_tenant_id_idx on question.chapters (tenant_id);
create index if not exists question_chapters_subject_id_idx on question.chapters (subject_id);
create index if not exists question_chapters_parent_id_idx on question.chapters (parent_id);

create table if not exists question.knowledge_points (
  id text primary key,
  chapter_id text not null references question.chapters(id), -- fk-index: question.knowledge_points(chapter_id)
  parent_id text references question.knowledge_points(id), -- fk-index: question.knowledge_points(parent_id)
  title text not null,
  sort_order integer not null default 0
);
create index if not exists question_knowledge_points_chapter_id_idx on question.knowledge_points (chapter_id);
create index if not exists question_knowledge_points_parent_id_idx on question.knowledge_points (parent_id);

create table if not exists question.model_points (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.model_points(tenant_id)
  model_name text not null,
  point_key text not null,
  label text not null,
  unique(tenant_id, model_name, point_key)
);
create index if not exists question_model_points_tenant_id_idx on question.model_points (tenant_id);

create table if not exists question.questions (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.questions(tenant_id)
  subject_id text references business.subjects(id), -- fk-index: question.questions(subject_id)
  source_file_version_id text references storage.file_versions(id), -- fk-index: question.questions(source_file_version_id)
  question_type text not null,
  difficulty numeric(6, 3),
  status text not null check (status in ('draft','active','retired','quarantined')),
  source_fingerprint text,
  row_version bigint not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists question_questions_tenant_id_idx on question.questions (tenant_id);
create index if not exists question_questions_subject_id_idx on question.questions (subject_id);
create index if not exists question_questions_source_file_version_id_idx on question.questions (source_file_version_id);

create table if not exists question.question_contents (
  id text primary key,
  question_id text not null references question.questions(id), -- fk-index: question.question_contents(question_id)
  locale text not null default 'zh-CN',
  content_format text not null check (content_format in ('structured_json','html','markdown','plain_text')),
  stem jsonb not null,
  answer jsonb,
  analysis jsonb,
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  unique(question_id, locale, content_hash)
);
create index if not exists question_question_contents_question_id_idx on question.question_contents (question_id);

create table if not exists question.question_taxonomy_nodes (
  question_id text not null references question.questions(id), -- fk-index: question.question_taxonomy_nodes(question_id)
  taxonomy_node_id text not null references question.taxonomy_nodes(id), -- fk-index: question.question_taxonomy_nodes(taxonomy_node_id)
  primary key (question_id, taxonomy_node_id)
);
create index if not exists question_question_taxonomy_nodes_question_id_idx on question.question_taxonomy_nodes (question_id);
create index if not exists question_question_taxonomy_nodes_taxonomy_node_id_idx on question.question_taxonomy_nodes (taxonomy_node_id);

create table if not exists question.question_knowledge_points (
  question_id text not null references question.questions(id), -- fk-index: question.question_knowledge_points(question_id)
  knowledge_point_id text not null references question.knowledge_points(id), -- fk-index: question.question_knowledge_points(knowledge_point_id)
  primary key (question_id, knowledge_point_id)
);
create index if not exists question_question_knowledge_points_question_id_idx on question.question_knowledge_points (question_id);
create index if not exists question_question_knowledge_points_knowledge_point_id_idx on question.question_knowledge_points (knowledge_point_id);

create table if not exists question.question_model_points (
  question_id text not null references question.questions(id), -- fk-index: question.question_model_points(question_id)
  model_point_id text not null references question.model_points(id), -- fk-index: question.question_model_points(model_point_id)
  confidence numeric(6, 5),
  primary key (question_id, model_point_id)
);
create index if not exists question_question_model_points_question_id_idx on question.question_model_points (question_id);
create index if not exists question_question_model_points_model_point_id_idx on question.question_model_points (model_point_id);

create table if not exists question.import_batches (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.import_batches(tenant_id)
  requested_by_account_id text not null references identity.accounts(id), -- fk-index: question.import_batches(requested_by_account_id)
  source_snapshot_hash char(64) not null check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending','running','succeeded','failed','quarantined')),
  created_at timestamptz not null,
  completed_at timestamptz
);
create index if not exists question_import_batches_tenant_id_idx on question.import_batches (tenant_id);
create index if not exists question_import_batches_requested_by_account_id_idx on question.import_batches (requested_by_account_id);

create table if not exists question.import_items (
  id text primary key,
  import_batch_id text not null references question.import_batches(id), -- fk-index: question.import_items(import_batch_id)
  source_record_key text not null,
  question_id text references question.questions(id), -- fk-index: question.import_items(question_id)
  status text not null check (status in ('pending','imported','duplicate','quarantined','failed')),
  reason_code text,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  unique(import_batch_id, source_record_key)
);
create index if not exists question_import_items_import_batch_id_idx on question.import_items (import_batch_id);
create index if not exists question_import_items_question_id_idx on question.import_items (question_id);

create table if not exists question.paper_jobs (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: question.paper_jobs(tenant_id)
  requested_by_account_id text not null references identity.accounts(id), -- fk-index: question.paper_jobs(requested_by_account_id)
  selection_spec jsonb not null,
  output_format text not null check (output_format in ('docx','pdf')),
  status text not null check (status in ('queued','running','succeeded','failed','cancelled')),
  created_at timestamptz not null,
  completed_at timestamptz
);
create index if not exists question_paper_jobs_tenant_id_idx on question.paper_jobs (tenant_id);
create index if not exists question_paper_jobs_requested_by_account_id_idx on question.paper_jobs (requested_by_account_id);

create table if not exists question.paper_artifacts (
  id text primary key,
  paper_job_id text not null references question.paper_jobs(id), -- fk-index: question.paper_artifacts(paper_job_id)
  file_version_id text not null references storage.file_versions(id), -- fk-index: question.paper_artifacts(file_version_id)
  artifact_kind text not null check (artifact_kind in ('question_paper','answer_key','preview')),
  created_at timestamptz not null,
  unique(paper_job_id, artifact_kind)
);
create index if not exists question_paper_artifacts_paper_job_id_idx on question.paper_artifacts (paper_job_id);
create index if not exists question_paper_artifacts_file_version_id_idx on question.paper_artifacts (file_version_id);

commit;
