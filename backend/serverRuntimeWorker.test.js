'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/server.js', 'utf8');
assert.ok(source.includes("createHostCommandWorker"));
assert.ok(source.includes('createAuthorityHostRuntime'));
assert.ok(source.includes('createAuthorityCommandSource'));
assert.ok(source.includes('createAuthorityCompositeCommandSource'));
assert.ok(source.includes('createAuthoritySocketCommandHandler'));
assert.ok(source.includes('new AuthoritySocketServer'));
assert.ok(source.includes('createAuthorityProjectionPublisherService'));
assert.ok(source.includes('createAuthorityProjectionSourceService'));
assert.ok(source.includes('createAuthorityProjectionWorker'));
assert.ok(source.includes('signPrimaryHostProjection'));
assert.ok(source.includes('publishAuthorityHostEpoch'));
assert.ok(source.includes('worker: hostCommandWorker'));
assert.ok(source.includes('hostCommandWorker?.stop()'));
assert.ok(source.includes('authorityProjectionWorker?.stop()'));
assert.ok(!source.includes('processHostTaskCycle'), 'the standalone host worker must not process legacy relay tasks');
assert.ok(!source.includes('setInterval('), 'the standalone host must not create a second task polling loop');
console.log('standalone host runtime worker integration checks passed');
