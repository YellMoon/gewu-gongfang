BEGIN;

CREATE TABLE IF NOT EXISTS business.personal_asset_imports (
  import_id text COLLATE "C" PRIMARY KEY CHECK (import_id ~ '^asset_import_[A-Za-z0-9_-]{8,128}$'),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  idempotency_key text COLLATE "C" NOT NULL CHECK (idempotency_key=btrim(idempotency_key) AND length(idempotency_key)<=256),
  request_hash text COLLATE "C" NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  record_count integer NOT NULL CHECK (record_count BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (tenant_id,account_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS business.personal_asset_categories (
  category_id text COLLATE "C" PRIMARY KEY CHECK (category_id ~ '^asset_category_[0-9a-f]{32}$'),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  name text NOT NULL CHECK (name=btrim(name) AND name<>'' AND length(name)<=128),
  category_type text COLLATE "C" NOT NULL CHECK (category_type IN ('income','expense')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (tenant_id,account_id,category_type,name)
);

CREATE TABLE IF NOT EXISTS business.personal_asset_records (
  record_id text COLLATE "C" PRIMARY KEY CHECK (record_id ~ '^asset_record_[0-9a-f]{32}$'),
  import_id text COLLATE "C" NOT NULL REFERENCES business.personal_asset_imports(import_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_ordinal integer NOT NULL CHECK (source_ordinal BETWEEN 1 AND 1000),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  record_date date NOT NULL,
  record_type text COLLATE "C" NOT NULL CHECK (record_type IN ('income','expense')),
  category_id text COLLATE "C" NOT NULL REFERENCES business.personal_asset_categories(category_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  category_name text NOT NULL CHECK (category_name=btrim(category_name) AND category_name<>'' AND length(category_name)<=128),
  amount numeric(14,2) NOT NULL CHECK (amount>0 AND amount<=100000000),
  note text NOT NULL DEFAULT '' CHECK (note=trim(note) AND length(note)<=2000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (import_id,source_ordinal)
);

CREATE INDEX IF NOT EXISTS personal_asset_records_owner_idx ON business.personal_asset_records(tenant_id,account_id,record_date DESC,record_id);
CREATE INDEX IF NOT EXISTS personal_asset_categories_owner_idx ON business.personal_asset_categories(tenant_id,account_id,category_type,name);

REVOKE ALL ON TABLE business.personal_asset_imports FROM PUBLIC;
REVOKE ALL ON TABLE business.personal_asset_categories FROM PUBLIC;
REVOKE ALL ON TABLE business.personal_asset_records FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.personal_asset_imports TO gewu_cloud_schedule_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.personal_asset_categories TO gewu_cloud_schedule_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.personal_asset_records TO gewu_cloud_schedule_reader;

COMMIT;
