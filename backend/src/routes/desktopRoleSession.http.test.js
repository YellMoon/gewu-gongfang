'use strict';

const assert = require('assert');
const fs = require('fs');

const embeddedApp = fs.readFileSync('backend/src/app.js', 'utf8');
const rendererClient = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');

assert.ok(!embeddedApp.includes('/api/permissions'), 'the embedded cache must not project local role capabilities');
assert.ok(!embeddedApp.includes('/api/desktop-identity'), 'the embedded cache must not rotate or elevate desktop roles');
assert.ok(rendererClient.includes("'/api/desktop-identity/session/role'"),
  'the existing cloud-base role client remains until the cloud DB role-session contract is migrated');
assert.ok(rendererClient.includes("'/api/desktop-identity/session/challenges/start'"),
  'the existing cloud-base resume client remains until the cloud DB resume contract is migrated');

console.log('embedded desktop role-session authority retirement checks passed');
