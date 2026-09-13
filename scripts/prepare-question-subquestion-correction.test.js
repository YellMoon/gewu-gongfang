'use strict';
const assert = require('node:assert/strict');
const { prepareSubquestionCorrection } = require('./prepare-question-subquestion-correction');
const text = value => ({type:'text',text:value});
const para = (...content) => ({type:'paragraph',content});
const doc = (...content) => ({type:'doc',content});
const formula = {type:'formula',attrs:{id:'f',canonicalLatex:'v^2',sourceFormat:'omml'}};
const image = {type:'image',attrs:{assetKey:'a'.repeat(64)}};
const sub = (label,...nodes) => ({label,content:doc(...nodes),answer:doc()});
const current = {id:'question-import-'+'a'.repeat(40),version:3,status:'published',subject:'physics',type:'calculation',difficulty:3,
  content:'Intro\n(1) Find v\n(2) Find t',options:[],answer:'keep answer',analysis:'keep analysis',
  knowledge_point_ids:['keep'],model_point_ids:[],taxonomy_ids:{},has_formula:true,
  rich_content:{version:1,sections:{stem:doc(para(text('Intro')),para(text('(1) Find '),text('v'),formula),para(text('(2) Find t'))),
    subQuestions:[sub('(1)',para(text('Find v'),formula)),sub('(2)',para(text('Find t')))],answer:doc(para(text('answer')))}}};
function build(row=current,baseline=structuredClone(row)) {return prepareSubquestionCorrection({current:row,baseline});}
const saved=structuredClone(current),command=build();
assert.deepEqual(current,saved);
assert.equal(command.payload.expectedVersion,3);
assert.equal(command.payload.changes.content,'Intro');
assert.deepEqual(command.payload.changes.rich_content.sections.stem,doc(para(text('Intro'))));
assert.deepEqual(command.payload.changes.rich_content.sections.subQuestions,current.rich_content.sections.subQuestions);
for(const key of ['options','answer','analysis','knowledge_point_ids']) assert.deepEqual(command.payload.changes[key],current[key]);
assert.deepEqual(build(),command,'deterministic command supports resume');
let changed=structuredClone(current);changed.version++;assert.throws(()=>build(changed,current),/STATE_CHANGED/);
changed=structuredClone(current);changed.rich_content.sections.stem.content[1].content[1].text='x';assert.throws(()=>build(changed),/DUPLICATE_MISMATCH/);
changed=structuredClone(current);changed.rich_content.sections.stem.content.push(para(text('not duplicated')));assert.throws(()=>build(changed),/UNREVIEWED_TAIL/);
changed=structuredClone(current);changed.rich_content.sections.stem.content.at(-1).content.push(formula);
assert.deepEqual(build(changed).payload.changes.rich_content.sections.stem.content.at(-1),para(formula),'unmatched formula must not be discarded or moved to answer');
changed=structuredClone(current);changed.rich_content.sections.stem.content.splice(1,0,para(image));changed.rich_content.sections.subQuestions[0].content.content.push(para(image));
changed.content='Intro\n<img src="question-asset://'+'a'.repeat(64)+'" />\n(1) Find v\n(2) Find t';
assert.equal(build(changed).payload.changes.content,'Intro');
assert.deepEqual(build(changed).payload.changes.rich_content.sections.stem,doc(para(text('Intro'))));
changed=structuredClone(current);changed.content='no matching label';assert.throws(()=>build(changed),/CONTENT_BOUNDARY/);
console.log('subquestion correction preserves subquestions, formulas, media and optimistic version');
