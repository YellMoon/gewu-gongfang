BEGIN;

CREATE TABLE business.questions (
  id text COLLATE "C" PRIMARY KEY CHECK (id = btrim(id) AND id <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id = btrim(tenant_id) AND tenant_id <> ''),
  subject text NOT NULL CHECK (subject = btrim(subject) AND subject <> ''),
  subject_id text COLLATE "C",
  chapter_id text COLLATE "C",
  question_type text NOT NULL CHECK (question_type = btrim(question_type) AND question_type <> ''),
  difficulty integer NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  source text,
  exam_year text,
  grade text,
  semester text,
  exam_type text,
  region text,
  school text,
  edit_status text NOT NULL DEFAULT 'unreviewed' CHECK (edit_status IN ('unreviewed','reviewed')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  has_image boolean NOT NULL DEFAULT false,
  has_formula boolean NOT NULL DEFAULT false,
  created_by_account_id text COLLATE "C",
  taxonomy_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(taxonomy_json)='object'),
  deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT questions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT questions_tenant_id_id_unique UNIQUE (tenant_id,id),
  CONSTRAINT questions_deleted_at_check CHECK ((deleted=false AND deleted_at IS NULL) OR (deleted=true AND deleted_at IS NOT NULL))
);
CREATE INDEX questions_tenant_status_idx ON business.questions(tenant_id,status,updated_at DESC) WHERE deleted=false;
CREATE INDEX questions_taxonomy_gin_idx ON business.questions USING gin(taxonomy_json);

CREATE TABLE business.question_contents (
  question_id text COLLATE "C" PRIMARY KEY CHECK (question_id = btrim(question_id) AND question_id <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id = btrim(tenant_id) AND tenant_id <> ''),
  stem text NOT NULL,
  answer text,
  explanation text,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options_json)='array'),
  rich_content_json jsonb,
  search_text text,
  content_hash text COLLATE "C" NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT question_contents_question_tenant_fk FOREIGN KEY (tenant_id,question_id) REFERENCES business.questions(tenant_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX question_contents_tenant_updated_idx ON business.question_contents(tenant_id,updated_at DESC) WHERE deleted=false;

CREATE TABLE business.question_assets (
  id text COLLATE "C" PRIMARY KEY CHECK (id = btrim(id) AND id <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id = btrim(tenant_id) AND tenant_id <> ''),
  question_id text COLLATE "C" NOT NULL CHECK (question_id = btrim(question_id) AND question_id <> ''),
  asset_type text NOT NULL CHECK (asset_type = btrim(asset_type) AND asset_type <> ''),
  file_name text,
  mime_type text NOT NULL CHECK (mime_type = btrim(mime_type) AND mime_type <> ''),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_object_id text COLLATE "C" NOT NULL CHECK (storage_object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  storage_object_version integer NOT NULL CHECK (storage_object_version > 0),
  content_hash text COLLATE "C" NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  state text COLLATE "C" NOT NULL CHECK (state IN ('queued','verified','deleted')),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT question_assets_question_tenant_fk FOREIGN KEY (tenant_id,question_id) REFERENCES business.questions(tenant_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT question_assets_deleted_state_check CHECK ((deleted=false AND state IN ('queued','verified')) OR (deleted=true AND state='deleted')),
  CONSTRAINT question_assets_object_version_unique UNIQUE (storage_object_id,storage_object_version)
);
CREATE INDEX question_assets_question_idx ON business.question_assets(tenant_id,question_id,created_at) WHERE deleted=false;

REVOKE ALL ON TABLE business.questions, business.question_contents, business.question_assets FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE business.questions, business.question_contents, business.question_assets TO gewu_cloud_schedule_reader;

COMMIT;
