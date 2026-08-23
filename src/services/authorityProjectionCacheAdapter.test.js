const assert = require('assert');

(async () => {
  const { buildAuthorityBackedBrowserCache } = await import('./authorityProjectionCacheAdapter.mjs');
  const projection = {
    protocol: 'gewu.authority-projection.v1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    userId: 'admin-1',
    role: 'admin',
    sourceVersion: 7,
    payload: {
      students: [{ id: 'student-1', name: 'Authority student' }],
      student_contacts: [{ id: 'student-contact-1', student_id: 'student-1', slot: 1, relationship: 'student', phone: '13800138000', wechat: null }],
      courses: [{
        id: 'course-1',
        student_pricings: '[{"student_id":"student-1","tuition":100}]',
      }],
      schedules: [{
        id: 'schedule-1',
        student_ids: '["student-1"]',
        student_pricings: '[{"student_id":"student-1","tuition":100}]',
      }],
      questions: [{
        id: 'question-1',
        subject: 'Physics',
        type: 'single',
        content: '1+1?',
        answer: '2',
        options_json: '["1","2"]',
        rich_content_json: null,
        taxonomy_json: '{"knowledge":["node-1"]}',
      }],
      taxonomySystems: [{ id: 'knowledge', name: 'Knowledge', sort_order: 1 }],
      taxonomyNodes: [{ id: 'node-1', system_id: 'knowledge', name: 'Arithmetic', sort_order: 1 }],
      assetRecords: [{
        id: 'asset-record-1',
        ownerUserId: 'admin-1',
        date: '2026-07-28',
        type: 'expense',
        categoryId: 'category-1',
        categoryName: 'Food',
        amount: 88,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      }],
      assetCategories: [{
        id: 'category-1',
        ownerUserId: 'admin-1',
        name: 'Food',
        type: 'expense',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      }],
    },
  };
  const localOnly = {
    questionBasketIds: ['question-1'],
    questionVersions: [{ id: 'local-version' }],
    importTasks: [{ id: 'local-import' }],
  };
  const outbox = [
    {
      id: 'draft-1',
      type: 'student.update.v1',
      status: 'awaiting_confirmation',
      createdAt: '2026-07-28T01:00:00.000Z',
      payload: { id: 'student-1', changes: { notes: 'offline draft' } },
    },
    {
      id: 'draft-2',
      type: 'room.create.v1',
      status: 'confirmed',
      createdAt: '2026-07-28T02:00:00.000Z',
      payload: { record: { id: 'room-offline', name: 'Offline room' } },
    },
    {
      id: 'done',
      type: 'student.update.v1',
      status: 'completed',
      createdAt: '2026-07-28T03:00:00.000Z',
      payload: { id: 'student-1', changes: { notes: 'must not overlay' } },
    },
  ];

  const cache = buildAuthorityBackedBrowserCache({ projection, outbox, localOnly });
  assert.strictEqual(cache.students[0].notes, 'offline draft');
  assert.deepStrictEqual(cache.student_contacts, [{ id: 'student-contact-1', student_id: 'student-1', slot: 1, relationship: 'student', phone: '13800138000', wechat: null }]);
  assert.deepStrictEqual(cache.rooms, [{ id: 'room-offline', name: 'Offline room' }]);
  assert.deepStrictEqual(cache.schedules[0].student_ids, ['student-1']);
  assert.deepStrictEqual(cache.courses[0].student_pricings, [
    { student_id: 'student-1', tuition: 100 },
  ]);
  assert.deepStrictEqual(cache.questions[0].options, ['1', '2']);
  assert.deepStrictEqual(cache.questions[0].taxonomy_ids, { knowledge: ['node-1'] });
  assert.strictEqual(cache.assetRecords[0].category_id, 'category-1');
  assert.strictEqual(cache.assetCategories[0].created_at, '2026-07-28T00:00:00.000Z');
  assert.deepStrictEqual(cache.questionBasketIds, ['question-1']);
  assert.strictEqual(cache.authorityCacheMetadata.sourceVersion, 7);
  assert.strictEqual(JSON.stringify(cache).includes('questionPreviews'), false);

  assert.throws(
    () => buildAuthorityBackedBrowserCache({
      projection: { ...projection, protocol: 'legacy.raw-projection.v1' },
      outbox: [],
    }),
    error => error?.code === 'AUTHORITY_PROJECTION_CACHE_INVALID',
  );

  console.log('authorityProjectionCacheAdapter tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
