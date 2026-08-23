'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/server.js', 'utf8');
assert.ok(source.includes('authorityEnabled: true'));
for (const retired of [
  'createHostCommandWorker', 'createAuthorityHostRuntime', 'createAuthorityCommandSource',
  'createAuthorityCompositeCommandSource', 'createAuthoritySocketCommandHandler',
  'AuthoritySocketServer', 'signPrimaryHostProjection', 'publishAuthorityHostEpoch',
  'hostCommandWorker', 'primary-host',
]) {
  assert.ok(!source.includes(retired), `cloud backend must not retain ${retired}`);
}
console.log('cloud runtime worker integration checks passed');
