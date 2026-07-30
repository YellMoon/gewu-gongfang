'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertRendererBuildReady } = require('./wait-for-renderer-build');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-renderer-build-test-'));
try {
  assert.throws(
    () => assertRendererBuildReady(tempRoot),
    /Renderer build is incomplete/,
    'a missing renderer entry must block packaging',
  );

  fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html>', 'utf8');
  assert.throws(
    () => assertRendererBuildReady(tempRoot),
    /asset-manifest\.json/,
    'an incomplete renderer build must not pass just because index.html appeared first',
  );

  fs.writeFileSync(path.join(tempRoot, 'asset-manifest.json'), '{}', 'utf8');
  assert.strictEqual(assertRendererBuildReady(tempRoot), true);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('renderer build readiness checks passed');
