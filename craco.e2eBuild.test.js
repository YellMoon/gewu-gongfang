const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('craco.config.js', 'utf8');

assert.ok(source.includes('GEWU_E2E_SKIP_TYPECHECK'),
  'isolated desktop E2E builds need an explicit opt-in to skip duplicate webpack type checking');
assert.ok(source.includes('ForkTsCheckerWebpackPlugin'),
  'the opt-in must remove only the duplicate fork checker, not weaken ordinary builds');

console.log('CRACO isolated E2E build policy checks passed');
