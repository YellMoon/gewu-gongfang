'use strict';

const assert = require('assert');
const gatewayPackage = require('../package.json');

async function requestHealth(app) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(response.status, 200);
    return response.json();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const previous = process.env.GEWU_APP_VERSION;
  try {
    delete process.env.GEWU_APP_VERSION;
    const createApp = require('./app');
    let health = await requestHealth(createApp());
    assert.strictEqual(health.version, gatewayPackage.version, 'Gateway local health should fall back to its package version');

    process.env.GEWU_APP_VERSION = '9.8.7-unified-smoke';
    health = await requestHealth(createApp());
    assert.strictEqual(health.version, '9.8.7-unified-smoke', 'Gateway deployed health should use the unified deploy version');

    process.env.GEWU_APP_VERSION = '   ';
    health = await requestHealth(createApp());
    assert.strictEqual(health.version, gatewayPackage.version, 'blank deploy version should use the safe package fallback');
  } finally {
    if (previous === undefined) delete process.env.GEWU_APP_VERSION;
    else process.env.GEWU_APP_VERSION = previous;
  }
  console.log('gateway app health checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
