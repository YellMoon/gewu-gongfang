const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync('craco.config.js', 'utf8');

assert.ok(source.includes('GEWU_E2E_SKIP_TYPECHECK'),
  'isolated desktop E2E builds need an explicit opt-in to skip duplicate webpack type checking');
assert.ok(source.includes('ForkTsCheckerWebpackPlugin'),
  'the opt-in must remove only the duplicate fork checker, not weaken ordinary builds');

console.log('CRACO isolated E2E build policy checks passed');
class ModuleScopePlugin { constructor() { this.allowedFiles = new Set(['existing']); this.allowedPaths = []; } }
const scope = new ModuleScopePlugin();
const config = { resolve: { plugins: [scope] }, plugins: [], module: { rules: [] } };
require('./craco.config').webpack.configure(config);
assert.deepStrictEqual([...scope.allowedFiles], ['existing', path.resolve(__dirname, 'shared/questionImportMetadata.js')]);
assert.deepStrictEqual(scope.allowedPaths, [], 'do not allow the whole shared directory or disable module scope');
assert.strictEqual(config.resolve.plugins[0], scope);
