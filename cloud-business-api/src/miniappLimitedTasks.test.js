'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let responseBody = null;
    try { responseBody = JSON.parse(text); } catch (_) { /* missing routes are asserted as failures below */ }
    return { status: response.status, body: responseBody };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const questionCalls = [];
  const paperCalls = [];
  const miniappCloudAccount = {
    login: async () => { throw new Error('not used'); },
    context: async ({ token }) => {
      if (token === 'miniapp-ticket.signature') return { accountId: 'miniapp-super-admin-1', status: 'active', roles: ['super_admin'], profile: null };
      if (token === 'miniapp-student.signature') return { accountId: 'miniapp-student-1', status: 'active', roles: ['student'], profile: { type: 'student', id: 'student-1' } };
      if (token === 'miniapp-visitor.signature') return { accountId: 'miniapp-visitor-1', status: 'visitor', roles: [], profile: null };
      throw new Error('rejected');
    },
    pendingAccounts: async () => [],
    assignRole: async () => { throw new Error('not used'); },
  };
  const questionAuthority = {
    create: async () => { throw new Error('not used'); },
    list: async input => {
      questionCalls.push(input);
      return [
        { id: 'q-draft', subject: 'physics', type: 'single_choice', content: 'Draft stem', status: 'draft', answer: 'A', analysis: 'Draft explanation', options: [], difficulty: 2 },
        { id: 'q-archived', subject: 'physics', type: 'single_choice', content: 'Archived stem', status: 'archived', answer: 'A', analysis: 'Archived explanation', options: [], difficulty: 2 },
      ];
    },
  };
  const paperExportTasks = {
    create: async input => {
      paperCalls.push(input);
      return { taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false };
    },
    read: async () => ({ taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
    cancel: async () => ({ taskId: 'paper_task_1', status: 'cancelled', phase: 'cancelled', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
  };
  const publishedRows = Array.from({ length: 205 }, (_unused, index) => ({
    id: index === 0 ? 'q-public' : `q-formal-${index + 1}`,
    subject: 'physics', type: 'single_choice', stem: `Published stem ${index + 1}`,
    answer: 'A', explanation: 'Published explanation', options: [], difficulty: 2,
    source: '2026 city mock', region: 'Zhejiang', school: 'Gewu School', exam_type: 'mock', exam_year: '2026',
    grade: 'senior-three', semester: 'second', knowledgeLabels: ['Dynamics'], status: 'published',
    contentUpdatedAt: new Date(Date.UTC(2026, 7, 31, 0, 0, 0) - index * 1000).toISOString(),
  }));
  const browseQueries = [];
  const app = createCloudBusinessApp({ query: async (text, values) => {
    if (text.includes('WITH published AS')) {
      browseQueries.push({ text, values });
      const [, subject, queryTerms, source, knowledgePoint, type, difficulty, grade, semester, examType, examYear, cursorUpdatedAt, cursorId, requestedLimit] = values;
      const filteredRows = publishedRows.filter(row => (!subject || row.subject === subject)
        && (!queryTerms.length || queryTerms.every(term => `${row.id} ${row.stem}`.toLowerCase().includes(term)))
        && (!source || [row.source, row.region, row.school, row.exam_type, row.exam_year].join(' ').toLowerCase().includes(source.toLowerCase()))
        && (!knowledgePoint || row.knowledgeLabels.includes(knowledgePoint))
        && (!type || row.type === type)
        && (difficulty === null || row.difficulty === difficulty)
        && (!grade || row.grade === grade)
        && (!semester || row.semester === semester)
        && (!examType || row.exam_type === examType)
        && (!examYear || row.exam_year === examYear));
      const cursorIndex = cursorUpdatedAt
        ? filteredRows.findIndex(row => row.contentUpdatedAt === cursorUpdatedAt && row.id === cursorId)
        : -1;
      const pageRows = filteredRows.slice(cursorIndex + 1, requestedLimit === null ? undefined : cursorIndex + 1 + requestedLimit);
      const filterOptions = {
        subjects: ['physics'], types: ['single_choice'], sources: ['2026 city mock'], knowledgePoints: ['Dynamics'], difficulties: [2],
        grades: ['senior-three'], semesters: ['second'], examTypes: ['mock'], examYears: ['2026'],
      };
      return { rows: (pageRows.length ? pageRows : [{ id: null }]).map(row => ({ ...row, filteredTotal: filteredRows.length, filterOptions })) };
    }
    return { rows: [] };
  }, miniappCloudAccount, questionAuthority, paperExportTasks, businessTenantId: 'default' });
  const headers = { authorization: 'Bearer miniapp-ticket.signature' };

  const previews = await request(app, '/api/business/miniapp-question-previews', { headers });
  assert.strictEqual(previews.status, 200);
  assert.strictEqual(previews.body.questions.length, 205, 'privileged miniapp browsing must not silently truncate published questions');
  assert.strictEqual(previews.body.hasMore, false);
  assert.strictEqual(previews.body.total, 205, 'question browse totals must be computed by the cloud authority rather than the loaded page');
  assert.deepStrictEqual(previews.body.filterOptions.subjects, ['physics'], 'the cloud contract must return authoritative subject choices before filtering');
  assert.deepStrictEqual(browseQueries[0].values, ['default', null, [], null, null, null, null, null, null, null, null, null, null, null]);
  assert.strictEqual(browseQueries[0].values[13], null, 'formal roles must receive the complete published question set when no page size is supplied');
  assert.match(browseQueries[0].text, /taxonomyIds'->'knowledge'/u, 'knowledge labels must read only the knowledge taxonomy system');
  assert.doesNotMatch(browseQueries[0].text, /jsonb_each/u, 'model and custom taxonomy systems must never be flattened into knowledge labels');
  assert.strictEqual(questionCalls.length, 0, 'miniapp browsing must not expose the desktop management list containing drafts or archived questions');

  const filteredBrowse = await request(app, '/api/business/miniapp-question-previews?subject=physics&query=Published%20stem&source=city&knowledgePoint=Dynamics&type=single_choice&difficulty=2&grade=senior-three&semester=second&examType=mock&examYear=2026&limit=2', { headers });
  assert.strictEqual(filteredBrowse.status, 200);
  assert.strictEqual(filteredBrowse.body.total, 205);
  assert.deepStrictEqual(filteredBrowse.body.questions.map(question => question.id), ['q-public', 'q-formal-2']);
  assert.deepStrictEqual(browseQueries.at(-1).values.slice(0, 11), ['default', 'physics', ['published', 'stem'], 'city', 'Dynamics', 'single_choice', 2, 'senior-three', 'second', 'mock', '2026'], 'the route must forward the separated cloud filter contract without folding source or taxonomy metadata into the stem query');
  assert.deepStrictEqual(filteredBrowse.body.filterOptions, {
    subjects: ['physics'], types: ['single_choice'], sources: ['2026 city mock'], knowledgePoints: ['Dynamics'], difficulties: [2],
    grades: ['senior-three'], semesters: ['second'], examTypes: ['mock'], examYears: ['2026'],
  });
  assert.deepStrictEqual(filteredBrowse.body.questions[0], {
    id: 'q-public', subject: 'physics', type: 'single_choice', stemPreview: 'Published stem 1', answer: 'A', explanation: 'Published explanation',
    options: [], richContent: null, difficulty: 2, source: '2026 city mock', sourceLabel: '2026 city mock / Zhejiang / Gewu School / mock / 2026',
    region: 'Zhejiang', school: 'Gewu School', examType: 'mock', examYear: '2026', grade: 'senior-three', semester: 'second', knowledgeLabels: ['Dynamics'], status: 'published',
  }, 'the cloud must return the same structured source metadata the desktop card uses');
  assert.match(browseQueries.at(-1).text, /p\.subject=\$2/u);
  assert.match(browseQueries.at(-1).text, /q\.source/u);
  assert.match(browseQueries.at(-1).text, /n\.system_id='knowledge'/u);
  assert.match(browseQueries.at(-1).text, /p\.grade=\$8/u);
  assert.match(browseQueries.at(-1).text, /p\.semester=\$9/u);
  assert.match(browseQueries.at(-1).text, /p\.exam_type=\$10/u);
  assert.match(browseQueries.at(-1).text, /p\.exam_year=\$11/u);

  const firstPage = await request(app, '/api/business/miniapp-question-previews?limit=2', { headers });
  assert.strictEqual(firstPage.status, 200);
  assert.deepStrictEqual(firstPage.body.questions.map(question => question.id), ['q-public', 'q-formal-2']);
  assert.strictEqual(firstPage.body.hasMore, true);
  assert.strictEqual(typeof firstPage.body.nextCursor, 'string');
  assert.deepStrictEqual(browseQueries.at(-1).values, ['default', null, [], null, null, null, null, null, null, null, null, null, null, 3], 'a bounded page privately reads one look-ahead row');

  const secondPage = await request(app, `/api/business/miniapp-question-previews?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`, { headers });
  assert.strictEqual(secondPage.status, 200);
  assert.deepStrictEqual(secondPage.body.questions.map(question => question.id), ['q-formal-3', 'q-formal-4']);
  assert.strictEqual(secondPage.body.hasMore, true);
  assert.strictEqual(typeof secondPage.body.nextCursor, 'string');
  assert.match(browseQueries.at(-1).text, /"contentUpdatedAt" < \$12::timestamptz/u, 'subsequent pages must use a stable keyset rather than an offset');
  assert.deepStrictEqual(browseQueries.at(-1).values, ['default', null, [], null, null, null, null, null, null, null, null, publishedRows[1].contentUpdatedAt, 'q-formal-2', 3]);

  const invalidCursor = await request(app, '/api/business/miniapp-question-previews?limit=2&cursor=not-a-cursor', { headers });
  assert.strictEqual(invalidCursor.status, 400, 'invalid pagination cursors must fail closed');

  const maximumPage = await request(app, '/api/business/miniapp-question-previews?limit=200', { headers });
  assert.strictEqual(maximumPage.status, 200);
  assert.strictEqual(maximumPage.body.questions.length, 200);
  assert.strictEqual(maximumPage.body.hasMore, true);
  const finalPage = await request(app, `/api/business/miniapp-question-previews?limit=200&cursor=${encodeURIComponent(maximumPage.body.nextCursor)}`, { headers });
  assert.strictEqual(finalPage.status, 200);
  assert.deepStrictEqual(finalPage.body.questions.map(question => question.id), ['q-formal-201', 'q-formal-202', 'q-formal-203', 'q-formal-204', 'q-formal-205']);
  assert.strictEqual(finalPage.body.hasMore, false);
  assert.strictEqual(finalPage.body.nextCursor, null, 'the terminal page must explicitly close the cursor chain');
  assert.strictEqual((await request(app, '/api/business/miniapp-question-previews?limit=201', { headers })).status, 400);
  assert.strictEqual((await request(app, `/api/business/miniapp-question-previews?cursor=${encodeURIComponent(firstPage.body.nextCursor)}`, { headers })).status, 400);
  assert.strictEqual((await request(app, '/api/business/miniapp-question-previews?query=stem&limit=2', { headers })).status, 400, 'all secondary filters must require an explicit subject scope');
  assert.strictEqual((await request(app, '/api/business/miniapp-question-previews?grade=senior-three&limit=2', { headers })).status, 400, 'desktop parity filters cannot bypass the subject scope');

  const studentPreviews = await request(app, '/api/business/miniapp-question-previews', { headers: { authorization: 'Bearer miniapp-student.signature' } });
  assert.strictEqual(studentPreviews.status, 200);
  assert.strictEqual(studentPreviews.body.questions.length, 205, 'student browsing must not silently truncate published questions');
  assert.strictEqual(studentPreviews.body.hasMore, false);
  assert.deepStrictEqual(browseQueries.at(-1).values, ['default', null, [], null, null, null, null, null, null, null, null, null, null, null]);

  const visitorBrowse = await request(app, '/api/business/miniapp-question-previews', { headers: { authorization: 'Bearer miniapp-visitor.signature' } });
  assert.strictEqual(visitorBrowse.status, 200);
  assert.strictEqual(visitorBrowse.body.ok, true);
  assert.strictEqual(visitorBrowse.body.hasMore, true);
  assert.strictEqual(visitorBrowse.body.questions.length, 20, 'the private look-ahead row must never be returned to the visitor');
  assert.strictEqual(visitorBrowse.body.questions[0].id, 'q-public');
  assert.deepStrictEqual(browseQueries.at(-1).values, ['default', null, [], null, null, null, null, null, null, null, null, null, null, 21], 'visitor browsing keeps the twenty-question boundary while privately detecting whether more exist');
  const visitorCursorAttempt = await request(app, `/api/business/miniapp-question-previews?limit=20&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`, { headers: { authorization: 'Bearer miniapp-visitor.signature' } });
  assert.strictEqual(visitorCursorAttempt.status, 400, 'a visitor cannot replay a formal-role cursor to page beyond the first twenty questions');

  const created = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { ...headers, 'x-idempotency-key': 'miniapp-paper-1' },
    body: { taskType: 'paper-export-pdf', request: { questionIds: ['q-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(created.status, 202);
  assert.strictEqual(paperCalls.length, 1);
  assert.strictEqual(paperCalls[0].actor.accountId, 'miniapp-super-admin-1');

  const studentExport = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { authorization: 'Bearer miniapp-student.signature', 'x-idempotency-key': 'miniapp-student-paper' },
    body: { taskType: 'paper-export-pdf', request: { questionIds: ['q-public'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(studentExport.status, 403);

  const disallowed = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { ...headers, 'x-idempotency-key': 'miniapp-paper-2' },
    body: { taskType: 'question-paper', request: { questionIds: ['q-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(disallowed.status, 400);
  console.log('cloud miniapp limited-task checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
