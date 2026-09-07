'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'SyncQuickPanel.tsx'),'utf8');
assert.match(source,/placement="bottomLeft"/,'confirmation popover must open into the content area, not under pinned navigation');
console.log('sync confirmation popover anchor checks passed');
