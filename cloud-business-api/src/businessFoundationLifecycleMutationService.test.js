'use strict';

const assert = require('assert');
const { createBusinessFoundationLifecycleMutations } = require('./businessFoundationLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessFoundationLifecycleMutations({ query: async (sql, values) => {
    calls.push([sql, values]); return { rows: [{ id: values[1], updatedAt: '2026-08-24T04:00:00.000Z' }] };
  } });
  const institution = { tenantId: 'default', institutionId: 'institution-1', name: 'Institution', contactPerson: null, contactPhone: null, revenueShare: 0.2, notes: null };
  await mutations.institutions.create(institution);
  await mutations.institutions.update({ ...institution, expectedUpdatedAt: '2026-08-24T03:00:00.000Z' });
  await mutations.institutions.remove({ tenantId: 'default', institutionId: 'institution-1', expectedUpdatedAt: '2026-08-24T04:00:00.000Z' });
  assert.match(calls[0][0], /vnext_create_institution_v1/);
  assert.match(calls[1][0], /vnext_update_institution_v1/);
  assert.match(calls[2][0], /vnext_soft_delete_institution/);
  const school = { tenantId: 'default', schoolId: 'school-1', name: 'School', count: 3 };
  await mutations.schools.create(school);
  await mutations.schools.update({ ...school, expectedUpdatedAt: '2026-08-24T03:00:00.000Z' });
  await mutations.schools.remove({ tenantId: 'default', schoolId: 'school-1', expectedUpdatedAt: '2026-08-24T04:00:00.000Z' });
  assert.match(calls[3][0], /vnext_create_school_v1/);
  assert.match(calls[4][0], /vnext_update_school_v1/);
  assert.match(calls[5][0], /vnext_soft_delete_school/);
  console.log('business foundation lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
