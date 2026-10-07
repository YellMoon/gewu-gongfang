'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), childProcess = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const RECEIPT = '.gewu-build-receipt.json';
function compiledMiniappHash(root = ROOT) {
  const files = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name === RECEIPT) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else files.push([file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]);
    }
  }
  walk('miniapp/dist');
  return crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
function readMiniappBuildProof(root = ROOT) {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'miniapp/dist', RECEIPT), 'utf8'));
  const { miniappUiSourceHash } = require('./verify-miniapp-ui-evidence');
  if (receipt.schema !== 'gewu.miniapp-build.v1' || receipt.sourceHash !== miniappUiSourceHash(root)
    || receipt.compiledHash !== compiledMiniappHash(root)) throw new Error('MINIAPP_BUILD_PROOF_STALE');
  return receipt;
}
function buildMiniapp({ root = ROOT, args = [], run = childProcess.spawnSync } = {}) {
  const { miniappUiSourceHash } = require('./verify-miniapp-ui-evidence');
  const before = miniappUiSourceHash(root);
  const receiptPath = path.join(root, 'miniapp/dist', RECEIPT);
  if (fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath);
  const cli = path.join(root, 'miniapp/node_modules/@tarojs/cli/bin/taro');
  const result = run(process.execPath, [cli, 'build', '--type', 'weapp', ...args], { cwd: path.join(root, 'miniapp'), env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('MINIAPP_BUILD_FAILED');
  if (before !== miniappUiSourceHash(root)) throw new Error('MINIAPP_BUILD_SOURCE_CHANGED');
  const receipt = { schema: 'gewu.miniapp-build.v1', sourceHash: before, compiledHash: compiledMiniappHash(root), builtAt: new Date().toISOString() };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
if (require.main === module) { try { buildMiniapp({ args: process.argv.slice(2) }); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { buildMiniapp, compiledMiniappHash, readMiniappBuildProof };
