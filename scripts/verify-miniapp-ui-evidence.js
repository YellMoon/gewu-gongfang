'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function miniappUiSourceHash(root = ROOT) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else files.push([relative, digest(fs.readFileSync(path.join(root, relative)))]);
    }
  }
  walk('miniapp/src');
  walk('miniapp/config');
  // Both the calendar and finance pages compile modules outside miniapp/src.
  walk('shared');
  for (const file of ['miniapp/package.json', 'scripts/capture-miniapp-ui-matrix.js', 'scripts/build-miniapp-with-proof.js', 'miniapp/project.config.json']) files.push([file, digest(fs.readFileSync(path.join(root, file)))]);
  return digest(JSON.stringify(files));
}
function verifyMiniappUiEvidence(matrixPath, root = ROOT) {
  const report = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const { runtimeScenarios, REQUIRED_COVERAGE_CATEGORIES } = require(path.join(root, 'miniapp/src/utils/miniappUiRuntimeScenarios'));
  const { pageInventory } = require(path.join(root, 'miniapp/src/utils/miniappUiPageInventory'));
  const fail = reason => { throw new Error(`MINIAPP_UI_EVIDENCE_INVALID: ${reason}`); };
  if (report.sourceHash !== miniappUiSourceHash(root) || report.version !== require(path.join(root, 'miniapp/package.json')).version) fail('stale source/version');
  if (report.buildReceipt?.schema !== 'gewu.miniapp-build.v1' || report.buildReceipt.sourceHash !== report.sourceHash
    || !/^[0-9a-f]{64}$/.test(report.buildReceipt.compiledHash || '')) fail('compiled build proof');
  if (!report.completed || report.focusedRun || report.fatalExceptions?.length || !Array.isArray(report.pages)) fail('incomplete runtime capture');
  const ids = report.pages.map(item => item.scenarioId);
  if (ids.length !== runtimeScenarios.length || new Set(ids).size !== ids.length || report.registeredPageCount !== pageInventory.length) fail('coverage count');
  const directory = path.resolve(path.dirname(matrixPath));
  for (const scenario of runtimeScenarios) {
    const item = report.pages.find(row => row.scenarioId === scenario.id);
    if (!item || item.route !== scenario.route || item.role !== scenario.roleView || item.state !== scenario.state
      || item.expectedText !== scenario.expectedText || item.identity !== scenario.identity
      || !item.routeMatched || !item.textMatched || !String(item.textSample).includes(scenario.expectedText)) fail(`runtime mismatch ${scenario.id}`);
    const screenshot = path.resolve(directory, item.screenshot || '');
    if (!screenshot.startsWith(directory + path.sep) || !screenshot.endsWith('.png')) fail('screenshot path');
    const bytes = fs.readFileSync(screenshot);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || bytes.length !== item.bytes || digest(bytes) !== item.sha256 || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1) fail(`screenshot mismatch ${scenario.id}`);
  }
  for (const category of REQUIRED_COVERAGE_CATEGORIES) if (!report.requiredStatesCovered?.includes(category)) fail(`missing ${category}`);
  return { version: report.version, pages: pageInventory.length, scenarios: ids.length, sourceHash: report.sourceHash };
}
if (require.main === module) {
  try {
    const matrixPath = process.argv[2];
    if (!matrixPath) throw new Error('MINIAPP_UI_EVIDENCE_PATH_REQUIRED');
    console.log(JSON.stringify(verifyMiniappUiEvidence(path.resolve(matrixPath)), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { miniappUiSourceHash, verifyMiniappUiEvidence };
