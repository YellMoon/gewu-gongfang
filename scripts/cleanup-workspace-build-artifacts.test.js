'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { assertWorkspaceArtifactRoot, cleanupWorkspaceArtifact } = require('./cleanup-workspace-build-artifacts');

const projectRoot = path.resolve(__dirname, '..');
const cleanupSource = fs.readFileSync(path.join(__dirname, 'cleanup-workspace-build-artifacts.js'), 'utf8');
assert.ok(cleanupSource.includes('lstatSync') && cleanupSource.includes('isSymbolicLink'),
  'workspace cleanup must reject symbolic-link or junction artifact roots');
const root = path.join(projectRoot, `tmp-identity-upgrade-cleanup-test-${process.pid}`);
fs.mkdirSync(root, { recursive: false });
fs.writeFileSync(path.join(root, 'marker.txt'), 'isolated', 'utf8');
assert.strictEqual(assertWorkspaceArtifactRoot(root), root);
assert.throws(
  () => assertWorkspaceArtifactRoot(path.join(projectRoot, 'backend')),
  /WORKSPACE_BUILD_ARTIFACT_ROOT_REQUIRED/,
);
assert.deepStrictEqual(
  cleanupWorkspaceArtifact(root, { listProcesses: () => [] }),
  { root, removed: true },
);
assert.strictEqual(fs.existsSync(root), false);

console.log('workspace build artifact cleanup checks passed');
