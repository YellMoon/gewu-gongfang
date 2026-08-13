begin;

create table if not exists identity.tenants (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity.accounts (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: identity.accounts(tenant_id)
  status text not null check (status in ('pending','active','suspended','merged','archived')),
  display_name text,
  password_hash text,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists identity_accounts_tenant_id_idx on identity.accounts (tenant_id);

create table if not exists identity.profiles (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: identity.profiles(tenant_id)
  profile_type text not null check (profile_type in ('teacher','student','guardian','staff','other')),
  display_name text not null,
  status text not null default 'active' check (status in ('active','merged','archived')),
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists identity_profiles_tenant_id_idx on identity.profiles (tenant_id);

create table if not exists identity.profile_bindings (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: identity.profile_bindings(account_id)
  profile_id text not null references identity.profiles(id), -- fk-index: identity.profile_bindings(profile_id)
  binding_type text not null check (binding_type in ('owner','guardian','delegate')),
  evidence_id text,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  created_at timestamptz not null default now(),
  unique(account_id, profile_id, binding_type)
);
create index if not exists identity_profile_bindings_account_id_idx on identity.profile_bindings (account_id);
create index if not exists identity_profile_bindings_profile_id_idx on identity.profile_bindings (profile_id);

create table if not exists identity.verified_contacts (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: identity.verified_contacts(account_id)
  contact_type text not null check (contact_type in ('phone','email')),
  normalized_hash text not null,
  encrypted_value bytea not null,
  verified_at timestamptz not null,
  revoked_at timestamptz,
  unique(contact_type, normalized_hash)
);
create index if not exists identity_verified_contacts_account_id_idx on identity.verified_contacts (account_id);

create table if not exists identity.external_identities (
  id text primary key,
  account_id text references identity.accounts(id), -- fk-index: identity.external_identities(account_id)
  provider text not null,
  provider_subject_hash text not null,
  evidence_status text not null check (evidence_status in ('pending','verified','revoked','conflict')),
  verified_at timestamptz,
  unique(provider, provider_subject_hash)
);
create index if not exists identity_external_identities_account_id_idx on identity.external_identities (account_id);

create table if not exists identity.legacy_account_evidence (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists identity.external_identity_requests (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists access.roles (
  id text primary key,
  tenant_id text references identity.tenants(id), -- fk-index: access.roles(tenant_id)
  role_key text not null,
  description text,
  system_role boolean not null default false,
  unique(tenant_id, role_key)
);
create index if not exists access_roles_tenant_id_idx on access.roles (tenant_id);

create table if not exists access.capabilities (
  capability_key text primary key,
  description text not null,
  risk_level text not null check (risk_level in ('low','medium','high','critical'))
);

create table if not exists access.role_capabilities (
  role_id text not null references access.roles(id), -- fk-index: access.role_capabilities(role_id)
  capability_key text not null references access.capabilities(capability_key), -- fk-index: access.role_capabilities(capability_key)
  primary key(role_id, capability_key)
);
create index if not exists access_role_capabilities_role_id_idx on access.role_capabilities (role_id);
create index if not exists access_role_capabilities_capability_key_idx on access.role_capabilities (capability_key);

create table if not exists access.account_roles (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: access.account_roles(account_id)
  role_id text not null references access.roles(id), -- fk-index: access.account_roles(role_id)
  status text not null check (status in ('pending','active','revoked','expired')),
  granted_at timestamptz,
  revoked_at timestamptz,
  unique(account_id, role_id)
);
create index if not exists access_account_roles_account_id_idx on access.account_roles (account_id);
create index if not exists access_account_roles_role_id_idx on access.account_roles (role_id);

create table if not exists access.scopes (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: access.scopes(tenant_id)
  scope_type text not null,
  scope_key text not null,
  unique(tenant_id, scope_type, scope_key)
);
create index if not exists access_scopes_tenant_id_idx on access.scopes (tenant_id);

create table if not exists access.account_scopes (
  account_role_id text not null references access.account_roles(id), -- fk-index: access.account_scopes(account_role_id)
  scope_id text not null references access.scopes(id), -- fk-index: access.account_scopes(scope_id)
  primary key(account_role_id, scope_id)
);
create index if not exists access_account_scopes_account_role_id_idx on access.account_scopes (account_role_id);
create index if not exists access_account_scopes_scope_id_idx on access.account_scopes (scope_id);

create table if not exists access.devices (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: access.devices(tenant_id)
  device_class text not null,
  risk_status text not null default 'unknown' check (risk_status in ('unknown','trusted','restricted','blocked')),
  created_at timestamptz not null default now()
);
create index if not exists access_devices_tenant_id_idx on access.devices (tenant_id);

create table if not exists access.installations (
  id text primary key,
  device_id text not null references access.devices(id), -- fk-index: access.installations(device_id)
  public_key bytea not null,
  key_fingerprint text not null unique,
  clone_status text not null default 'clear' check (clone_status in ('clear','suspected','confirmed')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists access_installations_device_id_idx on access.installations (device_id);

create table if not exists access.activation_evidence (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: access.activation_evidence(account_id)
  installation_id text not null references access.installations(id), -- fk-index: access.activation_evidence(installation_id)
  evidence_type text not null check (evidence_type in ('fresh_login_key_proof','admin_recovery')),
  verified_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > verified_at)
);
create index if not exists access_activation_evidence_account_id_idx on access.activation_evidence (account_id);
create index if not exists access_activation_evidence_installation_id_idx on access.activation_evidence (installation_id);

create table if not exists access.account_device_links (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: access.account_device_links(account_id)
  installation_id text not null references access.installations(id), -- fk-index: access.account_device_links(installation_id)
  activation_evidence_id text references access.activation_evidence(id), -- fk-index: access.account_device_links(activation_evidence_id)
  status text not null check (status in ('pending','active','restricted','revoked')),
  activated_at timestamptz,
  revoked_at timestamptz,
  check (status <> 'active' or activation_evidence_id is not null),
  unique(account_id, installation_id)
);
create index if not exists access_account_device_links_account_id_idx on access.account_device_links (account_id);
create index if not exists access_account_device_links_installation_id_idx on access.account_device_links (installation_id);
create index if not exists access_account_device_links_activation_evidence_id_idx on access.account_device_links (activation_evidence_id);

create table if not exists access.recent_auth_evidence (
  id text primary key,
  account_id text not null references identity.accounts(id), -- fk-index: access.recent_auth_evidence(account_id)
  installation_id text not null references access.installations(id), -- fk-index: access.recent_auth_evidence(installation_id)
  method text not null,
  authenticated_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > authenticated_at)
);
create index if not exists access_recent_auth_evidence_account_id_idx on access.recent_auth_evidence (account_id);
create index if not exists access_recent_auth_evidence_installation_id_idx on access.recent_auth_evidence (installation_id);

create table if not exists access.offline_licenses (
  id text primary key,
  account_device_link_id text not null references access.account_device_links(id), -- fk-index: access.offline_licenses(account_device_link_id)
  partition_id text not null,
  capability_hash text not null,
  scope_hash text not null,
  snapshot_hash text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at and expires_at <= issued_at + interval '30 days'),
  revoked_at timestamptz
);
create index if not exists access_offline_licenses_account_device_link_id_idx on access.offline_licenses (account_device_link_id);

create table if not exists access.account_memberships (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists access.role_applications (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists access.role_bindings (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

create table if not exists access.legacy_role_evidence (
  id text primary key,
  source_table text not null,
  source_record_key text not null,
  source_row_hash char(64) not null check (source_row_hash ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb not null,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  imported_at timestamptz not null,
  unique(source_table, source_record_key)
);

commit;
