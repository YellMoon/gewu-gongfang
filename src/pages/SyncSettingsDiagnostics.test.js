const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'SyncSettings.tsx'), 'utf8');
assert.ok(source.includes('__GEWU_E2E_SYNC_DIAGNOSTICS__'), 'isolated desktop diagnostics sink must be opt-in');
assert.ok(source.includes('onStage: recordOneClickSyncStage'), 'the UI must forward service stage diagnostics during isolated desktop testing');
console.log('sync settings diagnostics bridge test passed');
