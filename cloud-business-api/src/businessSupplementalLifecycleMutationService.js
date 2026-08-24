'use strict';

function createBusinessSupplementalLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returning = 'RETURNING id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt"';
  const assetReturning = id => `RETURNING ${id} AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
  return Object.freeze({
    payments: Object.freeze({
      create: input => resultRow(`INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date,payment_method,notes)
        SELECT $2,$1,$3,$4,$5,$6::date,$7,$8 FROM business.students s WHERE s.tenant_id=$1 AND s.id=$3 AND s.legacy_deleted=false ${returning}`,
      [input.tenantId, input.paymentId, input.studentId, input.amount, input.paymentType, input.paymentDate, input.paymentMethod, input.notes]),
      update: input => resultRow(`UPDATE business.payments SET student_id=$4,amount=$5,payment_type=$6,payment_date=$7::date,payment_method=$8,notes=$9,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND deleted=false AND EXISTS (SELECT 1 FROM business.students s WHERE s.tenant_id=$1 AND s.id=$4 AND s.legacy_deleted=false) ${returning}`,
      [input.tenantId, input.paymentId, input.expectedUpdatedAt, input.studentId, input.amount, input.paymentType, input.paymentDate, input.paymentMethod, input.notes]),
      remove: input => resultRow(`UPDATE business.payments SET deleted=true,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND deleted=false ${returning}`,
      [input.tenantId, input.paymentId, input.expectedUpdatedAt]),
    }),
    consumptions: Object.freeze({
      create: input => resultRow(`INSERT INTO business.consumptions(id,tenant_id,schedule_id,student_id,hours,amount,consumption_date,notes)
        SELECT $2,$1,$3,$4,$5,$6,$7::date,$8 WHERE EXISTS (SELECT 1 FROM business.schedules s WHERE s.tenant_id=$1 AND s.id=$3 AND s.legacy_deleted=false) AND EXISTS (SELECT 1 FROM business.students x WHERE x.tenant_id=$1 AND x.id=$4 AND x.legacy_deleted=false) ${returning}`,
      [input.tenantId, input.consumptionId, input.scheduleId, input.studentId, input.hours, input.amount, input.consumptionDate, input.notes]),
      update: input => resultRow(`UPDATE business.consumptions SET schedule_id=$4,student_id=$5,hours=$6,amount=$7,consumption_date=$8::date,notes=$9,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND deleted=false AND EXISTS (SELECT 1 FROM business.schedules s WHERE s.tenant_id=$1 AND s.id=$4 AND s.legacy_deleted=false) AND EXISTS (SELECT 1 FROM business.students x WHERE x.tenant_id=$1 AND x.id=$5 AND x.legacy_deleted=false) ${returning}`,
      [input.tenantId, input.consumptionId, input.expectedUpdatedAt, input.scheduleId, input.studentId, input.hours, input.amount, input.consumptionDate, input.notes]),
      remove: input => resultRow(`UPDATE business.consumptions SET deleted=true,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND deleted=false ${returning}`,
      [input.tenantId, input.consumptionId, input.expectedUpdatedAt]),
    }),
    grades: Object.freeze({
      create: input => resultRow(`INSERT INTO business.grades(id,tenant_id,student_id,subject,score,exam_date,notes)
        SELECT $2,$1,$3,$4,$5,$6::date,$7 FROM business.students s WHERE s.tenant_id=$1 AND s.id=$3 AND s.legacy_deleted=false ${returning}`,
      [input.tenantId, input.gradeId, input.studentId, input.subject, input.score, input.examDate, input.notes]),
      remove: input => resultRow(`UPDATE business.grades SET deleted=true,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND deleted=false ${returning}`,
      [input.tenantId, input.gradeId, input.expectedUpdatedAt]),
    }),
    assetCategories: Object.freeze({
      create: input => resultRow(`INSERT INTO business.personal_asset_manual_categories(category_id,tenant_id,account_id,name,category_type,color) VALUES($3,$1,$2,$4,$5,$6) ${assetReturning('category_id')}`,
      [input.tenantId, input.accountId, input.categoryId, input.name, input.type, input.color]),
      remove: input => resultRow(`UPDATE business.personal_asset_manual_categories SET deleted=true,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND account_id=$2 AND category_id=$3 AND updated_at=$4::timestamptz AND deleted=false
          AND NOT EXISTS (SELECT 1 FROM business.personal_asset_manual_records r WHERE r.tenant_id=$1 AND r.account_id=$2 AND r.category_id=$3 AND r.deleted=false) ${assetReturning('category_id')}`,
      [input.tenantId, input.accountId, input.categoryId, input.expectedUpdatedAt]),
    }),
    assetRecords: Object.freeze({
      create: input => resultRow(`INSERT INTO business.personal_asset_manual_records(record_id,tenant_id,account_id,record_date,record_type,category_id,category_name,amount,student_id,student_name,note)
        SELECT $3,$1,$2,$4::date,$5,$6,$7,$8,$9,$10,$11 WHERE (EXISTS (SELECT 1 FROM business.personal_asset_manual_categories c WHERE c.tenant_id=$1 AND c.account_id=$2 AND c.category_id=$6 AND c.category_type=$5 AND c.deleted=false) OR EXISTS (SELECT 1 FROM business.personal_asset_categories c WHERE c.tenant_id=$1 AND c.account_id=$2 AND c.category_id=$6 AND c.category_type=$5)) AND ($9 IS NULL OR EXISTS (SELECT 1 FROM business.students s WHERE s.tenant_id=$1 AND s.id=$9 AND s.legacy_deleted=false)) ${assetReturning('record_id')}`,
      [input.tenantId, input.accountId, input.recordId, input.date, input.type, input.categoryId, input.categoryName, input.amount, input.studentId, input.studentName, input.note]),
      update: input => resultRow(`UPDATE business.personal_asset_manual_records SET record_date=$5::date,record_type=$6,category_id=$7,category_name=$8,amount=$9,student_id=$10,student_name=$11,note=$12,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND account_id=$2 AND record_id=$3 AND updated_at=$4::timestamptz AND deleted=false
          AND (EXISTS (SELECT 1 FROM business.personal_asset_manual_categories c WHERE c.tenant_id=$1 AND c.account_id=$2 AND c.category_id=$7 AND c.category_type=$6 AND c.deleted=false) OR EXISTS (SELECT 1 FROM business.personal_asset_categories c WHERE c.tenant_id=$1 AND c.account_id=$2 AND c.category_id=$7 AND c.category_type=$6))
          AND ($10 IS NULL OR EXISTS (SELECT 1 FROM business.students s WHERE s.tenant_id=$1 AND s.id=$10 AND s.legacy_deleted=false)) ${assetReturning('record_id')}`,
      [input.tenantId, input.accountId, input.recordId, input.expectedUpdatedAt, input.date, input.type, input.categoryId, input.categoryName, input.amount, input.studentId, input.studentName, input.note]),
      remove: input => resultRow(`UPDATE business.personal_asset_manual_records SET deleted=true,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND account_id=$2 AND record_id=$3 AND updated_at=$4::timestamptz AND deleted=false ${assetReturning('record_id')}`,
      [input.tenantId, input.accountId, input.recordId, input.expectedUpdatedAt]),
    }),
  });
}

module.exports = Object.freeze({ createBusinessSupplementalLifecycleMutations });
