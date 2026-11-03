BEGIN;
CREATE TABLE business.security_closing_prices (
 security_code text COLLATE "C" NOT NULL CHECK(security_code ~ '^[0-9]{6}$'),
 quote_date date NOT NULL,
 provider text NOT NULL CHECK(provider IN ('eastmoney','tencent')),
 close_price text NOT NULL CHECK(close_price ~ '^[0-9]+(\.[0-9]{1,12})?$'),
 security_name text NOT NULL,
 source_url text NOT NULL,
 fetched_at timestamptz NOT NULL,
 PRIMARY KEY(security_code,quote_date,provider)
);
REVOKE ALL ON business.security_closing_prices FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON business.security_closing_prices TO gewu_cloud_schedule_reader;
COMMIT;
