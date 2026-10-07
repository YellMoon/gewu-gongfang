'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'miniapp/node_modules/typescript'));
const workflow = require(path.join(root, 'miniapp/src/utils/questionPaperWorkflow'));
const source = fs.readFileSync(path.join(root, 'miniapp/src/pages/question-paper/index.tsx'), 'utf8');
const start = source.indexOf('  const submit = async');
const end = source.indexOf('  const refreshTasks', start);
if (start < 0 || end < 0) throw new Error('Submission handler not found');
const calls = [];
let initialRequest;
const cloudTasks = new Map();
const taskState = { scopeKey: 'scope-A', tasks: [] };
const context = {
  canBuildPaper: true, taskState, items: [{ id: 'q-1', sectionTitle: 'Section', score: 5 }],
  title: 'Audit paper', answerPosition: 'after', formulaMode: 'mathtype-compatible',
  questions: [{ id: 'q-1', subject: 'physics' }],
  editedLayoutItems: () => [{ id: 'q-1', sectionTitle: 'Section', score: 5 }],
  validateAndNormalizePaperLayout: workflow.validateAndNormalizePaperLayout, workflow,
  Taro: { showToast() {} }, setLayoutErrors() {}, layoutFieldKey() {}, setItems() {}, setLayoutEdits() {}, setSubmitting() {},
  authSessionRuntime: { capture: () => ({ token: 'fixture-token-A' }) },
  persistTask(tasks) { taskState.tasks = tasks; },
  miniappCloudBusinessApi: {
    async createPaperExportTask(token, type, request, key) {
      calls.push(key);
      if (calls.length === 2) require('assert').deepStrictEqual(JSON.stringify(request), initialRequest);
      else initialRequest = JSON.stringify(request);
      cloudTasks.set(key, { taskId: 'task-' + key, status: 'queued' });
      // Emulate a committed cloud task whose response was lost.
      if (calls.length === 1) return { success: false, error: 'timeout' };
      return { success: true, data: { task: cloudTasks.get(key) } };
    },
  },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(source.slice(start, end) + '\nglobalThis.auditSubmit = submit;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, context);
(async () => {
  await context.auditSubmit('paper-export-word');
  const retry = taskState.tasks[0];
  context.questions[0].subject = 'math'; context.formulaMode = 'latex-vector';
  await context.auditSubmit('paper-export-word', retry);
  const result = {
    handler: 'miniapp/src/pages/question-paper/index.tsx:399',
    initialIdempotencyKey: calls[0], retryIdempotencyKey: calls[1], keysReused: calls[0] === calls[1],
    cloudTasks: cloudTasks.size, localConfirmedTasks: taskState.tasks.filter(task => task.confirmed).length,
    externalRequests: 0, productionWrites: 0,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.keysReused || result.cloudTasks !== 1 || result.localConfirmedTasks !== 1) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
