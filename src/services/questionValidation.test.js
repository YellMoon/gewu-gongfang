const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');
const filename = require.resolve('./questionValidation.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = new Module(filename); loaded._compile(compiled, filename);
const { validateImportQuestions } = loaded.exports;

let result = validateImportQuestions([{ content: '', answer: '' }], []);
assert.strictEqual(result.summary.failed, 1);
result = validateImportQuestions([{ content: 'fixed stem', answer: 'A' }], []);
assert.strictEqual(result.summary.failed, 0);
assert.strictEqual(result.rows[0].status === 'success' || result.rows[0].status === 'warning', true);
result = validateImportQuestions([{ content: '', answer: 'A' }], []);
assert.strictEqual(result.summary.failed, 1, 'editing a valid row to an empty stem must block import again');
console.log('question import revalidation behavior tests passed');
