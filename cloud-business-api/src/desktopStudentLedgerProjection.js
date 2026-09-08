'use strict';

// Desktop-only enrichment of the already-authorized student set, in the same DB snapshot.
// Do not add these ledgers to the miniapp projection or filter away part of a student's balance.
function withDesktopStudentLedgerProjection(projectionSql) {
  return [
    `WITH desktop_scope AS (${projectionSql}),`,
    "ledger_students AS (SELECT student->>'id' AS id FROM desktop_scope, jsonb_array_elements(projection->'students') student)",
    'SELECT projection || jsonb_build_object(',
    "'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'student_id',p.student_id,'amount',p.amount,'payment_type',p.payment_type,'payment_date',p.payment_date,'payment_method',p.payment_method,'notes',p.notes,'created_at',p.created_at,'updated_at',p.updated_at) ORDER BY p.payment_date DESC,p.id) FROM business.payments p WHERE p.tenant_id=$1 AND p.deleted=false AND p.student_id IN (SELECT id FROM ledger_students)),'[]'::jsonb),",
    "'consumptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'schedule_id',c.schedule_id,'student_id',c.student_id,'hours',c.hours,'amount',c.amount,'consumption_date',c.consumption_date,'notes',c.notes,'created_at',c.created_at,'updated_at',c.updated_at) ORDER BY c.consumption_date DESC,c.id) FROM business.consumptions c WHERE c.tenant_id=$1 AND c.deleted=false AND c.student_id IN (SELECT id FROM ledger_students)),'[]'::jsonb)",
    ') AS projection FROM desktop_scope',
  ].join(' ');
}

module.exports = { withDesktopStudentLedgerProjection };
