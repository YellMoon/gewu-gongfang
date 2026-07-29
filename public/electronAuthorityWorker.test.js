const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('public/electron.js', 'utf8');
assert.ok(source.includes('createAuthorityHostRuntime'));
assert.ok(source.includes('createAuthorityCommandSource'));
assert.ok(source.includes('createAuthorityCompositeCommandSource'));
assert.ok(source.includes('createAuthoritySocketCommandHandler'));
assert.ok(source.includes('new AuthoritySocketServer'));
assert.ok(source.includes('authorityRuntime.processor.processOnce()'));
assert.ok(source.includes('createAuthorityProjectionPublisherService'));
assert.ok(source.includes('createAuthorityProjectionSourceService'));
assert.ok(source.includes('createAuthorityProjectionWorker'));
assert.ok(source.includes('publishAuthorityProjection'));
assert.ok(source.includes('publishAuthorityHostEpoch'));
assert.ok(source.includes('signPrimaryHostProjection'));
assert.ok(!source.includes('signProjection: input => getDesktopIdentityVault().signAuthorityProjection(input)'));
assert.ok(source.includes('process.env.GEWU_PRIMARY_HOST_CREDENTIAL'));
assert.ok(source.includes('runtimeConfig.primaryHostGeneration'));
assert.ok(source.includes('function canStartAuthorityHostRuntime'),
  'the worker start must be gated on an activated primary-host credential, not only the host role');
assert.ok(source.includes('AUTHORITY_RUNTIME_DEFERRED_UNTIL_HOST_CREDENTIAL'),
  'first-time host bootstrap must keep its backend available while deferring the authority worker until credential adoption and restart');
const controlRefreshBeforeWorker = source.indexOf('await refreshControlRecords();');
const projectionWorkerCreation = source.indexOf('authorityProjectionWorker = createAuthorityProjectionWorker({');
assert.ok(controlRefreshBeforeWorker >= 0 && projectionWorkerCreation > controlRefreshBeforeWorker,
  'an activated primary host must pull cloud control records before it can publish a local projection snapshot');
assert.ok(!source.includes('processHostTaskCycle'), 'Electron host runtime must not execute legacy relay task cycles');
assert.ok(source.includes('runtimeStatus.bindWorker(hostCommandWorker)'));

console.log('Electron authority worker integration checks passed');
