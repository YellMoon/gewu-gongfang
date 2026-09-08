BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- UTF-8: explicit ownership is durable even if the billing record's notes change.
-- Installation does not infer links or rewrite historical business rows.
CREATE TABLE business.institution_billing_students (
  tenant_id text NOT NULL,
  institution_id text NOT NULL,
  student_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,institution_id),
  UNIQUE (tenant_id,student_id),
  FOREIGN KEY (tenant_id,institution_id) REFERENCES business.institutions(tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES business.students(tenant_id,id)
);
REVOKE ALL ON business.institution_billing_students FROM PUBLIC,vnext_pg17_writer,vnext_pg17_business_verifier;

CREATE FUNCTION business.vnext_ensure_institution_billing_student()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE student_key text; candidates text[]; billing_name text; stamp timestamptz;
BEGIN
  -- Owner-led import/restore must keep exact historical data. The parent row is
  -- already locked by its authorized INSERT/UPDATE before any child is locked.
  IF session_user<>'vnext_pg17_writer' OR NEW.legacy_deleted THEN RETURN NEW; END IF;
  billing_name:=btrim(NEW.name)||'学生';
  stamp:=date_trunc('milliseconds',transaction_timestamp());
  SELECT x.student_id INTO student_key FROM business.institution_billing_students x
    WHERE x.tenant_id=NEW.tenant_id AND x.institution_id=NEW.id FOR UPDATE;
  IF student_key IS NULL THEN
    -- Do not treat source=2 (or a historically mis-set flag alone) as ownership.
    candidates:=ARRAY(SELECT s.id FROM business.students s
      WHERE s.tenant_id=NEW.tenant_id AND s.institution_id=NEW.id AND NOT s.legacy_deleted
        AND s.legacy_is_institution_student AND s.notes='机构课程费用专用学生'
      ORDER BY s.id FOR UPDATE);
    IF cardinality(candidates)>1 THEN
      RAISE EXCEPTION 'VNEXT_INSTITUTION_BILLING_AMBIGUOUS' USING ERRCODE='P0001';
    END IF;
    IF cardinality(candidates)=1 THEN student_key:=candidates[1];
    ELSE
      IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM business.students s
        WHERE s.tenant_id=NEW.tenant_id AND s.institution_id=NEW.id AND NOT s.legacy_deleted
          AND s.legacy_is_institution_student AND s.name=btrim(OLD.name)||'学生') THEN
        RAISE EXCEPTION 'VNEXT_INSTITUTION_BILLING_AMBIGUOUS' USING ERRCODE='P0001';
      END IF;
      student_key:='institution-student-'||NEW.id;
      -- UTF-8: do not upsert or misreport a reserved student ID as a name clash.
      BEGIN
      INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_source_type,legacy_balance_hours,legacy_balance_money,
        legacy_is_institution_student,notes,legacy_deleted,created_at,updated_at)
        VALUES(student_key,NEW.tenant_id,billing_name,NEW.id,2,0,0,true,'机构课程费用专用学生',false,stamp,stamp);
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'VNEXT_INSTITUTION_BILLING_LINK_INVALID' USING ERRCODE='P0001';
      END;
    END IF;
    INSERT INTO business.institution_billing_students(tenant_id,institution_id,student_id)
      VALUES(NEW.tenant_id,NEW.id,student_key);
  END IF;
  PERFORM 1 FROM business.students s WHERE s.tenant_id=NEW.tenant_id AND s.id=student_key
    AND s.institution_id=NEW.id AND s.legacy_is_institution_student AND NOT s.legacy_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_INSTITUTION_BILLING_LINK_INVALID' USING ERRCODE='P0001'; END IF;
  UPDATE business.students s SET name=billing_name,legacy_source_type=2,updated_at=stamp
    WHERE s.tenant_id=NEW.tenant_id AND s.id=student_key
      AND (s.name IS DISTINCT FROM billing_name OR s.legacy_source_type IS DISTINCT FROM 2);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_ensure_institution_billing_student() FROM PUBLIC;
CREATE TRIGGER vnext_institution_billing_student
  AFTER INSERT OR UPDATE OF name ON business.institutions
  FOR EACH ROW EXECUTE FUNCTION business.vnext_ensure_institution_billing_student();

COMMIT;
