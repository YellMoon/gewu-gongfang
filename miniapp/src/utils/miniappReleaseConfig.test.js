const assert = require('assert');
const fs = require('fs');

const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const projectConfig = fs.readFileSync('miniapp/project.config.json', 'utf-8');
const prodConfig = fs.readFileSync('miniapp/config/prod.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(api.includes('__API_BASE_URL__'), 'miniapp API should use build-time API base URL');
assert.ok(!api.includes("DEFAULT_BASE_URL = 'http://39.106.172.132'"), 'miniapp default API should not be bare HTTP IP');
assert.ok(api.includes('https://physicsedu.xyz/scheduling'), 'miniapp default API should use HTTPS legal domain');
assert.ok(prodConfig.includes('https://physicsedu.xyz/scheduling'), 'miniapp prod config should use HTTPS legal domain');
assert.ok(projectConfig.includes('"urlCheck": true'), 'miniapp project config should enable URL checks for release');
assert.ok(projectConfig.includes('"uploadWithSourceMap": false'), 'miniapp project config should not upload source maps for release');
assert.ok(packageJson.includes('miniapp/src/utils/miniappReleaseConfig.test.js'), 'miniapp release config test should run in npm test');

console.log('miniapp release config checks passed');
