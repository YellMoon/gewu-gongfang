const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/runtimeConfigClient.ts', 'utf-8');

assert.ok(source.includes("runtime-config:get"), 'client should call runtime-config:get');
assert.ok(source.includes("runtime-config:set"), 'client should call runtime-config:set');
assert.ok(source.includes("dialog:select-folder"), 'client should call dialog:select-folder');
assert.ok(source.includes('getRuntimeConfig'), 'client should export getRuntimeConfig');
assert.ok(source.includes('saveRuntimeConfig'), 'client should export saveRuntimeConfig');
