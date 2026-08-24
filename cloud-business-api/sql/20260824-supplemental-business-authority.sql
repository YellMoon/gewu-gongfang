BEGIN;

CREATE TABLE IF NOT EXISTS business.payments (
  id text COLLATE "C" PRIMARY KEY CHECK (id=btrim(id) AND id<>'' AND length(id)<=128),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  student_id text COLLATE "C" NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0 AND amount<=100000000),
  payment_type smallint NOT NULL CHECK (payment_type IN (1,2)),
  payment_date date NOT NULL,
  payment_method text CHECK (payment_method IS NULL OR (payment_method=btrim(payment_method) AND length(payment_method)<=128)),
  notes text CHECK (notes IS NULL OR length(notes)<=2000),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS business.consumptions (
  id text COLLATE "C" PRIMARY KEY CHECK (id=btrim(id) AND id<>'' AND length(id)<=128),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  schedule_id text COLLATE "C" NOT NULL,
  student_id text COLLATE "C" NOT NULL,
  hours numeric(8,2) NOT NULL CHECK (hours>0 AND hours<=10000),
  amount numeric(14,2) NOT NULL CHECK (amount>=0 AND amount<=100000000),
  consumption_date date NOT NULL,
  notes text CHECK (notes IS NULL OR length(notes)<=2000),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS business.grades (
  id text COLLATE "C" PRIMARY KEY CHECK (id=btrim(id) AND id<>'' AND length(id)<=128),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  student_id text COLLATE "C" NOT NULL,
  subject text NOT NULL CHECK (subject=btrim(subject) AND subject<>'' AND length(subject)<=128),
  score numeric(8,2) NOT NULL CHECK (score>=0 AND score<=10000),
  exam_date date,
  notes text CHECK (notes IS NULL OR length(notes)<=2000),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS business.personal_asset_manual_categories (
  category_id text COLLATE "C" PRIMARY KEY CHECK (category_id=btrim(category_id) AND category_id<>'' AND length(category_id)<=128),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  name text NOT NULL CHECK (name=btrim(name) AND name<>'' AND length(name)<=128),
  category_type text COLLATE "C" NOT NULL CHECK (category_type IN ('income','expense')),
  color text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (tenant_id,account_id,category_type,name)
);

CREATE TABLE IF NOT EXISTS business.personal_asset_manual_records (
  record_id text COLLATE "C" PRIMARY KEY CHECK (record_id=btrim(record_id) AND record_id<>'' AND length(record_id)<=128),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  record_date date NOT NULL,
  record_type text COLLATE "C" NOT NULL CHECK (record_type IN ('income','expense')),
  category_id text COLLATE "C" NOT NULL,
  category_name text NOT NULL CHECK (category_name=btrim(category_name) AND category_name<>'' AND length(category_name)<=128),
  amount numeric(14,2) NOT NULL CHECK (amount>0 AND amount<=100000000),
  student_id text COLLATE "C",
  student_name text,
  note text NOT NULL DEFAULT '' CHECK (length(note)<=2000),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX IF NOT EXISTS payments_tenant_student_idx ON business.payments(tenant_id,student_id,payment_date DESC) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS consumptions_tenant_student_idx ON business.consumptions(tenant_id,student_id,consumption_date DESC) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS grades_tenant_student_idx ON business.grades(tenant_id,student_id,exam_date DESC) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS personal_asset_manual_categories_owner_idx ON business.personal_asset_manual_categories(tenant_id,account_id,category_type,name) WHERE deleted=false;
CREATE INDEX IF NOT EXISTS personal_asset_manual_records_owner_idx ON business.personal_asset_manual_records(tenant_id,account_id,record_date DESC) WHERE deleted=false;

REVOKE ALL ON TABLE business.payments FROM PUBLIC;
REVOKE ALL ON TABLE business.consumptions FROM PUBLIC;
REVOKE ALL ON TABLE business.grades FROM PUBLIC;
REVOKE ALL ON TABLE business.personal_asset_manual_categories FROM PUBLIC;
REVOKE ALL ON TABLE business.personal_asset_manual_records FROM PUBLIC;
GRANT SELECT ON TABLE business.payments TO gewu_cloud_schedule_reader;
GRANT SELECT ON TABLE business.consumptions TO gewu_cloud_schedule_reader;
GRANT SELECT ON TABLE business.grades TO gewu_cloud_schedule_reader;
GRANT SELECT ON TABLE business.personal_asset_manual_categories TO gewu_cloud_schedule_reader;
GRANT SELECT ON TABLE business.personal_asset_manual_records TO gewu_cloud_schedule_reader;
GRANT SELECT,INSERT,UPDATE ON TABLE business.payments TO vnext_pg17_writer;
GRANT SELECT,INSERT,UPDATE ON TABLE business.consumptions TO vnext_pg17_writer;
GRANT SELECT,INSERT,UPDATE ON TABLE business.grades TO vnext_pg17_writer;
GRANT SELECT,INSERT,UPDATE ON TABLE business.personal_asset_manual_categories TO vnext_pg17_writer;
GRANT SELECT,INSERT,UPDATE ON TABLE business.personal_asset_manual_records TO vnext_pg17_writer;

COMMIT;
