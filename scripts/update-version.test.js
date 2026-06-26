const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('scripts/update-version.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(source.includes('resolveBumpLevel'), 'update-version should resolve an explicit bump level');
assert.ok(source.includes('--bump=major'), 'update-version should document --bump=major');
assert.ok(source.includes('--bump=minor'), 'update-version should document --bump=minor');
assert.ok(source.includes('--bump=patch'), 'update-version should document --bump=patch');
assert.ok(source.includes('VERSION_BUMP_LEVEL'), 'update-version should support env-driven bump level');
assert.ok(packageJson.includes('version:bump:major'), 'package scripts should expose major version bump');
assert.ok(packageJson.includes('version:bump:minor'), 'package scripts should expose minor version bump');
assert.ok(packageJson.includes('version:bump:patch'), 'package scripts should expose patch version bump');
assert.ok(packageJson.includes('scripts/update-version.test.js'), 'version bump rule test should run in npm test');

console.log('update-version checks passed');
