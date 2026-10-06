'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/services/questionRichContent.ts');
const targetPath = path.join(root, 'shared/questionRichContentContract.js');
function compiledContract() {
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace(/\r\n/g, '\n');
  return '// Generated from src/services/questionRichContent.ts; edit the canonical source and regenerate.\n'
    + '// Source SHA256: ' + digest + '\n' + compiled;
}
function generate({ check = false } = {}) {
  const expected = compiledContract();
  if (check) {
    if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n') !== expected) {
      throw new Error('QUESTION_RICH_CONTENT_CONTRACT_STALE: run node scripts/generate-question-rich-content-contract.js');
    }
  } else fs.writeFileSync(targetPath, expected, 'utf8');
}
module.exports = { generate, compiledContract };
if (require.main === module) {
  try { generate({ check: process.argv.includes('--check') }); console.log('canonical question rich-content contract ' + (process.argv.includes('--check') ? 'verified' : 'generated')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
