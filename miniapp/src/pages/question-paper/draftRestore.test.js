'use strict';
// UTF-8: Execute the actual TS helpers and compare default sections/scores to desktop.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function extract(file,names){
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 return source.statements.filter(node=>names.includes(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.includes(d.name.text))).map(node=>node.getText(source)).join('\n');
}
function compile(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
const file=path.join(__dirname,'index.tsx');
const display=require('../../utils/questionDisplay'),workflow=require('../../utils/questionPaperWorkflow');
const mini=new Function('questionDisplayRuntime','normalizePaperLayoutField',compile(extract(file,['isPaperScore','sectionFor','scoreFor','questionTypeLabel','defaultItems','restoreItems'])+'\nreturn {defaultItems,restoreItems};'))(display,workflow.normalizePaperLayoutField);
const desktopTypes={exports:{}};new Function('exports',compile(fs.readFileSync(path.join(__dirname,'../../../../src/constants/questionTypes.ts'),'utf8')))(desktopTypes.exports);
const desktop=new Function('normalizeQuestionType',compile(extract(path.join(__dirname,'../../../../src/pages/QuestionBankPaper.tsx'),['DEFAULT_SECTION_BY_TYPE','buildInitialPaperQuestions'])+'\nreturn buildInitialPaperQuestions;'))(desktopTypes.exports.normalizeQuestionType);
const a={id:'a',type:'单选题',subject:'physics',stemPreview:'Current A'},b={id:'b',type:'multiple-choice',subject:'physics',stemPreview:'Current B'},c={id:'c',type:'experiment',subject:'physics',stemPreview:'Current C'};
const saved={items:[{id:'b',sectionTitle:'Custom B',score:8.5},{id:'a',sectionTitle:'Custom A',score:4.5}]};
const restored=mini.restoreItems([a,b],['a','b'],saved);
assert.deepEqual(restored.map(x=>[x.id,x.sectionTitle,x.score]),[['b','Custom B',8.5],['a','Custom A',4.5]],'refresh must retain the deliberate editor order and per-question values');
assert.equal(restored[0].stemPreview,'Current B','question text always comes from the new cloud result');
assert.deepEqual(mini.restoreItems([a,b,c],['a','c'],saved).map(x=>[x.id,x.sectionTitle,x.score]),[['a','Custom A',4.5],['c','四、实验题',6]],'remove stale IDs and append new questions without discarding remaining edits');
assert.deepEqual(mini.restoreItems([a],[],saved),[],'empty handoff must remain empty');
assert.deepEqual(mini.restoreItems([a],['b','a'],saved).map(x=>x.id),['a'],'cloud-unavailable question cannot reappear from a local draft');
const malformed=mini.restoreItems([a,b],['a','b'],{items:[null,{id:'foreign',score:999},{id:'a',sectionTitle:'',score:'12'},{id:'a',sectionTitle:'duplicate',score:999}]});
assert.deepEqual(malformed.map(x=>[x.id,x.score]),[['a',3],['b',6]],'invalid values fall back per question, duplicate/foreign rows cannot leak');
for(const type of ['单选题','多选题','判断题','实验题','解答题','选择题','填空题','简答题','作图题','计算题','问答题','single','single_choice','multi','multiple-choice','experiment','judge','calculation','problem','fill','short','drawing','unknown']){
 const q={id:type,type,stemPreview:'text'},expected=desktop([q])[0],actual=mini.defaultItems([q],[q.id])[0];
 assert.equal(actual.sectionTitle,expected.sectionTitle,`${type}: desktop section parity`);assert.equal(actual.score,expected.score,`${type}: desktop score parity`);
}
console.log('paper draft ID-based restore, reordered/changed membership and actual desktop default parity passed');
