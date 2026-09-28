'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'SyncQuickPanel.tsx'),'utf8');
assert(!source.includes('Popover'), 'the sync entry must not mount a floating history panel');
assert.match(source,/onClick=\{openDesktopSync\}/, 'the sync button opens the shared pending-review dialog');
console.log('single sync window entry checks passed');
