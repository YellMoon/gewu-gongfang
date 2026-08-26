'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../app'), 'utf8');
assert.ok(!source.includes("app.use('/api/miniapp/applications'"), 'the embedded cache service must not expose a second miniapp role-application authority');
assert.ok(!source.includes("app.use('/api/miniapp/wechat-bindings'"), 'the embedded cache service must not expose a second WeChat-binding authority');
assert.ok(!source.includes("require('./routes/miniappAuthorityApplications')"), 'the retired local role-application router must not be loaded by the embedded service');
assert.ok(!source.includes("require('./routes/miniappWechatBindings')"), 'the retired local WeChat-binding router must not be loaded by the embedded service');

console.log('miniapp cloud-only route boundary checks passed');
