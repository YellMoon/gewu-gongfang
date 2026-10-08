'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { buildMiniapp, readMiniappBuildProof } = require('./build-miniapp-with-proof');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-build-proof-'));
try {
  for (const folder of ['miniapp/src','miniapp/config','scripts','miniapp/dist','shared']) fs.mkdirSync(path.join(directory, folder), { recursive: true });
  for (const file of ['miniapp/src/index.tsx','miniapp/config/index.ts','miniapp/package.json','miniapp/project.config.json','scripts/capture-miniapp-ui-matrix.js','scripts/build-miniapp-with-proof.js']) fs.writeFileSync(path.join(directory, file), 'fixture source');
  const run = () => { fs.writeFileSync(path.join(directory, 'miniapp/dist/app.js'), 'fixture compiled output'); return { status: 0 }; };
  fs.writeFileSync(path.join(directory, 'shared/courseColors.js'), 'fixture shared palette');
  buildMiniapp({ root: directory, run }); assert.equal(readMiniappBuildProof(directory).schema, 'gewu.miniapp-build.v1');
  fs.appendFileSync(path.join(directory, 'shared/courseColors.js'), 'changed palette');
  assert.throws(() => readMiniappBuildProof(directory), /STALE/, 'shared calendar code changes must invalidate the compiled miniapp');
  buildMiniapp({ root: directory, run });
  fs.appendFileSync(path.join(directory, 'miniapp/src/index.tsx'), 'modified');
  assert.throws(() => readMiniappBuildProof(directory), /STALE/, 'stale dist cannot gain new source provenance');
  buildMiniapp({ root: directory, run });
  fs.appendFileSync(path.join(directory, 'miniapp/dist/app.js'), 'tampered');
  assert.throws(() => readMiniappBuildProof(directory), /STALE/);
  assert.throws(() => buildMiniapp({ root: directory, run: () => { run(); fs.appendFileSync(path.join(directory, 'miniapp/config/index.ts'), 'changed during build'); return { status: 0 }; } }), /SOURCE_CHANGED/);
  assert.throws(() => readMiniappBuildProof(directory), /ENOENT/, 'failed builds leave no valid proof');
  console.log('miniapp build source/output provenance and mid-build edits passed (synthetic compiler fixture)');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
