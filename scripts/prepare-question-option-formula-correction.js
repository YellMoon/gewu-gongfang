'use strict';
// Pure source-reviewed correction: only an entire image-only option may become a
// native formula recovered from that exact image payload. No SQL or submission.
const crypto=require('node:crypto');
const {stableJson}=require('../shared/authorityProtocol');
const {changesForPublishedQuestion}=require('./real-question-import-publish');
const fail=code=>{throw Error('OPTION_FORMULA_CORRECTION_'+code);};
const equal=(a,b)=>stableJson(a)===stableJson(b);
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
function prepareOptionFormulaCorrection({current,baseline,replacements,validateFormula}={}){
  if(typeof validateFormula!=='function')fail('VALIDATOR_REQUIRED');
  if(!current || !baseline || !/^question-import-[a-f0-9]{40}$/.test(current.id||'')
    || !Number.isSafeInteger(current.version) || current.version<1 || current.status!=='published')fail('STATE_CHANGED');
  for(const key of ['id','version','status','content','options','answer','analysis','rich_content'])
    if(!Object.hasOwn(baseline,key) || !equal(current[key],baseline[key]))fail('STATE_CHANGED');
  if(!Array.isArray(replacements) || !replacements.length || replacements.length>20)fail('REPLACEMENTS_INVALID');
  const rich=structuredClone(current.rich_content),options=structuredClone(current.options),seen=new Set(),formulaIds=new Set();
  if(!Array.isArray(options) || !Array.isArray(rich?.sections?.options) || options.length!==rich.sections.options.length)fail('SOURCE_MISMATCH');
  // A source formula ID must not collide with an existing node anywhere else.
  function collect(value){if(!value || typeof value!=='object')return;if(value.type==='formula')formulaIds.add(value.attrs?.id);for(const child of Object.values(value))if(child && typeof child==='object')collect(child);}
  collect(rich);
  for(const replacement of replacements){
    const index=replacement?.optionIndex,formula=replacement?.formula;
    if(!Number.isSafeInteger(index) || index<0 || index>=options.length || seen.has(index))fail('REPLACEMENTS_INVALID');
    seen.add(index);
    const option=options[index],section=rich.sections.options[index],content=section?.content;
    const node=content?.content?.[0]?.content?.[0],image=node?.attrs;
    if(!option || section?.label!==option.label || content?.type!=='doc' || content.content.length!==1
      || content.content[0]?.type!=='paragraph' || content.content[0].content?.length!==1 || node?.type!=='image'
      || !/^[a-f0-9]{64}$/.test(image?.assetKey||'') || image.src!=='question-asset://'+image.assetKey
      || !/^[A-Za-z0-9_.-]+\.wmf$/i.test(image.alt||'')
      || option.content!==`<img src="${image.src}" alt="${image.alt}" />`)fail('SOURCE_MISMATCH');
    const source=formula?.source,ref='word/media/'+image.alt;
    if(!/^formula-[a-f0-9]{24}$/.test(formula?.id||'') || formulaIds.has(formula.id)
      || formula.conversion_status!=='complete' || formula.display_mode!=='inline' || formula.edited!==false
      || !Array.isArray(formula.warnings) || formula.warnings.length
      || typeof formula.canonical_latex!=='string' || !formula.canonical_latex.trim() || formula.canonical_latex.length>8192
      || source?.source_format!=='mathtype' || source.payload_hash!=='sha256:'+image.assetKey
      || source.payload_ref!==ref || source.preview_ref!==ref)fail('SOURCE_MISMATCH');
    validateFormula(formula.canonical_latex);
    formulaIds.add(formula.id);
    const attrs={id:formula.id,canonicalLatex:formula.canonical_latex,displayMode:'inline',sourceRef:null,
      conversionStatus:'complete',sourceFormat:'mathtype',previewRef:ref};
    content.content[0].content[0]={type:'formula',attrs};
    option.content=`<span class="legacy-latex" data-formula-id="${attrs.id}" data-latex="${escape(attrs.canonicalLatex)}" data-conversion-status="complete" data-source-format="mathtype" data-preview-ref="${escape(ref)}"></span>`;
  }
  const changes=changesForPublishedQuestion({...current,options,rich_content:rich,has_formula:true});
  const type='question.update.v1',payload={id:current.id,expectedVersion:current.version,changes};
  const payloadHash=crypto.createHash('sha256').update(stableJson({type,payload})).digest('hex');
  return {commandId:'option-formula-source-correction-'+payloadHash.slice(0,40),payloadHash,type,payload};
}
module.exports=Object.freeze({prepareOptionFormulaCorrection});
