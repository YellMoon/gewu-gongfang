'use strict';

const { createHash } = require('crypto');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const BUSINESS_FOUNDATION_SQL = `CREATE SCHEMA business AUTHORIZATION vnext_pg17_business_owner;
REVOKE CREATE ON SCHEMA business FROM PUBLIC;
CREATE TABLE business.business_schema_migrations (
  migration_id text COLLATE "C" PRIMARY KEY CHECK (btrim(migration_id) <> ''),
  semantic_version integer NOT NULL UNIQUE CHECK (semantic_version > 0),
  manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz),
  applied_by text COLLATE "C" NOT NULL CHECK (btrim(applied_by) <> '')
);
CREATE FUNCTION business.business_schema_migrations_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.semantic_version <> COALESCE((SELECT MAX(semantic_version) FROM business.business_schema_migrations), 0) + 1 THEN
    RAISE EXCEPTION 'business migration version must be consecutive' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION business.business_schema_migrations_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'business migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION business.business_schema_migrations_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'business migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER business_schema_migrations_insert_guard BEFORE INSERT ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_insert_guard();
CREATE TRIGGER business_schema_migrations_no_update BEFORE UPDATE ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_no_update();
CREATE TRIGGER business_schema_migrations_no_delete BEFORE DELETE ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_no_delete();
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_no_delete() FROM PUBLIC;
CREATE TABLE business.tenants (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  legacy_status text,
  legacy_plan text,
  legacy_archive_before timestamptz CHECK (legacy_archive_before IS NULL OR (legacy_archive_before <> 'infinity'::timestamptz AND legacy_archive_before <> '-infinity'::timestamptz)),
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at)
);
CREATE TABLE business.institutions (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  contact_person_legacy text,
  contact_phone_legacy text,
  revenue_share numeric,
  notes text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT institutions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX institutions_tenant_id_idx ON business.institutions(tenant_id);
CREATE TABLE business.schools (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  legacy_count integer,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT schools_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX schools_tenant_id_idx ON business.schools(tenant_id);
CREATE TABLE business.rooms (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  address_legacy text,
  legacy_count integer,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT rooms_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX rooms_tenant_id_idx ON business.rooms(tenant_id);
GRANT USAGE ON SCHEMA business TO vnext_pg17_business_verifier;
GRANT SELECT ON TABLE business.business_schema_migrations TO vnext_pg17_business_verifier;
GRANT SELECT (id) ON TABLE business.tenants, business.institutions, business.schools, business.rooms TO vnext_pg17_business_verifier;`;

const EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256 = '050774ac2ccbc84a6ec14e4c65ce83d18fdd75eb7f73114fd55817497d033a75';
const BUSINESS_CORE_SCHEDULING_SQL = `ALTER TABLE business.institutions ADD CONSTRAINT institutions_tenant_id_id_unique UNIQUE (tenant_id, id);
CREATE TABLE business.teachers (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  phone_legacy text,
  subject text,
  hourly_rate numeric CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  notes text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT teachers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT teachers_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE INDEX teachers_tenant_id_idx ON business.teachers(tenant_id);
CREATE TABLE business.students (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  phone_legacy text,
  school_legacy text,
  grade_year integer,
  grade_current text,
  legacy_source_type integer,
  institution_id text COLLATE "C",
  parent_name_legacy text,
  parent_wechat_legacy text,
  student_source_legacy text,
  legacy_balance_hours numeric,
  legacy_balance_money numeric,
  notes text,
  legacy_is_institution_student boolean NOT NULL,
  parent_phone_legacy text,
  parent_phone_normalized_legacy text,
  parent_relation_legacy text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT students_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT students_institution_tenant_fk FOREIGN KEY (tenant_id, institution_id) REFERENCES business.institutions(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT students_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE INDEX students_tenant_id_idx ON business.students(tenant_id);
CREATE INDEX students_institution_id_idx ON business.students(institution_id);
CREATE TABLE business.courses (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  year integer,
  semester text,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  course_type integer NOT NULL CHECK (course_type IN (1, 2, 3, 4)),
  legacy_source_type integer NOT NULL CHECK (legacy_source_type IN (1, 2, 3)),
  institution_id text COLLATE "C",
  price_tuition numeric CHECK (price_tuition IS NULL OR price_tuition >= 0),
  price_teacher numeric CHECK (price_teacher IS NULL OR price_teacher >= 0),
  billing_unit integer NOT NULL CHECK (billing_unit IN (1, 2)),
  teacher_fee_mode integer NOT NULL CHECK (teacher_fee_mode IN (1, 2)),
  legacy_room_id text COLLATE "C",
  room_name_snapshot text,
  teacher_id text COLLATE "C",
  teacher_name_snapshot text,
  legacy_active boolean NOT NULL,
  default_duration_minutes integer CHECK (default_duration_minutes IS NULL OR default_duration_minutes > 0),
  notes text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT courses_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT courses_institution_tenant_fk FOREIGN KEY (tenant_id, institution_id) REFERENCES business.institutions(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT courses_teacher_tenant_fk FOREIGN KEY (tenant_id, teacher_id) REFERENCES business.teachers(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT courses_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE INDEX courses_tenant_id_idx ON business.courses(tenant_id);
CREATE INDEX courses_institution_id_idx ON business.courses(institution_id);
CREATE INDEX courses_teacher_id_idx ON business.courses(teacher_id);
CREATE TABLE business.course_student_pricings (
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  course_id text COLLATE "C" NOT NULL CHECK (btrim(course_id) <> ''),
  student_id text COLLATE "C" NOT NULL CHECK (btrim(student_id) <> ''),
  tuition numeric NOT NULL CHECK (tuition >= 0),
  teacher_fee numeric NOT NULL CHECK (teacher_fee >= 0),
  PRIMARY KEY (tenant_id, course_id, student_id),
  CONSTRAINT course_student_pricings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT course_student_pricings_course_tenant_fk FOREIGN KEY (tenant_id, course_id) REFERENCES business.courses(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT course_student_pricings_student_tenant_fk FOREIGN KEY (tenant_id, student_id) REFERENCES business.students(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX course_student_pricings_student_id_idx ON business.course_student_pricings(student_id);
CREATE TABLE business.schedules (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  course_id text COLLATE "C" NOT NULL CHECK (btrim(course_id) <> ''),
  start_at timestamptz NOT NULL CHECK (start_at <> 'infinity'::timestamptz AND start_at <> '-infinity'::timestamptz),
  end_at timestamptz NOT NULL CHECK (end_at <> 'infinity'::timestamptz AND end_at <> '-infinity'::timestamptz AND end_at > start_at),
  recurring_rule_json text,
  status integer NOT NULL CHECK (status IN (1, 2, 3, 4)),
  room_display_snapshot text,
  service_type integer,
  calculated_tuition numeric NOT NULL CHECK (calculated_tuition >= 0),
  calculated_teacher_fee numeric NOT NULL CHECK (calculated_teacher_fee >= 0),
  notes text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT schedules_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT schedules_course_tenant_fk FOREIGN KEY (tenant_id, course_id) REFERENCES business.courses(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT schedules_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE INDEX schedules_tenant_id_idx ON business.schedules(tenant_id);
CREATE INDEX schedules_course_id_idx ON business.schedules(course_id);
CREATE INDEX schedules_start_at_idx ON business.schedules(start_at);
CREATE TABLE business.schedule_student_overrides (
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  schedule_id text COLLATE "C" NOT NULL CHECK (btrim(schedule_id) <> ''),
  student_id text COLLATE "C" NOT NULL CHECK (btrim(student_id) <> ''),
  attendance_status integer NOT NULL CHECK (attendance_status IN (1, 3, 4)),
  tuition numeric NOT NULL CHECK (tuition >= 0),
  teacher_fee numeric NOT NULL CHECK (teacher_fee >= 0),
  PRIMARY KEY (tenant_id, schedule_id, student_id),
  CONSTRAINT schedule_student_overrides_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT schedule_student_overrides_schedule_tenant_fk FOREIGN KEY (tenant_id, schedule_id) REFERENCES business.schedules(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT schedule_student_overrides_student_tenant_fk FOREIGN KEY (tenant_id, student_id) REFERENCES business.students(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX schedule_student_overrides_student_id_idx ON business.schedule_student_overrides(student_id);
GRANT SELECT (id) ON TABLE business.teachers, business.students, business.courses, business.schedules TO vnext_pg17_business_verifier;`;

const EXPECTED_BUSINESS_CORE_SCHEDULING_MANIFEST_SHA256 = '2255ac10a2dc3d6b89757adf41d4f90c40971b0bc43c226f09e33f57bb114cfe';
const BUSINESS_FOUNDATION_MIGRATIONS = Object.freeze([
  Object.freeze({
    migrationId: 'business-foundation-1',
    semanticVersion: 1,
    sql: BUSINESS_FOUNDATION_SQL,
    manifestSha256: sha256(BUSINESS_FOUNDATION_SQL),
  }),
  Object.freeze({
    migrationId: 'business-core-scheduling-2',
    semanticVersion: 2,
    sql: BUSINESS_CORE_SCHEDULING_SQL,
    manifestSha256: sha256(BUSINESS_CORE_SCHEDULING_SQL),
  }),
]);

const expectedBusinessFoundationCatalog = Object.freeze({
  relations: Object.freeze([
    'business.business_schema_migrations',
    'business.course_student_pricings',
    'business.courses',
    'business.institutions',
    'business.rooms',
    'business.schedule_student_overrides',
    'business.schedules',
    'business.schools',
    'business.students',
    'business.teachers',
    'business.tenants',
  ]),
});

module.exports = {
  BUSINESS_FOUNDATION_MIGRATIONS,
  EXPECTED_BUSINESS_CORE_SCHEDULING_MANIFEST_SHA256,
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  expectedBusinessFoundationCatalog,
  sha256,
};
