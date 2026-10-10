const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(__dirname + '/QuestionBankPreview.tsx', 'utf8');
const tree = ts.createSourceFile('QuestionBankPreview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'loadData') callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback, 'exercise the actual page loading callback');
const code = ts.transpileModule(`const load = ${callback.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
async function run(refreshError) {
  const state = { seeded: false, ready: false, errors: [], loading: [] };
  const dependencies = {
    window: { dbService: { refreshAuthorityProjection: async () => { if (refreshError) throw refreshError; }, getAllQuestions: () => [{ id: 'draft' }] } },
    setLoading: value => state.loading.push(value), setLoadError: value => state.errors.push(value),
    getCachedQuestionTree: async () => [], setKnowledgeNodes: () => {}, setModelNodes: () => {},
    cacheQuestionTrees: async () => {}, normalizeQuestion: value => value,
    ensureQuestionLocalStoreSeeded: async provider => { assert.equal(provider()[0].id, 'draft'); state.seeded = true; },
    setLocalStoreReady: value => { state.ready = value; }, setRefreshNonce: () => {},
  };
  await new Function(...Object.keys(dependencies), code + '\nreturn load();')(...Object.values(dependencies));
  assert.equal(state.seeded, true, 'an unavailable cloud must not hide cached drafts');
  assert.equal(state.ready, true);
  assert.deepEqual(state.loading, [true, false], 'loading must always settle');
  return state;
}
(async () => {
  const offline = await run(Object.assign(new Error('ONLINE_DESKTOP_SESSION_REQUIRED'), { code: 'ONLINE_DESKTOP_SESSION_REQUIRED' }));
  assert.match(offline.errors.at(-1), /本地/);
  const online = await run();
  assert.equal(online.errors.at(-1), '');
  console.log('question editor offline cached draft loading checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
