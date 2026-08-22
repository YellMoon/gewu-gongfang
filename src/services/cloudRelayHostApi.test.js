const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/cloudRelayHostApi.ts', 'utf8');
assert.ok(!source.includes('hostBaseUrl'));
assert.ok(!source.includes('http://127.0.0.1'));
assert.ok(!source.includes('getRuntimeConfig'));
assert.ok(source.includes('LOCAL_AUTHORITY_RETIRED'));

console.log('retired local authority API checks passed');
