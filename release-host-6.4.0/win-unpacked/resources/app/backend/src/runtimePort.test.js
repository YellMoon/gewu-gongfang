const assert = require('assert');
const fs = require('fs');

const serverSource = fs.readFileSync('backend/server.js', 'utf-8');
const pm2Source = fs.readFileSync('backend/pm2.config.js', 'utf-8');

assert.ok(serverSource.includes('resolveBackendPort'), 'direct backend start should use shared port resolution');
assert.ok(pm2Source.includes('resolveBackendPort'), 'PM2 production start should use shared port resolution');

const { resolveBackendPort } = require('./runtimePort');
assert.strictEqual(resolveBackendPort({ APP_ENV: 'prod' }), 3002);
assert.strictEqual(resolveBackendPort({ NODE_ENV: 'production' }), 3002);
assert.strictEqual(resolveBackendPort({ APP_ENV: 'dev' }), 3001);
assert.strictEqual(resolveBackendPort({ NODE_ENV: 'development' }), 3001);
assert.strictEqual(resolveBackendPort({ APP_ENV: 'prod', PORT: '4310' }), 4310, 'explicit PORT should win');

const previousAppEnv = process.env.APP_ENV;
const previousPort = process.env.PORT;
process.env.APP_ENV = 'dev';
delete process.env.PORT;
delete require.cache[require.resolve('../pm2.config')];
const pm2Config = require('../pm2.config');
assert.strictEqual(pm2Config.apps[0].env.PORT, 3002, 'PM2 production config should ignore a stale dev APP_ENV');
if (previousAppEnv === undefined) delete process.env.APP_ENV;
else process.env.APP_ENV = previousAppEnv;
if (previousPort === undefined) delete process.env.PORT;
else process.env.PORT = previousPort;

console.log('backend runtime port checks passed');
