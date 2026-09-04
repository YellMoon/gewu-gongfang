'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../app'), 'utf8');
assert.ok(!source.includes("app.use('/api/miniapp/applications'"), 'the embedded cache service must not expose a second miniapp role-application authority');
assert.ok(!source.includes("app.use('/api/miniapp/wechat-bindings'"), 'the embedded cache service must not expose a second WeChat-binding authority');
assert.ok(!source.includes("app.get('/api/miniapp/projection'"), 'the embedded cache service must not expose a local miniapp projection reader');
assert.ok(!source.includes("require('./routes/miniappAuthorityApplications')"), 'the retired local role-application router must not be loaded by the embedded service');
assert.ok(!source.includes("require('./routes/miniappWechatBindings')"), 'the retired local WeChat-binding router must not be loaded by the embedded service');
assert.ok(!source.includes("require('./routes/miniappAuthorityProjection')"), 'the retired local miniapp projection reader must not be loaded by the embedded service');
assert.ok(!source.includes("require('./routes/auth')"), 'the embedded cache service must not load the retired local login authority');
assert.ok(!source.includes("require('./routes/adminUsers')"), 'the embedded cache service must not load the retired local user administration authority');
assert.ok(!source.includes("require('./routes/permissions')"), 'the embedded cache service must not load the retired local permission projection');
assert.ok(!source.includes("app.use('/api/auth'"), 'the embedded cache service must not expose local login endpoints');
assert.ok(!source.includes("app.use('/api/admin/users'"), 'the embedded cache service must not expose local user administration endpoints');
assert.ok(!source.includes("app.use('/api/permissions'"), 'the embedded cache service must not expose a local permission authority');
assert.ok(!source.includes("require('./routes/desktopIdentity')"), 'the embedded cache service must not load the retired local desktop identity authority');
assert.ok(!source.includes("app.use('/api/desktop-identity'"), 'the embedded cache service must not expose local device or session authority endpoints');

console.log('miniapp cloud-only route boundary checks passed');
