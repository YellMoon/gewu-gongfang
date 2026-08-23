'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'sync.ts'), 'utf8');

assert.match(source, /createCloudBusinessProjectionRuntime/, 'sync must hydrate its local read cache only from the cloud projection');
assert.match(source, /miniappCloudBusinessApi\.readBusinessProjection/, 'sync must use the scoped cloud business read model');
assert.match(source, /export async function pullFromCloudBusinessProjection/, 'pages need one supported cloud hydration entry point');

console.log('miniapp cloud projection sync checks passed');
