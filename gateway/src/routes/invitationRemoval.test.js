const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('gateway/src/app.js', 'utf-8');
const authMiddleware = fs.readFileSync('gateway/src/middleware/auth.js', 'utf-8');

assert.ok(!app.includes("require('./routes/invitations')"), 'gateway should not load the legacy invitation router');
assert.ok(!app.includes('/api/invitations'), 'gateway should not expose legacy invitation APIs');
assert.ok(!authMiddleware.includes('邀请码注册'), 'gateway auth comments should reflect the verified-phone authorization flow');
console.log('gateway invitation removal checks passed');
