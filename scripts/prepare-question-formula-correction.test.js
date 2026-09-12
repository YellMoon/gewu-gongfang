'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { stableJson } = require('../shared/authorityProtocol');
const { prepareFormulaCorrection } = require('./prepare-question-formula-correction');
const { nativeFormulaComponent } = require('../cloud-business-api/src/wordNativeFormula');
const oldLatex = String.raw`u^{'}_{1}^{2}`;
const newLatex = String.raw`{u^{'}}_{1}^{2}`;
const current = {
  id: 'question-import-' + 'a'.repeat(40), version: 2, status: 'published',
  subject: 'physics', type: 'calculation', difficulty: 3, content: 'unchanged stem',
  options: [], answer: 'unchanged answer', analysis: 'unchanged analysis',
  knowledge_point_ids: ['existing-point'], model_point_ids: [], taxonomy_ids: {}, has_formula: true,
  rich_content: { sections: { answer: { type: 'doc', content: [{type:'formula',attrs:{id:'source-formula',canonicalLatex:oldLatex,sourceFormat:'omml',displayMode:'inline'}}] } } },
  source: 'existing source', tags: ['existing tag'],
};
const baseline = structuredClone(current);
const replacement = { path: ['sections','answer','content',0,'attrs','canonicalLatex'], before: oldLatex, after: newLatex };
const build = (overrides = {}) => prepareFormulaCorrection({current,baseline,replacements:[replacement],validateFormula:nativeFormulaComponent,...overrides});
const command = build();
assert.deepEqual(current, baseline, 'preparing a repair must never mutate the readback');
assert.equal(command.type, 'question.update.v1');
assert.equal(command.payload.expectedVersion, 2);
assert.equal(command.payload.id, current.id);
assert.equal(command.payload.changes.rich_content.sections.answer.content[0].attrs.canonicalLatex, newLatex);
for (const key of ['content','options','answer','analysis','knowledge_point_ids','model_point_ids','taxonomy_ids','status']) assert.deepEqual(command.payload.changes[key], current[key]);
assert.deepEqual(build(), command, 'same reviewed input must produce the same idempotent command');
assert.equal(command.payloadHash, crypto.createHash('sha256').update(stableJson({type:command.type,payload:command.payload})).digest('hex'));
assert.throws(()=>build({current:{...current,version:3}}), /STATE_CHANGED/);
assert.throws(()=>build({current:{...current,content:'another edit'}}), /STATE_CHANGED/);
assert.throws(()=>build({current:{...current,id:'question-import-'+ 'b'.repeat(40)}}), /STATE_CHANGED/);
assert.throws(()=>build({replacements:[]}), /REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[replacement,replacement]}), /REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[{...replacement,before:'wrong'}]}), /STATE_CHANGED/);
assert.throws(()=>build({replacements:[{...replacement,path:['sections','answer','content',0,'attrs','id']}]}), /REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[{...replacement,path:['__proto__','canonicalLatex']}]}), /REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[{...replacement,after:String.raw`\unknownnativecommand{x}`}]}));
assert.throws(()=>build({validateFormula:undefined}), /VALIDATOR_REQUIRED/);
const legacy = '<p>Keep text <span class="legacy-latex" data-formula-id="source-formula" data-latex="u^{&#x27;}_{1}^{2}" data-source-format="omml"></span></p>';
const withProjection = {...current, analysis:legacy};
const projectionCommand = build({current:withProjection,baseline:structuredClone(withProjection)});
assert.equal(projectionCommand.payload.changes.analysis, legacy.replace('u^{&#x27;}_{1}^{2}', '{u^{&#x27;}}_{1}^{2}'),
  'the legacy HTML formula projection must stay consistent without rewriting its surrounding content');
const unrelated = {...current, analysis:legacy.replace('source-formula','another-formula')};
assert.equal(build({current:unrelated,baseline:structuredClone(unrelated)}).payload.changes.analysis, unrelated.analysis);
console.log('source-reviewed formula correction command checks passed');
