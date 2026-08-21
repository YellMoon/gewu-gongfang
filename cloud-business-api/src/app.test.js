'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const healthy = await request(createCloudBusinessApp({ query: async () => ({ rows: [{ ok: 1 }] }) }), '/api/health');
  assert.strictEqual(healthy.status, 200);
  assert.deepStrictEqual(healthy.body, { ok: true, database: 'postgresql', businessAuthority: 'cloud' });

  const unavailable = await request(createCloudBusinessApp({ query: async () => { throw new Error('database unavailable'); } }), '/api/health');
  assert.strictEqual(unavailable.status, 503);
  assert.deepStrictEqual(unavailable.body, { ok: false, database: 'unavailable' });

  console.log('cloud business API health checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
