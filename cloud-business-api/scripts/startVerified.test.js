'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { start } = require('./startVerified');

(async () => {
  const events = [];
  await start({
    verify: async () => { events.push('verified'); },
    markVerified: () => { events.push('marked'); },
    loadServer: () => { events.push('server'); },
  });
  assert.deepStrictEqual(events, ['verified', 'marked', 'server']);

  let markedAfterFailure = false;
  await assert.rejects(() => start({
    verify: async () => { throw Object.assign(new Error('invalid'), { code: 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID' }); },
    markVerified: () => { markedAfterFailure = true; },
    loadServer: () => { throw new Error('server must not load'); },
  }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
  assert.strictEqual(markedAfterFailure, false);

  const directServer = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    encoding: 'utf8',
    env: {},
  });
  assert.notStrictEqual(directServer.status, 0, 'direct server startup must fail closed');
  assert.match(directServer.stderr, /CLOUD_FIXED_SUPER_ADMIN_STARTUP_REQUIRED/u);
  console.log('verified cloud startup gate checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
