const assert = require('assert');
const fs = require('fs');
const path = require('path');

const policyPath = path.join(__dirname, '..', 'SAFETY.md');
assert.ok(fs.existsSync(policyPath), 'SAFETY.md should document operational safety rules');

const policy = fs.readFileSync(policyPath, 'utf-8');
[
  'Format-Volume',
  'Clear-Disk',
  'Remove-Item -Recurse',
  'maintenanceToken',
  'challenge',
  'git commit/push',
].forEach((requiredText) => {
  assert.ok(policy.includes(requiredText), `SAFETY.md should mention ${requiredText}`);
});

console.log('safety policy checks passed');
