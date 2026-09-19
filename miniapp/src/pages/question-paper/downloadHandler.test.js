'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { downloadPaperDocument } = require('../../utils/questionPaperDownload');

function handler(environment) {
  const file = path.join(__dirname, 'index.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'download' && node.initializer) matches.push(node.initializer.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1);
  const code = ts.transpileModule('return (' + matches[0] + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(environment), code)(...Object.values(environment));
}

(async () => {
  for (const changedAt of [null, 'request', 'download']) {
    const calls = [];
    let same = true;
    const session = { token: 'test-session' };
    const receipt = status => ({ success: true, data: { delivery: { deliveryId: 'delivery-1', status } } });
    const run = handler({
      taskBusyId: '', pageActiveRef: { current: true }, setTaskBusyId: value => calls.push(['busy', value]),
      authSessionRuntime: { capture: () => session, isSameSession: candidate => candidate === session && same },
      downloadPaperDocument: options => downloadPaperDocument({ ...options, wait: async () => {} }),
      miniappCloudBusinessApi: {
        requestPaperExportDelivery: async () => { calls.push(['request']); if (changedAt === 'request') same = false; return receipt('queued'); },
        readPaperExportDelivery: async () => { calls.push(['read']); return receipt('ready'); },
        downloadPaperExportDelivery: async () => { calls.push(['download']); if (changedAt === 'download') same = false; return { success: true, data: { tempFilePath: 'wxfile://paper', statusCode: 200 } }; },
      },
      Taro: { openDocument: async options => calls.push(['open', options]), showToast: options => calls.push(['toast', options]) },
    });
    await run({ localId: 'local-1', taskId: 'task-1', request: { taskType: 'paper-export-pdf' } });
    if (changedAt) {
      assert(!calls.some(call => ['open', 'toast'].includes(call[0])), 'do not display previous-account results');
    } else {
      assert.deepEqual(calls.map(call => call[0]), ['busy', 'request', 'read', 'download', 'open', 'busy']);
      assert.equal(calls.find(call => call[0] === 'open')[1].fileType, 'pdf');
      assert.equal(calls.at(-1)[1], '');
    }
  }
  console.log('actual miniapp download handler prepares, downloads and opens after one click');
})().catch(error => { console.error(error); process.exitCode = 1; });
