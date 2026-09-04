'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  const calls = [];
  const deliveries = {
    request: async input => { calls.push(['request', input]); return { deliveryId: 'question_asset_delivery_12345678', status: 'ready', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: '2026-08-27T00:15:00.000Z' }; },
    status: async input => { calls.push(['status', input]); return { deliveryId: input.deliveryId, status: 'ready', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: '2026-08-27T00:15:00.000Z' }; },
    download: async input => { calls.push(['download', input]); return { deliveryId: input.deliveryId, fileName: 'diagram.png', mimeType: 'image/png', bytes: Buffer.from('image') }; },
  };
  const miniappCloudAccount = {
    login: async () => { throw new Error('not used'); },
    context: async ({ token }) => {
      if (token === 'mini-ticket.signature') return { accountId: 'mini-account-1', status: 'active', roles: ['student'] };
      if (token === 'teacher-ticket.signature') return { accountId: 'mini-teacher-1', status: 'active', roles: ['teacher'] };
      if (token === 'visitor-ticket.signature') return { accountId: 'mini-visitor-1', status: 'visitor', roles: [] };
      return null;
    },
  };
  const visibilityQueries = [];
  const app = createCloudBusinessApp({
    query: async (text, values) => {
      visibilityQueries.push({ text, values });
      if (values[1] === 'question-1') return { rows: [{ id: 'question-1' }] };
      if (values[1] === 'question-21') return { rows: text.includes('LIMIT 20') ? [] : [{ id: 'question-21' }] };
      return { rows: [] };
    },
    miniappCloudAccount,
    questionAuthority: { create: async () => { throw new Error('not used'); }, list: async () => [{ id: 'question-draft', status: 'draft' }] },
    questionAssetDeliveries: deliveries,
    businessTenantId: 'default',
  });
  const headers = { authorization: 'Bearer mini-ticket.signature' };
  const created = await request(app, `/api/business/miniapp-question-assets/${'a'.repeat(64)}/delivery`, { method: 'POST', headers, body: { questionId: 'question-1' } });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.delivery.deliveryId, 'question_asset_delivery_12345678');
  const teacherCreated = await request(app, `/api/business/miniapp-question-assets/${'c'.repeat(64)}/delivery`, { method: 'POST', headers: { authorization: 'Bearer teacher-ticket.signature' }, body: { questionId: 'question-1' } });
  assert.strictEqual(teacherCreated.status, 200, 'teacher miniapp delivery must use the same published-only visibility query as the question list');
  const teacherOlderQuestion = await request(app, `/api/business/miniapp-question-assets/${'d'.repeat(64)}/delivery`, { method: 'POST', headers: { authorization: 'Bearer teacher-ticket.signature' }, body: { questionId: 'question-21' } });
  assert.strictEqual(teacherOlderQuestion.status, 200, 'the test fixture proves that the twenty-first published question really exists');
  const status = await request(app, '/api/business/miniapp-question-asset-deliveries/question_asset_delivery_12345678', { headers });
  assert.strictEqual(status.status, 200);
  const downloaded = await request(app, '/api/business/miniapp-question-asset-deliveries/question_asset_delivery_12345678/download', { headers });
  assert.strictEqual(downloaded.status, 200);
  assert.strictEqual(downloaded.headers.get('content-type'), 'image/png');
  const denied = await request(app, `/api/business/miniapp-question-assets/${'b'.repeat(64)}/delivery`, { method: 'POST', headers: { authorization: 'Bearer visitor-ticket.signature' }, body: { questionId: 'question-21' } });
  assert.strictEqual(denied.status, 403, 'a visitor cannot use a known question id or cached asset hash to request media for the twenty-first real question');
  const visitorVisibilityQuery = visibilityQueries.at(-1);
  assert.match(visitorVisibilityQuery.text, /ORDER BY c\.updated_at DESC,q\.id ASC LIMIT 20/u, 'media delivery must enforce the exact same ordered first-twenty boundary as browsing');
  assert.deepStrictEqual(visitorVisibilityQuery.values, ['default', 'question-21']);
  assert.deepStrictEqual(calls, [
    ['request', { tenantId: 'default', accountId: 'mini-account-1', questionId: 'question-1', assetKey: 'a'.repeat(64) }],
    ['request', { tenantId: 'default', accountId: 'mini-teacher-1', questionId: 'question-1', assetKey: 'c'.repeat(64) }],
    ['request', { tenantId: 'default', accountId: 'mini-teacher-1', questionId: 'question-21', assetKey: 'd'.repeat(64) }],
    ['status', { tenantId: 'default', accountId: 'mini-account-1', deliveryId: 'question_asset_delivery_12345678' }],
    ['download', { tenantId: 'default', accountId: 'mini-account-1', deliveryId: 'question_asset_delivery_12345678' }],
  ]);
  console.log('question asset delivery route checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
