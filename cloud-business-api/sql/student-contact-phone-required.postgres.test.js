'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');

const SQL = fs.readFileSync(path.join(__dirname, '20260901-student-contact-phone-required.sql'), 'utf8');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA business; CREATE TABLE business.student_contact_directory(contact_id text PRIMARY KEY,phone_value text NULL,wechat_handle text NULL,status text NOT NULL)');
      await facade.query("INSERT INTO business.student_contact_directory VALUES ('legacy-wechat-only',NULL,'legacy-display','active')");
      await facade.query(SQL);
      const legacy = await facade.query("SELECT contact_id,wechat_handle FROM business.student_contact_directory WHERE contact_id='legacy-wechat-only'");
      assert.deepStrictEqual(legacy.rows, [{ contact_id: 'legacy-wechat-only', wechat_handle: 'legacy-display' }], 'the migration must preserve historical display data');
      await assert.rejects(
        () => facade.query("INSERT INTO business.student_contact_directory VALUES ('new-wechat-only',NULL,'display-only','active')"),
        error => error?.code === '23514',
      );
      await facade.query("INSERT INTO business.student_contact_directory VALUES ('new-phone','13800138000','optional-display','active')");
      const inserted = await facade.query("SELECT phone_value,wechat_handle FROM business.student_contact_directory WHERE contact_id='new-phone'");
      assert.deepStrictEqual(inserted.rows, [{ phone_value: '13800138000', wechat_handle: 'optional-display' }]);
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('student contact phone requirement PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
