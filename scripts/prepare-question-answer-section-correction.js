'use strict';
// UTF-8: pure source-reviewed repair; no SQL, network, or automatic submission.
const crypto=require('node:crypto');
const {stableJson}=require('../shared/authorityProtocol');
const {changesForPublishedQuestion}=require('./real-question-import-publish');
const fail=code=>{throw Error('ANSWER_SECTION_CORRECTION_'+code);};
const equal=(a,b)=>stableJson(a)===stableJson(b);
function normalize(value) {
  if(Array.isArray(value))return value.map(normalize);
  if(!value || typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>!(key==='id' && /^(sub|option)-/.test(item||''))).map(([key,item])=>[key,normalize(item)]));
}
function normalizeRich(rich) {
  const result=normalize(structuredClone(rich));
  const nodes=result?.sections?.stem?.content;
  // The preceding source repair only separated a fallback-formula tail.
  if(Array.isArray(nodes) && nodes.length>1 && nodes.at(-1)?.type==='paragraph'
    && nodes.at(-1).content?.length && nodes.at(-1).content.every(n=>n.type==='formula')
    && nodes.at(-2)?.type==='paragraph') {
    const tail=nodes.pop();nodes.at(-1).content.push(...tail.content);
  }
  return result;
}
function walk(value,callback) {
  if(!value || typeof value!=='object')return;
  if(value.type)callback(value);
  for(const child of Object.values(value))if(child && typeof child==='object')walk(child,callback);
}
function inventory(value,type) {
  const items=[];
  walk(value,node=>{
    if(node.type!==type)return;
    if(type==='formula') {
      if(!node.attrs?.id || typeof node.attrs.canonicalLatex!=='string')fail('FORMULA_INVENTORY');
      items.push([node.attrs.id,node.attrs.canonicalLatex]);
    } else items.push(node);
  });
  return items.map(stableJson).sort();
}
function prepareAnswerSectionCorrection({current,baseline,sourceBefore,sourceAfter}={}) {
  if(!current || !baseline || !/^question-import-[a-f0-9]{40}$/.test(current.id||'')
    || !Number.isSafeInteger(current.version) || current.version<1 || current.status!=='published')fail('STATE_CHANGED');
  for(const key of ['id','version','status','content','options','answer','analysis','rich_content'])
    if(!Object.hasOwn(baseline,key) || !equal(current[key],baseline[key]))fail('STATE_CHANGED');
  if(!sourceBefore || !sourceAfter)fail('SOURCE_MISMATCH');
  for(const [key,sourceKey] of [['content','stem'],['options','options'],['answer','answer'],['analysis','analysis']])
    if(!equal(current[key],sourceBefore[sourceKey]))fail('SOURCE_MISMATCH');
  if(!equal(normalizeRich(current.rich_content),normalizeRich(sourceBefore.rich_content)))fail('SOURCE_MISMATCH');
  for(const key of ['stem','options','assets','formulas'])
    if(!equal(sourceBefore[key],sourceAfter[key]))fail('SOURCE_SCOPE');
  const before=sourceBefore.rich_content?.sections,after=sourceAfter.rich_content?.sections;
  if(!before || !after || !Array.isArray(before.subQuestions) || !before.subQuestions.length
    || !Array.isArray(after.subQuestions) || before.subQuestions.length!==after.subQuestions.length)fail('SOURCE_SCOPE');
  if(!equal(Object.keys(before).sort(),Object.keys(after).sort()))fail('SOURCE_SCOPE');
  for(const key of Object.keys(before))
    if(!['stem','answer','analysis','subQuestions'].includes(key) && !equal(normalize(before[key]),normalize(after[key])))fail('SOURCE_SCOPE');
  before.subQuestions.forEach((sub,index)=>{
    const {answer:_a,...rest}=sub,{answer:_b,...next}=after.subQuestions[index];
    if(!equal(normalize(rest),normalize(next)))fail('SOURCE_SCOPE');
  });
  if(!equal(inventory(before,'formula'),inventory(after,'formula')))fail('FORMULA_INVENTORY');
  if(!equal(inventory(before,'image'),inventory(after,'image')))fail('IMAGE_INVENTORY');
  const moved=new Set();
  const afterOutsideStem={...after};delete afterOutsideStem.stem;
  walk(afterOutsideStem,node=>{if(node.type==='formula')moved.add(node.attrs.id);});
  const stem=structuredClone(current.rich_content.sections.stem);
  if(stem?.type!=='doc' || !Array.isArray(stem.content))fail('STEM_SCOPE');
  stem.content=stem.content.map(node=>{
    if(node.type!=='paragraph' || !Array.isArray(node.content))fail('STEM_SCOPE');
    return {...node,content:node.content.filter(n=>!(n.type==='formula' && moved.has(n.attrs?.id)))};
  }).filter(node=>node.content.length);
  if(!equal(stem,after.stem))fail('STEM_SCOPE');
  const rich=structuredClone(current.rich_content);
  rich.sections.stem=stem;
  rich.sections.answer=structuredClone(after.answer);
  rich.sections.analysis=structuredClone(after.analysis);
  rich.sections.subQuestions.forEach((sub,index)=>{sub.answer=structuredClone(after.subQuestions[index].answer);});
  if(equal(rich,current.rich_content) && sourceAfter.answer===current.answer && sourceAfter.analysis===current.analysis)fail('NO_CHANGE');
  const changes=changesForPublishedQuestion({...current,answer:sourceAfter.answer,analysis:sourceAfter.analysis,rich_content:rich});
  const type='question.update.v1',payload={id:current.id,expectedVersion:current.version,changes};
  const payloadHash=crypto.createHash('sha256').update(stableJson({type,payload})).digest('hex');
  return {commandId:'answer-section-source-correction-'+payloadHash.slice(0,40),payloadHash,type,payload};
}
module.exports=Object.freeze({prepareAnswerSectionCorrection});
