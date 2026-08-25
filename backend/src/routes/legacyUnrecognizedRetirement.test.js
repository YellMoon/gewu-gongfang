const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('backend/src/app.js', 'utf8');
const auth = fs.readFileSync('backend/src/middleware/auth.js', 'utf8');
const identity = fs.readFileSync('backend/src/services/miniappIdentityService.js', 'utf8');

assert.ok(!app.includes('unrecognizedStudentGuard'), 'the retired unrecognized identity guard must not be mounted');
assert.ok(!app.includes("app.use('/api/experience'"), 'the retired experience API must not be mounted');
assert.ok(!auth.includes('UNRECOGNIZED_TOKEN_USE'), 'legacy unrecognized tokens must not authenticate');
assert.ok(!identity.includes('UNRECOGNIZED_TOKEN_USE'), 'miniapp login must not issue unrecognized tokens');
assert.ok(!identity.includes('issueUnrecognizedToken'), 'miniapp login must not expose unrecognized-token issuance');

console.log('legacy unrecognized identity retirement checks passed');
