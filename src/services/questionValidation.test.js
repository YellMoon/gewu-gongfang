const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');
function loadInspection() { const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(require.resolve('./questionInspection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='../utils/questionOptions'?require('../utils/questionOptions.ts'):require(name),m,m.exports);return m.exports; }

const filename = require.resolve('./questionValidation.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = new Module(filename);
loaded.require = name => name === './questionInspection' ? loadInspection() : require(name);
loaded._compile(compiled, filename);
const { validateImportQuestions } = loaded.exports;

let result = validateImportQuestions([{ content: '', answer: '' }], []);
assert.strictEqual(result.summary.failed, 1);
result = validateImportQuestions([{ content: 'fixed stem', answer: 'A' }], []);
assert.strictEqual(result.summary.failed, 0);
assert.strictEqual(result.rows[0].status === 'success' || result.rows[0].status === 'warning', true);
result = validateImportQuestions([{ content: '', answer: 'A' }], []);
assert.strictEqual(result.summary.failed, 1, 'editing a valid row to an empty stem must block import again');
console.log('question import revalidation behavior tests passed');
const rich = text => ({type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:[]}]});
const wholeAnswer = {rich_content:{type:'question-document',sections:{stem:rich('Experiment'),options:[],subQuestions:[{content:rich('Part one'),answer:rich('')}],answer:rich('(1) Whole answer'),analysis:rich('Explanation')}},knowledge_point:'Experiment'};
result=validateImportQuestions([wholeAnswer]);
assert.equal(result.summary.success,1, 'a whole-question answer satisfies import validation without separate sub-answers');
wholeAnswer.rich_content.sections.answer=rich('');
result=validateImportQuestions([wholeAnswer]);assert(result.rows[0].issues.some(issue=>issue.message==='\u7b54\u6848\u4e3a\u7a7a'));
