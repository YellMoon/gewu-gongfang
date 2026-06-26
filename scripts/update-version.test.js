const assert = require('assert');
const fs = require('fs');
const version = require('./update-version');

const source = fs.readFileSync('scripts/update-version.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(source.includes('resolveBumpLevel'), 'update-version should resolve an explicit bump level');
assert.strictEqual(
  version.analyzeVersionBump({ files: ['src/App.tsx'], diff: 'fix: 修复按钮错位' }),
  'patch',
  'bug/style fixes should auto bump patch'
);
assert.strictEqual(
  version.analyzeVersionBump({ files: ['backend/src/routes/permissions.js'], diff: '新增权限接口 router.get' }),
  'minor',
  'new routes/features should auto bump minor'
);
assert.strictEqual(
  version.analyzeVersionBump({ files: ['backend/src/schema.sql'], diff: 'BREAKING CHANGE: 删除旧字段' }),
  'major',
  'breaking changes should auto bump major'
);
assert.strictEqual(
  version.resolveBumpLevel(['--bump'], {}, { files: ['miniapp/src/pages/new-page/index.tsx'], diff: '新增页面' }),
  'minor',
  'plain --bump should auto-detect bump level'
);
assert.ok(source.includes('--bump=major'), 'update-version should document --bump=major');
assert.ok(source.includes('--bump=minor'), 'update-version should document --bump=minor');
assert.ok(source.includes('--bump=patch'), 'update-version should document --bump=patch');
assert.ok(source.includes('VERSION_BUMP_LEVEL'), 'update-version should support env-driven bump level');
assert.ok(packageJson.includes('version:bump:major'), 'package scripts should expose major version bump');
assert.ok(packageJson.includes('version:bump:minor'), 'package scripts should expose minor version bump');
assert.ok(packageJson.includes('version:bump:patch'), 'package scripts should expose patch version bump');
assert.ok(packageJson.includes('scripts/update-version.test.js'), 'version bump rule test should run in npm test');

console.log('update-version checks passed');
