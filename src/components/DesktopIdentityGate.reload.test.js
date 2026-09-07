// UTF-8: execute the real bootstrap recovery branch for cold start and renderer reload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const ast = ts.createSourceFile('DesktopIdentityGate.tsx', fs.readFileSync(path.join(__dirname, 'DesktopIdentityGate.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let recovery;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast).includes('vaultStatus.state')
    && node.expression.getText(ast).includes('sealed') && node.thenStatement.getText(ast).includes('await client.resume(')) recovery = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(recovery, 'test must execute the real initialization recovery branch');
const code = ts.transpileModule(`return async () => { ${recovery.getText(ast)} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
(async () => {
  for (const state of ['sealed', 'unlocked']) {
    for (const failure of [false, true]) {
      const events = [];
      const result = { gateState: { kind: 'online-unlocked' } };
      const deps = {
        vaultStatus: { state, unlocked: state === 'unlocked' }, identityBaseUrl: 'https://cloud.test', cancelled: false,
        browserOnline: () => true,
        client: { resume: async input => { events.push(['cloud-recovery', input]); if (failure) throw new Error('DENIED'); return result; } },
        acceptRuntime: value => { assert.equal(value, result); events.push(['accepted']); },
        isDesktopIdentityNetworkFailure: () => false,
        resolveDesktopGateState: () => ({ kind: 'online-authentication-required' }),
        setGateState: value => events.push(['gate', value.kind]), setError: value => events.push(['error', value]),
        messageForError: e => e.message,
      };
      await new Function(...Object.keys(deps), code)(...Object.values(deps))();
      assert.deepEqual(events[0], ['cloud-recovery', { baseUrl: 'https://cloud.test', online: true }],
        `${state} must re-establish a cloud-verified session before accepting business runtime`);
      assert.deepEqual(events.slice(1), failure ? [['gate', 'online-authentication-required'], ['error', 'DENIED']] : [['accepted']]);
    }
  }
  console.log('desktop cold-start and renderer-reload cloud recovery checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
