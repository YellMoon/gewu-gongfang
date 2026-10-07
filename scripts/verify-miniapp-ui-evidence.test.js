'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { miniappUiSourceHash, verifyMiniappUiEvidence } = require('./verify-miniapp-ui-evidence');
const { runtimeScenarios, REQUIRED_COVERAGE_CATEGORIES } = require('../miniapp/src/utils/miniappUiRuntimeScenarios');
const { pageInventory } = require('../miniapp/src/utils/miniappUiPageInventory');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-ui-proof-'));
try {
  // Synthetic PNG validates receipt integrity only; it is never real visual acceptance evidence.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6JAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(directory, 'fixture.png'), png);
  const report = { version: require('../miniapp/package.json').version, sourceHash: miniappUiSourceHash(), completed: true, focusedRun: false,
    registeredPageCount: pageInventory.length, fatalExceptions: [], requiredStatesCovered: REQUIRED_COVERAGE_CATEGORIES,
    pages: runtimeScenarios.map(item => ({ scenarioId: item.id, route: item.route, identity: item.identity, role: item.roleView, state: item.state,
      expectedText: item.expectedText, textSample: item.expectedText, routeMatched: true, textMatched: true, screenshot: 'fixture.png',
      bytes: png.length, sha256: crypto.createHash('sha256').update(png).digest('hex') })) };
  report.buildReceipt = { schema: 'gewu.miniapp-build.v1', sourceHash: report.sourceHash, compiledHash: 'a'.repeat(64) };
  const matrix = path.join(directory, 'matrix.json');
  const write = value => fs.writeFileSync(matrix, JSON.stringify(value));
  write({ ...report, sourceHash: '0'.repeat(64) }); assert.throws(() => verifyMiniappUiEvidence(matrix), /stale source/);
  write({ ...report, pages: report.pages.slice(1) }); assert.throws(() => verifyMiniappUiEvidence(matrix), /coverage count/);
  write({ ...report, focusedRun: true }); assert.throws(() => verifyMiniappUiEvidence(matrix), /incomplete/);
  write({ ...report, buildReceipt: null }); assert.throws(() => verifyMiniappUiEvidence(matrix), /compiled build proof/);
  write(report); assert.equal(verifyMiniappUiEvidence(matrix).scenarios, runtimeScenarios.length);
  report.pages[0].role = 'wrong'; write(report); assert.throws(() => verifyMiniappUiEvidence(matrix), /runtime mismatch/);
  report.pages[0].role = runtimeScenarios[0].roleView; report.pages[0].sha256 = '0'.repeat(64); write(report);
  assert.throws(() => verifyMiniappUiEvidence(matrix), /screenshot mismatch/);
  report.pages[0].screenshot = '../escape.png'; write(report); assert.throws(() => verifyMiniappUiEvidence(matrix), /screenshot path/);
  console.log('UI evidence source/version, complete scenarios, role binding, screenshot checksum and path boundary passed (synthetic proof tests only)');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
