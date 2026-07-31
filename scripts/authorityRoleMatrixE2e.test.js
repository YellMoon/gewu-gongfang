const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const matrixPath = path.join(__dirname, 'authority-role-matrix-e2e.js');
const packageText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

assert.ok(fs.existsSync(matrixPath), 'the isolated API/Desktop/Miniapp authority role matrix runner must exist');
const source = fs.readFileSync(matrixPath, 'utf8');
for (const role of ['visitor', 'student', 'teacher', 'admin', 'super_admin']) {
  assert.ok(source.includes(`'${role}'`), `role matrix must include ${role}`);
}
assert.ok(source.includes('/api/authority/projections/current'),
  'role matrix must fetch each signed projection through the formal authority HTTP route');
assert.ok(source.includes('buildAuthorityBackedBrowserCache'),
  'role matrix must materialize every HTTP projection through the real desktop cache facade');
assert.ok(source.includes('projectionCacheEntries'),
  'role matrix must materialize every HTTP projection through the real miniapp cache adapter');
assert.ok(source.includes('deriveAccess') && source.includes('permissionIdentityKey'),
  'role matrix must apply the real miniapp runtime capability gate for every role');
assert.ok(source.includes('ROLE_MATRIX_CROSS_SCOPE_LEAK'),
  'role matrix must fail closed on cross-scope identifiers');
assert.ok(source.includes('gewu-authority-role-matrix-')
  && source.includes('.gewu-isolated-authority-role-matrix')
  && source.includes('removeDisposableRoot'),
'a successful role matrix must remove only its strict temp child with a run-owned marker');
assert.ok(source.includes('isolatedDataRemoved: true') && !source.includes('preserved: true'),
  'the role matrix summary must prove successful isolated-data cleanup instead of preserving it');
assert.ok(packageText.includes('scripts/authority-role-matrix-e2e.js'),
  'the fresh authority architecture suite must execute the real role matrix');

console.log('authority role matrix E2E contract checks passed');
