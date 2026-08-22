'use strict';

const assert = require('assert');

const { createQuestionAuthorityRuntime } = require('./questionAuthorityRuntime');

assert.strictEqual(createQuestionAuthorityRuntime({}), null, 'runtime must not fabricate a question authority without a database query');
const runtime = createQuestionAuthorityRuntime({ query: async () => ({ rows: [] }) });
assert.ok(runtime && typeof runtime.create === 'function', 'runtime must expose the cloud-owned question command');

console.log('cloud question authority runtime checks passed');
