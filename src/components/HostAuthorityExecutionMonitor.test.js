const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'HostAuthorityExecutionMonitor.tsx'), 'utf8');
assert.ok(source.includes('window.primaryHostRuntime?.runtimeStatus'),
  'the host monitor must read authoritative worker/runtime state from the host bridge');
assert.ok(source.includes('lastProcessed') && source.includes('lastCompletedAt') && source.includes('projections'),
  'the host monitor must expose execution and projection publication evidence');
assert.ok(!source.includes('confirmAndSubmit') && !source.includes('appendDraft') && !source.includes('desktopAuthority'),
  'the host monitor must not expose a client outbound submission path');
console.log('host authority execution monitor checks passed');
