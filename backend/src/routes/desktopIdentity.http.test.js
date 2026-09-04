'use strict';

const assert = require('assert');
const fs = require('fs');

const embeddedApp = fs.readFileSync('backend/src/app.js', 'utf8');
const cloudApp = fs.readFileSync('cloud-business-api/src/app.js', 'utf8');
const rendererClient = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');

assert.ok(!fs.existsSync('backend/src/routes/desktopIdentity.js'), 'the local SQLite desktop identity router must be deleted');
assert.ok(!embeddedApp.includes("app.use('/api/desktop-identity'"), 'the embedded cache runtime must not expose device, session, or role authority');
assert.ok(!embeddedApp.includes("require('./routes/desktopIdentity')"), 'the embedded runtime must not load the retired desktop identity router');
assert.ok(cloudApp.includes("app.post('/api/desktop/online-registration'"), 'new installations must register through the cloud identity authority');
assert.ok(cloudApp.includes("app.get('/api/desktop/session-context'"), 'desktop session introspection must remain cloud-owned');
assert.ok(rendererClient.includes("'/api/desktop/online-registration'"), 'the desktop renderer must keep using the cloud registration contract');

console.log('embedded desktop identity route retirement checks passed');
