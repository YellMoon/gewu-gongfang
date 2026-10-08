BEGIN;

CREATE TABLE business.personal_finance_owners (
 tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id),
 account_id text COLLATE "C" NOT NULL CHECK(account_id<>'' AND account_id=btrim(account_id)),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(tenant_id,account_id)
);
CREATE TABLE business.personal_finance_accounts (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ?& ARRAY['id','label','provider','type','maskedIdentifier','currency','openingBalanceMinor','openingDate','status'] AND data->>'id'=id AND data->>'currency' ~ '^[A-Z]{3}$' AND (data->'openingBalanceMinor'='null'::jsonb OR (jsonb_typeof(data->'openingBalanceMinor')='string' AND data->>'openingBalanceMinor' ~ '^-?(0|[1-9][0-9]*)$'))),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,account_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.personal_finance_owners
);
CREATE TABLE business.personal_finance_imports (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 financial_account_id text COLLATE "C" NOT NULL,
 file_hash text NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ?& ARRAY['id','financialAccountId','fileHash','archiveReference'] AND data->>'id'=id AND data->>'financialAccountId'=financial_account_id AND data->>'fileHash'=file_hash),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,account_id,id),
 UNIQUE(tenant_id,account_id,id,financial_account_id),
 FOREIGN KEY(tenant_id,account_id,financial_account_id) REFERENCES business.personal_finance_accounts
);
CREATE TABLE business.personal_finance_observations (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 financial_account_id text COLLATE "C" NOT NULL,
 import_id text COLLATE "C" NOT NULL,
 transaction_key text COLLATE "C" NOT NULL CHECK(transaction_key ~ '^[0-9a-f]{64}$'),
 source_key text COLLATE "C" NOT NULL CHECK(source_key ~ '^[0-9a-f]{64}$'),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ?& ARRAY['id','financialAccountId','importId','amountMinor','currency','direction','kind','status'] AND data->>'id'=id AND data->>'financialAccountId'=financial_account_id AND data->>'importId'=import_id AND jsonb_typeof(data->'amountMinor')='string' AND data->>'amountMinor' ~ '^(0|[1-9][0-9]*)$' AND data->>'currency' ~ '^[A-Z]{3}$' AND data->>'direction' IN ('debit','credit') AND data->>'kind' IN ('expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown') AND data->>'status' IN ('completed','pending','failed')),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,account_id,id),
 UNIQUE(tenant_id,account_id,financial_account_id,source_key),
 FOREIGN KEY(tenant_id,account_id,financial_account_id) REFERENCES business.personal_finance_accounts,
 FOREIGN KEY(tenant_id,account_id,import_id,financial_account_id) REFERENCES business.personal_finance_imports(tenant_id,account_id,id,financial_account_id)
);
CREATE INDEX personal_finance_observations_identity ON business.personal_finance_observations(tenant_id,account_id,financial_account_id,transaction_key);
CREATE TABLE business.personal_finance_links (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 observation_a text COLLATE "C" NOT NULL,
 observation_b text COLLATE "C" NOT NULL CHECK(observation_a<>observation_b),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted')),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 PRIMARY KEY(tenant_id,account_id,id),
 FOREIGN KEY(tenant_id,account_id,observation_a) REFERENCES business.personal_finance_observations(tenant_id,account_id,id),
 FOREIGN KEY(tenant_id,account_id,observation_b) REFERENCES business.personal_finance_observations(tenant_id,account_id,id)
);
CREATE UNIQUE INDEX personal_finance_links_active_pair ON business.personal_finance_links(tenant_id,account_id,LEAST(observation_a,observation_b),GREATEST(observation_a,observation_b)) WHERE status='active';
CREATE TABLE business.personal_finance_balance_snapshots (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 financial_account_id text COLLATE "C" NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 PRIMARY KEY(tenant_id,account_id,id),
 FOREIGN KEY(tenant_id,account_id,financial_account_id) REFERENCES business.personal_finance_accounts
);
CREATE TABLE business.personal_finance_receipts (
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 idempotency_key text COLLATE "C" NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 256),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 receipt jsonb NOT NULL,
 PRIMARY KEY(tenant_id,account_id,idempotency_key),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.personal_finance_owners
);
CREATE TABLE business.personal_finance_annotations (
 id text COLLATE "C" NOT NULL,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 observation_id text COLLATE "C" NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ?& ARRAY['id','observationId','patch','revision','createdAt'] AND data->>'id'=id AND data->>'observationId'=observation_id AND data->>'revision'=revision::text),
 PRIMARY KEY(tenant_id,account_id,id),
 FOREIGN KEY(tenant_id,account_id,observation_id) REFERENCES business.personal_finance_observations(tenant_id,account_id,id)
);
CREATE INDEX personal_finance_annotations_source ON business.personal_finance_annotations(tenant_id,account_id,observation_id,revision DESC);
CREATE TABLE business.personal_finance_audit (
 id text COLLATE "C" PRIMARY KEY,
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 revision bigint NOT NULL,
 action text NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.personal_finance_owners
);
CREATE INDEX personal_finance_receipts_import ON business.personal_finance_receipts(tenant_id,account_id,(receipt->>'importId'));
CREATE INDEX personal_finance_audit_owner ON business.personal_finance_audit(tenant_id,account_id,revision);
REVOKE ALL ON business.personal_finance_owners,business.personal_finance_accounts,business.personal_finance_imports,business.personal_finance_observations,business.personal_finance_links,business.personal_finance_balance_snapshots,business.personal_finance_receipts,business.personal_finance_audit,business.personal_finance_annotations FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON business.personal_finance_owners,business.personal_finance_accounts,business.personal_finance_links TO gewu_cloud_schedule_reader;
GRANT SELECT,INSERT ON business.personal_finance_imports,business.personal_finance_observations,business.personal_finance_balance_snapshots,business.personal_finance_receipts,business.personal_finance_audit,business.personal_finance_annotations TO gewu_cloud_schedule_reader;
COMMIT;
