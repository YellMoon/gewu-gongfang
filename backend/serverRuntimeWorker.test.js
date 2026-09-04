'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/server.js', 'utf8');
assert.ok(!source.includes('CloudRelaySocketServer'),
  'the retired HTTP/WebSocket relay must not be instantiated by the public backend');
assert.ok(!source.includes('authorityEnabled'));
for (const retired of [
  'createHostCommandWorker', 'createAuthorityHostRuntime', 'createAuthorityCommandSource',
  'createAuthorityCompositeCommandSource', 'createAuthoritySocketCommandHandler',
  'AuthoritySocketServer', 'signPrimaryHostProjection', 'publishAuthorityHostEpoch',
  'hostCommandWorker', 'primary-host',
]) {
  assert.ok(!source.includes(retired), `cloud backend must not retain ${retired}`);
}
console.log('cloud runtime worker integration checks passed');
