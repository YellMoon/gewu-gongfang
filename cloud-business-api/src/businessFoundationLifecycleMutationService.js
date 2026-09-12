'use strict';
const { scheduleActorParameters } = require('./businessScheduleActorScope');

function createBusinessFoundationLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returned = 'SELECT id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM';
  return Object.freeze({
    institutions: Object.freeze({
      create: input => resultRow(`${returned} business.vnext_create_scoped_institution($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.tenantId, input.institutionId, input.name, input.contactPerson, input.contactPhone, input.revenueShare, input.notes, ...scheduleActorParameters(input.actorScope)]),
      update: input => resultRow(`${returned} business.vnext_update_scoped_institution($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10)`, [input.tenantId, input.institutionId, input.expectedUpdatedAt, input.name, input.contactPerson, input.contactPhone, input.revenueShare, input.notes, ...scheduleActorParameters(input.actorScope)]),
      remove: input => resultRow(`${returned} business.vnext_delete_scoped_institution($1,$2,$3::timestamptz,$4,$5)`, [input.tenantId, input.institutionId, input.expectedUpdatedAt, ...scheduleActorParameters(input.actorScope)]),
    }),
    schools: Object.freeze({
      create: input => resultRow(`${returned} business.vnext_create_school_v1($1,$2,$3,$4)`, [input.tenantId, input.schoolId, input.name, input.count]),
      update: input => resultRow(`${returned} business.vnext_update_school_v1($1,$2,$3::timestamptz,$4,$5)`, [input.tenantId, input.schoolId, input.expectedUpdatedAt, input.name, input.count]),
      remove: input => resultRow(`${returned} business.vnext_soft_delete_school($1,$2,$3::timestamptz)`, [input.tenantId, input.schoolId, input.expectedUpdatedAt]),
    }),
  });
}

module.exports = Object.freeze({ createBusinessFoundationLifecycleMutations });
