'use strict';

// Reuse the authorized student set, not the teacher's partial course ledger.
// The balance formula is the original desktop formula. Consumption rows and
// internal ledger notes stay on the server; this adds no miniapp write surface.
function withMiniappStudentLedgerProjection(projectionSql) {
  return `WITH miniapp_student_scope AS (${projectionSql}),
    ledger_students AS (
      SELECT student FROM miniapp_student_scope,
        jsonb_array_elements(projection->'students') student
    ),
    student_payments AS (
      SELECT p.id,p.student_id,p.amount,p.payment_type,p.payment_date,p.payment_method
      FROM business.payments p WHERE p.tenant_id=$1 AND p.deleted=false
        AND p.student_id IN (SELECT student->>'id' FROM ledger_students)
    ),
    student_consumption_totals AS (
      SELECT c.student_id,SUM(c.hours) AS hours,SUM(c.amount) AS amount
      FROM business.consumptions c WHERE c.tenant_id=$1 AND c.deleted=false
        AND c.student_id IN (SELECT student->>'id' FROM ledger_students)
      GROUP BY c.student_id
    ),
    student_payment_totals AS (
      SELECT student_id,SUM(amount) FILTER (WHERE payment_type=2) AS hours,
        SUM(amount) FILTER (WHERE payment_type=1) AS amount
      FROM student_payments GROUP BY student_id
    )
    SELECT projection || jsonb_build_object(
      'students',COALESCE((SELECT jsonb_agg(student || jsonb_build_object(
        'balance_hours',COALESCE(p.hours,0)-COALESCE(c.hours,0),
        'balance_money',COALESCE(p.amount,0)-COALESCE(c.amount,0)) ORDER BY student->>'id')
        FROM ledger_students s LEFT JOIN student_payment_totals p ON p.student_id=s.student->>'id'
        LEFT JOIN student_consumption_totals c ON c.student_id=s.student->>'id'),'[]'::jsonb),
      'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.payment_date DESC,p.id)
        FROM student_payments p),'[]'::jsonb),
      'grades',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',g.id,'student_id',g.student_id,'subject',g.subject,'score',g.score,'exam_date',g.exam_date)
        ORDER BY g.exam_date DESC NULLS LAST,g.id)
        FROM business.grades g WHERE g.tenant_id=$1 AND g.deleted=false
          AND g.student_id IN (SELECT student->>'id' FROM ledger_students)),'[]'::jsonb)
    ) AS projection FROM miniapp_student_scope`;
}

function hasMiniappStudentLedger(value) {
  return Array.isArray(value?.payments) && Array.isArray(value?.grades)
    && Array.isArray(value?.students) && value.students.every(student =>
      Number.isFinite(student?.balance_hours) && Number.isFinite(student?.balance_money));
}

module.exports = { withMiniappStudentLedgerProjection, hasMiniappStudentLedger };
