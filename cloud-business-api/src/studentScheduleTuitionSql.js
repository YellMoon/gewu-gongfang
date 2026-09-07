'use strict';

// Internal SQL fragment shared by the two authenticated schedule read models.
// `s` is the already-scoped schedule; $3 is the verified student's profile ID.
// Match desktop financialDetails: active attendance, billing unit, rounded
// duration, then proportional allocation of an existing financial snapshot.
// Aggregate the effective roster internally, but return only this student's amount.
const STUDENT_SCHEDULE_TUITION_SQL = `(
  WITH effective_pricing AS (
    SELECT o.student_id,o.tuition,o.attendance_status
    FROM business.schedule_student_overrides o
    WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id
    UNION ALL
    SELECT p.student_id,p.tuition,1 AS attendance_status
    FROM business.course_student_pricings p
    WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id
      AND NOT EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id)
  ), student_amounts AS (
    SELECT p.student_id,p.attendance_status,
      CASE WHEN p.attendance_status<>1 THEN 0::numeric ELSE
        round(COALESCE(p.tuition,0) * CASE WHEN c.billing_unit=2 THEN 1::numeric
          ELSE greatest(0::numeric,round(trunc(extract(epoch FROM (s.end_at-s.start_at))/60)/60,2)) END,2)
      END AS amount
    FROM effective_pricing p
    JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id AND c.legacy_deleted=false
  ), allocated_amounts AS (
    SELECT *,sum(amount) OVER () AS total,
      count(*) FILTER (WHERE attendance_status=1) OVER () AS active_count
    FROM student_amounts
  )
  SELECT CASE
    WHEN attendance_status<>1 THEN 0::numeric
    WHEN s.calculated_tuition>0 AND total<=0 THEN round(s.calculated_tuition/nullif(active_count,0),2)
    WHEN s.calculated_tuition>0 AND total>0 AND abs(s.calculated_tuition-total)>=0.01
      THEN round(amount*s.calculated_tuition/total,2)
    ELSE amount END
  FROM allocated_amounts WHERE student_id=$3
)`;

module.exports = Object.freeze({ STUDENT_SCHEDULE_TUITION_SQL });
