'use strict';
// Pure, fail-closed repair of the known import duplication. No network or SQL.
const crypto = require('node:crypto');
const {stableJson} = require('../shared/authorityProtocol');
const {changesForPublishedQuestion} = require('./real-question-import-publish');
const fail = code => {throw Error('SUBQUESTION_CORRECTION_'+code);};
const equal = (a,b) => stableJson(a)===stableJson(b);
function atoms(nodes) {
  return nodes.flatMap(node=>node.type==='text'?[...node.text].map(text=>({...node,text})):[node]);
}
function paragraph(node) {
  if(node?.type!=='paragraph' || !Array.isArray(node.content)) fail('STRUCTURE_INVALID');
  return atoms(node.content);
}
function stripLabel(nodes,label) {
  const copy=structuredClone(nodes), prefix=label+' ';
  for(const char of prefix) {
    if(copy[0]?.type!=='text' || copy[0].text!==char) fail('DUPLICATE_MISMATCH');
    copy.shift();
  }
  return copy;
}
function prepareSubquestionCorrection({current,baseline}={}) {
  if(!current || !baseline || !/^question-import-[a-f0-9]{40}$/.test(current.id||'')
    || !Number.isSafeInteger(current.version) || current.version<1 || current.status!=='published') fail('STATE_CHANGED');
  for(const key of ['id','version','status','content','options','answer','analysis','rich_content'])
    if(!Object.hasOwn(baseline,key) || !equal(current[key],baseline[key])) fail('STATE_CHANGED');
  const rich=structuredClone(current.rich_content), sections=rich?.sections, subs=sections?.subQuestions;
  if(!Array.isArray(subs) || !subs.length || subs.length>100 || sections.stem?.type!=='doc'
    || !Array.isArray(sections.stem.content)) fail('STRUCTURE_INVALID');
  for(const sub of subs) if(typeof sub.label!=='string' || !/^(?:\([0-9]+\)|[\u2460-\u2473])$/.test(sub.label)
    || sub.content?.type!=='doc' || !sub.content.content?.length) fail('STRUCTURE_INVALID');
  const source=sections.stem.content;
  const start=source.findIndex(node=>node.type==='paragraph' && node.content?.[0]?.type==='text' && node.content[0].text.startsWith(subs[0].label+' '));
  if(start<1) fail('STRUCTURE_INVALID');
  const duplicateImages=[], retained=[];
  const subImageParagraphs=subs.flatMap(sub=>sub.content.content).filter(node=>node.type==='paragraph' && node.content?.length===1 && node.content[0].type==='image');
  for(const node of source.slice(0,start)) {
    if(subImageParagraphs.some(image=>equal(node,image))) duplicateImages.push(node);
    else retained.push(node);
  }
  let cursor=start;
  for(const sub of subs) {
    for(let index=0;index<sub.content.content.length;index++) {
      const node=sub.content.content[index];
      const relocated=duplicateImages.findIndex(image=>equal(image,node));
      if(relocated>=0) {duplicateImages.splice(relocated,1);continue;}
      let actual=paragraph(source[cursor]);
      if(index===0) actual=stripLabel(actual,sub.label);
      const expected=paragraph(node);
      if(!equal(actual.slice(0,expected.length),expected)) fail('DUPLICATE_MISMATCH');
      const tail=actual.slice(expected.length);
      if(tail.length) {
        if(sub!==subs.at(-1) || index!==sub.content.content.length-1 || tail.some(n=>n.type!=='formula')) fail('UNREVIEWED_TAIL');
        retained.push({...source[cursor],content:tail});
      }
      cursor++;
    }
  }
  if(duplicateImages.length) fail('DUPLICATE_MISMATCH');
  for(const node of source.slice(cursor)) {
    if(!paragraph(node).length || paragraph(node).some(n=>n.type!=='formula')) fail('UNREVIEWED_TAIL');
    retained.push(node);
  }
  const boundary=current.content.indexOf('\n'+subs[0].label+' ');
  if(boundary<1) fail('CONTENT_BOUNDARY');
  let content=current.content.slice(0,boundary);
  const removedImages=source.slice(0,start).filter(node=>!retained.includes(node));
  for(const node of removedImages) {
    const key=node.content[0].attrs?.assetKey;
    if(!/^[a-f0-9]{64}$/.test(key||'')) fail('CONTENT_BOUNDARY');
    const tags=content.match(/<img\b[^>]*>/g)||[];
    const matches=tags.filter(tag=>tag.includes('src="question-asset://'+key+'"'));
    if(matches.length!==1) fail('CONTENT_BOUNDARY');
    content=content.replace(matches[0],'');
  }
  content=content.trim();
  if(!content) fail('CONTENT_BOUNDARY');
  sections.stem.content=retained;
  const changes=changesForPublishedQuestion({...current,content,rich_content:rich});
  const type='question.update.v1',payload={id:current.id,expectedVersion:current.version,changes};
  const payloadHash=crypto.createHash('sha256').update(stableJson({type,payload})).digest('hex');
  return {commandId:'subquestion-source-correction-'+payloadHash.slice(0,40),payloadHash,type,payload};
}
module.exports=Object.freeze({prepareSubquestionCorrection});
