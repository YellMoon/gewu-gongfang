const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('src/index.css', 'utf8');

const pinnedMainRule = css.match(/\.app-shell--nav-pinned\s+\.app-shell__main\s*\{([^}]*)\}/u)?.[1] || '';
assert.match(pinnedMainRule, /margin-left:\s*236px/u,
  'a pinned 236px navigation rail must move the application main region out from underneath it');
assert.match(pinnedMainRule, /width:\s*calc\(100%\s*-\s*236px\)/u,
  'a pinned navigation rail must subtract its width instead of creating horizontal overflow');

console.log('pinned application shell layout checks passed');
