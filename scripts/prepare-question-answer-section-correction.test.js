'use strict';
// UTF-8: guard the reviewed source-only answer/analysis relocation.
const assert=require('node:assert/strict');
const {prepareAnswerSectionCorrection}=require('./prepare-question-answer-section-correction');
const text=text=>({type:'text',text}),p=(...content)=>({type:'paragraph',content}),d=(...content)=>({type:'doc',content});
const formula={type:'formula',attrs:{id:'f1',canonicalLatex:'W=Q-mgd'}};
const sub={id:'sub-original',label:'(2)',content:d(p(text('Find work'))),answer:d(p(text('solution')))};
const rich={version:1,sections:{stem:d(p(text('Intro'),formula)),options:[],subQuestions:[sub],answer:d(p(text('answer'))),analysis:d(p(text('first step')))}};
const sourceBefore={stem:'Intro',options:[],answer:'answer',analysis:'first step',assets:[],formulas:[{id:'f1'}],sub_questions:[{title:'(2)',content:'Find work',answer:'solution'}],rich_content:rich};
const sourceAfter=structuredClone(sourceBefore);
sourceAfter.rich_content.sections.stem=d(p(text('Intro')));
sourceAfter.rich_content.sections.subQuestions[0].id='sub-new';
sourceAfter.rich_content.sections.subQuestions[0].answer=d(p(formula));
sourceAfter.rich_content.sections.analysis=d(p(text('first step')),p(text('(2) solution')));
sourceAfter.sub_questions[0].answer='formula markup';sourceAfter.analysis='first step\n(2) solution';
const row={id:'question-import-'+'a'.repeat(40),version:3,status:'published',subject:'physics',type:'calculation',difficulty:3,
 content:'Intro',options:[],answer:'answer',analysis:'first step',rich_content:structuredClone(rich),knowledge_point_ids:['keep'],model_point_ids:[],taxonomy_ids:{},has_formula:true};
function build(current=row,before=sourceBefore,after=sourceAfter,baseline=structuredClone(current)){
 return prepareAnswerSectionCorrection({current,baseline,sourceBefore:before,sourceAfter:after});
}
const saved=structuredClone(row),command=build();
assert.deepEqual(row,saved);assert.equal(command.payload.expectedVersion,3);
assert.deepEqual(command.payload.changes.rich_content.sections.stem,d(p(text('Intro'))));
assert.equal(command.payload.changes.rich_content.sections.subQuestions[0].id,'sub-original');
assert.deepEqual(command.payload.changes.knowledge_point_ids,['keep']);
assert.equal(command.payload.changes.analysis,sourceAfter.analysis);assert.deepEqual(build(),command);
let changed=structuredClone(row);changed.version++;assert.throws(()=>build(changed,sourceBefore,sourceAfter,row),/STATE_CHANGED/);
changed=structuredClone(row);changed.analysis='manual edit';assert.throws(()=>build(changed),/SOURCE_MISMATCH/);
changed=structuredClone(sourceAfter);changed.stem='rewritten';assert.throws(()=>build(row,sourceBefore,changed),/SOURCE_SCOPE/);
changed=structuredClone(sourceAfter);changed.rich_content.sections.subQuestions[0].answer=d();assert.throws(()=>build(row,sourceBefore,changed),/FORMULA_INVENTORY/);
changed=structuredClone(sourceAfter);changed.rich_content.sections.stem=d(p(text('changed intro')));assert.throws(()=>build(row,sourceBefore,changed),/STEM_SCOPE/);
changed=structuredClone(sourceAfter);changed.rich_content.sections.subQuestions[0].content=d(p(text('changed question')));assert.throws(()=>build(row,sourceBefore,changed),/SOURCE_SCOPE/);
changed=structuredClone(row);changed.rich_content.sections.stem=d(p(text('Intro')),p(formula));
assert.deepEqual(build(changed).payload.changes.rich_content.sections.stem,d(p(text('Intro'))),'previous repair may isolate fallback formulas in a trailing paragraph');
console.log('answer section correction preserves source content, IDs, formula inventory and optimistic baseline');
