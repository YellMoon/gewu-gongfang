const assert = require('assert');

(async () => {
  const {
    createAuthorityDraftFromLocalMutation,
  } = await import('./authorityDraftAdapter.mjs');

  const schedule = createAuthorityDraftFromLocalMutation({
    collection: 'schedules',
    action: 'update',
    recordId: 'schedule-1',
    value: {
      id: 'schedule-1',
      start_time: '2026-07-29 09:00:00',
      end_time: '2026-07-29 10:00:00',
      notes: 'moved',
      tenant_id: 'client-chosen-tenant',
      owner_user_id: 'somebody-else',
      unexpected: 'forbidden',
    },
    baseVersion: 'version-7',
  });
  assert.strictEqual(schedule.type, 'schedule.update.v1');
  assert.deepStrictEqual(schedule.payload, {
    id: 'schedule-1',
    changes: {
      start_time: '2026-07-29 09:00:00',
      end_time: '2026-07-29 10:00:00',
      notes: 'moved',
    },
    expectedVersion: 'version-7',
  });
  assert.strictEqual(JSON.stringify(schedule).includes('tenant_id'), false);
  assert.strictEqual(JSON.stringify(schedule).includes('owner_user_id'), false);
  assert.strictEqual(JSON.stringify(schedule).includes('unexpected'), false);
  assert.strictEqual(JSON.stringify(schedule).includes('"table"'), false);

  const deleted = createAuthorityDraftFromLocalMutation({
    collection: 'students',
    action: 'delete',
    recordId: 'student-1',
    value: { id: 'student-1', name: 'must-not-be-sent' },
  });
  assert.deepStrictEqual(deleted.payload, { id: 'student-1' });
  assert.strictEqual(deleted.type, 'student.delete.v1');

  const school = createAuthorityDraftFromLocalMutation({
    collection: 'schools', action: 'update', recordId: 'school-1', baseVersion: 'school-version-1',
    value: { name: 'School One', count: 3, notes: 'not in cloud schema' },
  });
  assert.deepStrictEqual(school, {
    type: 'school.update.v1',
    payload: { id: 'school-1', changes: { name: 'School One', count: 3 }, expectedVersion: 'school-version-1' },
    preview: { title: 'school.update', summary: 'school-1' },
  });

  const studentWithContacts = createAuthorityDraftFromLocalMutation({
    collection: 'students',
    action: 'update',
    recordId: 'student-1',
    baseVersion: 'student-version-1',
    value: {
      name: 'Student One',
      contacts: [{
        slot: 1, relationship: 'student', phone: '13700000001', wechat: null,
        updated_at: '2026-08-23T00:00:00.000Z',
      }],
    },
  });
  assert.deepStrictEqual(studentWithContacts.payload.changes.contacts, [{
    slot: 1, relationship: 'student', phone: '13700000001', wechat: null,
    updated_at: '2026-08-23T00:00:00.000Z',
  }]);

  const taxonomyDelete = createAuthorityDraftFromLocalMutation({
    collection: 'taxonomy_nodes',
    action: 'delete',
    recordId: 'node-1',
    value: {
      system_id: 'knowledge',
      _taxonomy_delete_confirmation: {
        confirmed: true,
        expected_affected_question_count: 2,
        backup_id: 'client-backup-must-not-cross-boundary',
      },
    },
    baseVersion: 'taxonomy-version-3',
  });
  assert.deepStrictEqual(taxonomyDelete.payload, {
    id: 'node-1',
    systemId: 'knowledge',
    expectedVersion: 'taxonomy-version-3',
    confirmation: {
      confirmed: true,
      expectedAffectedQuestionCount: 2,
    },
  });
  assert.strictEqual(JSON.stringify(taxonomyDelete).includes('backup_id'), false);

  const asset = createAuthorityDraftFromLocalMutation({
    collection: 'assetRecords',
    action: 'create',
    recordId: 'asset-record-1',
    value: {
      id: 'asset-record-1',
      account_id: 'account-1',
      amount: 88,
      category_id: 'category-1',
      full_card_number: '6222000000000000',
    },
  });
  assert.deepStrictEqual(asset.payload.record, {
    id: 'asset-record-1',
    account_id: 'account-1',
    amount: 88,
    category_id: 'category-1',
  });
  assert.strictEqual(JSON.stringify(asset).includes('full_card_number'), false);

  const importedQuestion = createAuthorityDraftFromLocalMutation({
    collection: 'questions',
    action: 'create',
    recordId: 'question-imported-1',
    value: {
      subject: 'physics', type: 'single_choice', content: 'Imported question', options: [], answer: 'A', analysis: '',
      import_task_id: 'question_import_task_demo',
      import_item_id: 'question_import_item_demo_0',
      import_item_index: 0,
      import_content_hash: 'a'.repeat(64),
      assets: [{ data_url: 'data:image/png;base64,forbidden' }],
    },
  });
  assert.deepStrictEqual(importedQuestion.payload.record, {
    id: 'question-imported-1', subject: 'physics', type: 'single_choice', content: 'Imported question', options: [], answer: 'A', analysis: '',
    import_task_id: 'question_import_task_demo',
    import_item_id: 'question_import_item_demo_0',
    import_item_index: 0,
    import_content_hash: 'a'.repeat(64),
  });
  assert.strictEqual(JSON.stringify(importedQuestion).includes('data:image'), false);

  assert.throws(
    () => createAuthorityDraftFromLocalMutation({
      collection: 'users',
      action: 'update',
      recordId: 'user-1',
      value: { role: 'super_admin' },
    }),
    error => error.code === 'AUTHORITY_DRAFT_COLLECTION_UNSUPPORTED',
  );
  assert.throws(
    () => createAuthorityDraftFromLocalMutation({
      collection: 'courses',
      action: 'update',
      recordId: 'course-1',
      value: { role: 'super_admin', tenant_id: 'other' },
    }),
    error => error.code === 'AUTHORITY_DRAFT_FIELDS_EMPTY',
  );

  console.log('authority draft adapter tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
