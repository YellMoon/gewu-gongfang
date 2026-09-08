const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('src/index.css', 'utf8');

const pinnedMainRule = css.match(/\.app-shell--nav-pinned\s+\.app-shell__main\s*\{([^}]*)\}/u)?.[1] || '';
// UTF-8: navigation overlays the unchanged workspace, as before the migration.
assert.doesNotMatch(pinnedMainRule, /margin-left|width|padding-left|transform/u,
  'opening or pinning navigation must not move or shrink the main workspace');

console.log('pinned application shell layout checks passed');
