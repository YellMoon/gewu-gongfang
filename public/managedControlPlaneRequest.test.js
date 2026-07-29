'use strict';

const assert = require('assert');
const http = require('http');
const { requestManagedControlPlane } = require('./managedControlPlaneRequest');

async function main() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        method: req.method,
        authorization: req.headers.authorization || '',
        body: JSON.parse(body || '{}'),
      }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const response = await requestManagedControlPlane(`http://127.0.0.1:${port}/control-plane`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-session' },
      body: JSON.stringify({ operation: 'verify' }),
    });
    assert.strictEqual(response.ok, true);
    const payload = await response.json();
    assert.strictEqual(payload.method, 'POST');
    assert.strictEqual(payload.authorization, 'Bearer test-session');
    assert.deepStrictEqual(payload.body, { operation: 'verify' });
    await assert.rejects(
      requestManagedControlPlane('not a URL'),
      error => error?.code === 'MANAGED_CONTROL_PLANE_URL_INVALID'
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('managed control plane request checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
