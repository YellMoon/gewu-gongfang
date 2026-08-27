BEGIN;

CREATE OR REPLACE FUNCTION business.vnext_create_course_record_v1(
  p_tenant_id text,p_course_id text,p_name text,p_year integer,p_semester text,p_display_name text,p_course_type integer,p_source_type integer,p_institution_id text,p_price_tuition numeric,p_price_teacher numeric,p_billing_unit integer,p_teacher_fee_mode integer,p_room_id text,p_room_name text,p_teacher_id text,p_teacher_name text,p_active boolean,p_default_duration_minutes integer,p_notes text,p_pricings jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_room_name text; v_teacher_name text; pricing record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_pricings) <> 'array' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric) GROUP BY pricing_input.student_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT room_record.name INTO v_room_name FROM business.rooms AS room_record WHERE room_record.tenant_id=p_tenant_id AND room_record.id=p_room_id AND room_record.legacy_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_ROOM_INVALID' USING ERRCODE = '23503'; END IF;
  SELECT teacher_record.name INTO v_teacher_name FROM business.teachers AS teacher_record WHERE teacher_record.tenant_id=p_tenant_id AND teacher_record.id=p_teacher_id AND teacher_record.legacy_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_TEACHER_INVALID' USING ERRCODE = '23503'; END IF;
  IF p_institution_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business.institutions AS institution_record WHERE institution_record.tenant_id=p_tenant_id AND institution_record.id=p_institution_id AND institution_record.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_INVALID' USING ERRCODE = '23503'; END IF;
  IF p_source_type IN (2,3) AND p_institution_id IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric) LEFT JOIN business.students AS student_record ON student_record.tenant_id=p_tenant_id AND student_record.id=pricing_input.student_id AND student_record.legacy_deleted=false WHERE student_record.id IS NULL OR pricing_input.tuition IS NULL OR pricing_input.tuition<0 OR pricing_input.teacher_fee IS NULL OR pricing_input.teacher_fee<0) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  INSERT INTO business.courses(id,tenant_id,name,year,semester,display_name,course_type,legacy_source_type,institution_id,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_room_id,room_name_snapshot,teacher_id,teacher_name_snapshot,legacy_active,default_duration_minutes,notes,legacy_deleted,created_at,updated_at)
  VALUES (p_course_id,p_tenant_id,p_name,p_year,p_semester,p_display_name,p_course_type,p_source_type,p_institution_id,p_price_tuition,p_price_teacher,p_billing_unit,p_teacher_fee_mode,p_room_id,v_room_name,p_teacher_id,v_teacher_name,p_active,p_default_duration_minutes,p_notes,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.courses.id,business.courses.updated_at INTO id,updated_at;
  FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric)
  LOOP INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES (p_tenant_id,p_course_id,pricing.student_id,pricing.tuition,pricing.teacher_fee); END LOOP;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_course_record_v1(
  p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz,p_name text,p_year integer,p_semester text,p_display_name text,p_course_type integer,p_source_type integer,p_institution_id text,p_price_tuition numeric,p_price_teacher numeric,p_billing_unit integer,p_teacher_fee_mode integer,p_room_id text,p_room_name text,p_teacher_id text,p_teacher_name text,p_active boolean,p_default_duration_minutes integer,p_notes text,p_pricings jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_room_name text; v_teacher_name text; pricing record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_pricings) <> 'array' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric) GROUP BY pricing_input.student_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT room_record.name INTO v_room_name FROM business.rooms AS room_record WHERE room_record.tenant_id=p_tenant_id AND room_record.id=p_room_id AND room_record.legacy_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_ROOM_INVALID' USING ERRCODE = '23503'; END IF;
  SELECT teacher_record.name INTO v_teacher_name FROM business.teachers AS teacher_record WHERE teacher_record.tenant_id=p_tenant_id AND teacher_record.id=p_teacher_id AND teacher_record.legacy_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_TEACHER_INVALID' USING ERRCODE = '23503'; END IF;
  IF p_institution_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business.institutions AS institution_record WHERE institution_record.tenant_id=p_tenant_id AND institution_record.id=p_institution_id AND institution_record.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_INVALID' USING ERRCODE = '23503'; END IF;
  IF p_source_type IN (2,3) AND p_institution_id IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric) LEFT JOIN business.students AS student_record ON student_record.tenant_id=p_tenant_id AND student_record.id=pricing_input.student_id AND student_record.legacy_deleted=false WHERE student_record.id IS NULL OR pricing_input.tuition IS NULL OR pricing_input.tuition<0 OR pricing_input.teacher_fee IS NULL OR pricing_input.teacher_fee<0) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  UPDATE business.courses AS target SET name=p_name,year=p_year,semester=p_semester,display_name=p_display_name,course_type=p_course_type,legacy_source_type=p_source_type,institution_id=p_institution_id,price_tuition=p_price_tuition,price_teacher=p_price_teacher,billing_unit=p_billing_unit,teacher_fee_mode=p_teacher_fee_mode,legacy_room_id=p_room_id,room_name_snapshot=v_room_name,teacher_id=p_teacher_id,teacher_name_snapshot=v_teacher_name,legacy_active=p_active,default_duration_minutes=p_default_duration_minutes,notes=p_notes,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE target.tenant_id=p_tenant_id AND target.id=p_course_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE business.schedules AS schedule_record SET room_display_snapshot=v_room_name,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE schedule_record.tenant_id=p_tenant_id AND schedule_record.course_id=p_course_id AND schedule_record.legacy_deleted=false;
  DELETE FROM business.course_student_pricings AS pricing_record WHERE pricing_record.tenant_id=p_tenant_id AND pricing_record.course_id=p_course_id;
  FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS pricing_input(student_id text,tuition numeric,teacher_fee numeric)
  LOOP INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES (p_tenant_id,p_course_id,pricing.student_id,pricing.tuition,pricing.teacher_fee); END LOOP;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_course_record_v1(text,text,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_course_record_v1(text,text,timestamptz,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_course_record_v1(text,text,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_course_record_v1(text,text,timestamptz,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb) TO vnext_pg17_writer;

COMMIT;
