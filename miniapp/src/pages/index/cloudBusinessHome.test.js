'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

assert.match(source, /pullFromCloudBusinessProjection/, 'home must hydrate its business cache from the cloud projection');
assert.ok(!source.includes('authorityProjectionApi'), 'home must not call the retired local-backend projection API');
assert.ok(!source.includes("api.get<{ modules: ModuleInfo[] }>('/api/modules')"), 'home must not call the retired local-backend module API');
assert.ok(!source.includes('fetchPermissions()'), 'home must not call the retired local-backend permission API');
assert.match(source, /homeLoadGeneration/, 'home must isolate asynchronous state updates between account identities');
assert.match(source, /stillCurrent/, 'home must reject stale projection and dashboard results after an identity switch');
assert.match(source, /setModules\(\[\]\)/, 'home must clear the previous identity module view before loading the next identity');

console.log('miniapp cloud business home checks passed');
