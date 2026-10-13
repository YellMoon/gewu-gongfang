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
    for (const scenario of ['online', 'rejected', 'outage', 'offline']) {
      const events = [];
      const result = { gateState: { kind: 'online-unlocked' } };
      const deps = {
        vaultStatus: { state, unlocked: state === 'unlocked' }, identityBaseUrl: 'https://cloud.test', cancelled: false,
        browserOnline: () => scenario !== 'offline',
        client: { resume: async input => { events.push(['cloud-recovery', input]); if (scenario !== 'online') throw new Error('DENIED'); return result; }, lock: async () => events.push(['locked']) },
        acceptRuntime: value => { assert.equal(value, result); events.push(['accepted']); },
        isDesktopIdentityNetworkFailure: () => scenario === 'outage',
        resolveDesktopGateState: () => ({ kind: 'online-authentication-required' }),
        setGateState: value => events.push(['gate', value.kind]), setError: value => events.push(['error', value]),
        messageForError: e => e.message,
      };
      await new Function(...Object.keys(deps), code)(...Object.values(deps))();
      if (scenario === 'offline') {
        assert.deepEqual(events, [['locked'], ['gate', 'offline-authentication-required']], 'offline startup must require the normal password form');
      } else {
        assert.deepEqual(events[0], ['cloud-recovery', { baseUrl: 'https://cloud.test', online: true }]);
        assert.deepEqual(events.slice(1), scenario === 'online' ? [['accepted']]
          : scenario === 'outage' ? [['locked'], ['gate', 'offline-authentication-required']]
            : [['gate', 'online-authentication-required'], ['error', 'DENIED']]);
      }
    }
  }
  console.log('desktop cold-start and renderer-reload cloud recovery checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
