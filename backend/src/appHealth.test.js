const assert = require('assert');
const pkg = require('../../package.json');

async function requestHealth(app) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-trace-id': 'health-test-trace' },
    });
    return response.json();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  delete process.env.APP_VERSION;
  delete process.env.GEWU_APP_VERSION;
  delete require.cache[require.resolve('./app')];
  let { createApp } = require('./app');
  let health = await requestHealth(createApp());
  assert.strictEqual(health.version, pkg.version, 'health version should default to package.json version');
  assert.strictEqual(health.traceId, 'health-test-trace', 'health should keep request trace id');

  process.env.GEWU_APP_VERSION = '9.8.7-smoke';
  delete require.cache[require.resolve('./app')];
  ({ createApp } = require('./app'));
  health = await requestHealth(createApp());
  assert.strictEqual(health.version, '9.8.7-smoke', 'health version should allow deploy-time env override');

  console.log('app health checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
