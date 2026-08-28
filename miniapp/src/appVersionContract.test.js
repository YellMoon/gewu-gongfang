'use strict';

const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('miniapp/src/app.tsx', 'utf8');
const settings = fs.readFileSync('miniapp/src/pages/settings/index.tsx', 'utf8');
const packageJson = require('../package.json');

assert.ok(app.includes('declare const __APP_VERSION__'), 'startup logging must use the injected miniapp build version');
assert.ok(app.includes('const APP_VERSION ='), 'startup must resolve a version before it logs');
assert.ok(app.includes('miniappPackage.version'), 'startup must have a package-version fallback for local development');
assert.ok(app.includes('console.info(`\\u683c\\u7269\\u5de5\\u574a v${APP_VERSION}`)'), 'startup log must use the product name and its actual miniapp version');
assert.ok(!app.includes('\\u6559\\u80b2\\u7efc\\u5408\\u670d\\u52a1\\u5e73\\u53f0 v1.6.0'), 'startup must not retain the retired product/version string');
assert.ok(settings.includes('miniappPackage.version'), 'settings must not fall back to a stale hard-coded miniapp version');
assert.strictEqual(packageJson.description.includes('\u6559\u80b2\u7efc\u5408\u670d\u52a1\u5e73\u53f0'), false, 'package metadata must use the current product name');

console.log('miniapp startup version contract checks passed');
