'use strict';
// UTF-8: preserve PostgreSQL microsecond concurrency tokens across the real REST client/parser.
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
(async () => {
  const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
  const version = '2026-09-08T06:21:02.254223Z';
  let expectedVersion = version;
  let calls = 0;
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'tenant',
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => ({ roles: ['teacher'], teacherId: 'teacher' }) },
    businessStudentRecordUpdate: async input => {
      calls++;
      if (input.expectedUpdatedAt !== expectedVersion || input.contacts[0].expectedUpdatedAt !== expectedVersion) return null;
      return { id: input.studentId, updatedAt: expectedVersion };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: fetch });
  const fields = { baseUrl, currentSession: { token: 'eyJ2IjoxfQ.signature' }, studentId: 'student', name: '测试学生',
    school: null, gradeYear: null, gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: null };
  try {
    for (const [source, canonical] of [
      ['2026-09-08T14:21:02.254223+08:00', version], [version, version],
      ['2026-09-07T23:21:02.254223-07:00', version],
      ...['', '.2', '.25', '.254', '.2542', '.25422', '.254223'].map(fraction =>
        [`2026-09-08T14:21:02${fraction}+08:00`, `2026-09-08T06:21:02.${fraction.slice(1).padEnd(3, '0')}Z`]),
    ]) {
      expectedVersion = canonical;
      const result = await client.updateCloudStudentRecord({ ...fields, expectedUpdatedAt: source,
        contacts: [{ slot: 1, relationship: 'student', phone: '13100000000', wechat: null, expectedUpdatedAt: source }] });
      assert.equal(result.updatedAt, canonical);
    }
    expectedVersion = version;
    const before = calls;
    for (const invalid of ['not-a-date', '2026-02-30T00:00:00.123456Z', '2026-09-08T06:21:02.1234567Z',
      '2026-09-08T24:00:00.123Z', '2026-09-08T06:21:60.123Z', 1]) {
      const response = await fetch(baseUrl + '/api/business/students/student/record', { method: 'PUT',
        headers: { authorization: 'Bearer eyJ2IjoxfQ.signature', 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: '2026-09-08T06:21:02.254Z', name: fields.name,
          school: null, gradeYear: null, gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: null,
          contacts: [{ slot: 1, relationship: 'student', phone: '13100000000', wechat: null, expectedUpdatedAt: invalid }] }) });
      assert.equal(response.status, 400, 'invalid contact versions cannot become null/new-contact versions');
      const contactResponse = await fetch(baseUrl + '/api/business/students/student/contacts/1', { method: 'PUT',
        headers: { authorization: 'Bearer eyJ2IjoxfQ.signature', 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: invalid, relationship: 'student', phone: '13100000000', wechat: null }) });
      assert.equal(contactResponse.status, 400, 'single-contact endpoint also rejects malformed versions');
    }
    assert.equal(calls, before);
    await assert.rejects(() => client.updateCloudStudentRecord({ ...fields, expectedUpdatedAt: version,
      contacts: [{ slot: 1, relationship: 'student', phone: '13100000000', wechat: null, expectedUpdatedAt: '2026-09-08T06:21:02.254224Z' }] }),
    error => error.code === 'CLOUD_BUSINESS_STUDENT_CONFLICT');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('business microsecond version REST roundtrip and invalid-version checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
