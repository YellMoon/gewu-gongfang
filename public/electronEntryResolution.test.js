const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
const sourceBuildEntry = "path.join(__dirname, '..', 'build', 'index.html')";
const publicTemplateEntry = "path.join(__dirname, 'index.html')";
const sourceBuildIndex = source.indexOf(sourceBuildEntry);
const publicTemplateIndex = source.indexOf(publicTemplateEntry);

assert.ok(sourceBuildIndex >= 0, 'Electron must consider the built renderer entry');
assert.ok(publicTemplateIndex >= 0, 'Electron may keep the public template as a final fallback');
assert.ok(
  sourceBuildIndex < publicTemplateIndex,
  'Electron must prefer build/index.html over the empty CRA public/index.html template',
);

console.log('electron renderer entry resolution tests passed');
