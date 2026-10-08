'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createCloudBusinessApp } = require('./app');

(async () => {
  const calls = [];
  let failure = null;
  const profile = { accountName: 'teacher.login', name: '测试教师', phone: '13800138000', subject: '数学', wechat: null, activeRole: 'teacher', eligibleRoles: ['teacher'] };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopAccountProfile: {
    async read(input) { calls.push(input); if (failure) throw failure; return profile; },
  } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/desktop-identity/profile`;
  try {
    let response = await fetch(url, { headers: { authorization: 'Bearer current.token' } });
    assert.equal(response.status, 200, 'authenticated current-account profile route must exist');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { success: true, data: profile });
    assert.deepEqual(calls, [{ sessionToken: 'current.token' }]);

    response = await fetch(url);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, code: 'DESKTOP_SESSION_REQUIRED' });
    assert.equal(calls.length, 1);
    for (const query of ['accountId=other-account', 'teacherId=other-teacher', 'sessionToken=other.token']) {
      response = await fetch(`${url}?${query}`, { headers: { authorization: 'Bearer current.token' } });
      assert.equal(response.status, 400, 'callers cannot choose another profile or token');
      assert.deepEqual(await response.json(), { success: false, code: 'DESKTOP_IDENTITY_INPUT_FORBIDDEN' });
    }
    assert.equal(calls.length, 1);

    failure = Object.assign(new Error('rejected'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
    response = await fetch(url, { headers: { authorization: 'Bearer expired.token' } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, code: 'DESKTOP_SESSION_REQUIRED' });
    failure = new Error('private database details');
    response = await fetch(url, { headers: { authorization: 'Bearer current.token' } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, code: 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('desktop account profile route checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
