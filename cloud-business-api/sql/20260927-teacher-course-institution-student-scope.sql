-- UTF-8: a teacher scoped to an institution may attach that institution's
-- billing student to their own courses before the student belongs to any of
-- their courses. The read projection exposes the same billing identity, so the
-- write scope must not be stricter than the read scope.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_teacher_student_access(p_tenant text,p_student text,p_teacher text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text;
BEGIN
 SELECT s.created_by_teacher_id INTO creator FROM business.students s
  WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF creator=p_teacher THEN RETURN true; END IF;
 PERFORM 1 FROM business.students s
  JOIN business.institutions i ON i.tenant_id=s.tenant_id AND i.id=s.institution_id AND i.legacy_deleted=false
  WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false
   AND s.legacy_is_institution_student
   AND (i.created_by_teacher_id=p_teacher OR EXISTS (
     SELECT 1 FROM business.courses c
     JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
     WHERE c.tenant_id=s.tenant_id AND c.institution_id=s.institution_id AND c.legacy_deleted=false
      AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))))
  FOR SHARE OF s,i;
 IF FOUND THEN RETURN true; END IF;
 PERFORM 1 FROM business.course_student_pricings p
  JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE p.tenant_id=p_tenant AND p.student_id=p_student AND c.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))
  ORDER BY c.id LIMIT 1 FOR SHARE OF p,c,t;
 IF FOUND THEN RETURN true; END IF;
 PERFORM 1 FROM business.schedule_student_overrides o
  JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
  JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE o.tenant_id=p_tenant AND o.student_id=p_student AND c.legacy_deleted=false AND s.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))
  ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF o,s,c,t;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_teacher_student_access(text,text,text) FROM PUBLIC;
COMMIT;
