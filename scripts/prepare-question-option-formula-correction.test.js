'use strict';
const assert=require('node:assert/strict');
const {prepareOptionFormulaCorrection}=require('./prepare-question-option-formula-correction');
const {applyFormulaCorrections}=require('./apply-question-formula-corrections');
const {nativeFormulaComponent}=require('../cloud-business-api/src/wordNativeFormula');
const hash='a'.repeat(64),filename='image77.wmf',id='formula-'+ 'b'.repeat(24);
const image={type:'image',attrs:{alt:filename,src:'question-asset://'+hash,assetKey:hash,align:'center',width:null}};
const doc=node=>({type:'doc',content:[{type:'paragraph',content:[node]}]});
const current={id:'question-import-'+'c'.repeat(40),version:2,status:'published',subject:'physics',type:'choice',difficulty:3,
  content:'preserve stem',answer:'C',analysis:'preserve analysis',has_formula:false,
  knowledge_point_ids:['point'],model_point_ids:[],taxonomy_ids:{},source:'preserve source',
  options:[{label:'A',content:`<img src="question-asset://${hash}" alt="${filename}" />`,is_correct:false}],
  rich_content:{type:'question-document',version:1,sections:{stem:doc({type:'text',text:'preserve stem'}),options:[{id:'option-original',label:'A',isCorrect:false,content:doc(image)}],answer:doc({type:'text',text:'C'}),analysis:doc({type:'text',text:'preserve analysis'}),subQuestions:[]}}};
const formula={id,canonical_latex:'v_{1}=v_{2}',display_mode:'inline',conversion_status:'complete',warnings:[],edited:false,
  source:{source_format:'mathtype',payload_hash:'sha256:'+hash,payload_ref:'word/media/'+filename,preview_ref:'word/media/'+filename}};
const replacement={optionIndex:0,formula};
const args={current,baseline:structuredClone(current),replacements:[replacement],validateFormula:nativeFormulaComponent};
const build=overrides=>prepareOptionFormulaCorrection({...args,...overrides});
const command=build();
assert.deepEqual(current,args.baseline);
assert.equal(command.payload.expectedVersion,2);
assert.equal(command.payload.changes.has_formula,true);
assert.equal(command.payload.changes.rich_content.sections.options[0].id,'option-original');
assert.equal(command.payload.changes.rich_content.sections.options[0].content.content[0].content[0].type,'formula');
assert.match(command.payload.changes.options[0].content,/data-latex="v_\{1\}=v_\{2\}"/);
assert.doesNotMatch(command.payload.changes.options[0].content,/<img/);
for(const key of ['content','answer','analysis','knowledge_point_ids','model_point_ids','taxonomy_ids'])assert.deepEqual(command.payload.changes[key],current[key]);
for(const key of ['stem','answer','analysis','subQuestions'])assert.deepEqual(command.payload.changes.rich_content.sections[key],current.rich_content.sections[key]);
assert.deepEqual(build(),command,'reviewed plan has deterministic idempotency');
assert.throws(()=>build({current:{...current,version:3}}),/STATE_CHANGED/);
assert.throws(()=>build({current:{...current,content:'new user edit'}}),/STATE_CHANGED/);
assert.throws(()=>build({replacements:[]}),/REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[replacement,replacement]}),/REPLACEMENTS_INVALID/);
assert.throws(()=>build({replacements:[{...replacement,optionIndex:'__proto__'}]}),/REPLACEMENTS_INVALID/);
assert.throws(()=>build({validateFormula:undefined}),/VALIDATOR_REQUIRED/);
for(const mutate of [
  f=>{f.source.payload_hash='sha256:'+'d'.repeat(64);},
  f=>{f.source.payload_ref='word/media/another.wmf';},
  f=>{f.source.preview_ref='https://example.com/tracker';},
  f=>{f.id='bad" onclick="';},
  f=>{f.conversion_status='incomplete';},
  f=>{f.warnings=['needs review'];},
  f=>{f.canonical_latex=String.raw`\unknownnativecommand{x}`;},
]){const f=structuredClone(formula);mutate(f);assert.throws(()=>build({replacements:[{optionIndex:0,formula:f}]}));}
for(const mutate of [
  q=>{q.options[0].content+='unrelated text';},
  q=>{q.rich_content.sections.options[0].content.content[0].content.push({type:'text',text:'keep me'});},
  q=>{q.rich_content.sections.options[0].label='B';},
  q=>{q.rich_content.sections.options[0].content.content[0].content[0].attrs.assetKey='d'.repeat(64);},
]){const q=structuredClone(current);mutate(q);assert.throws(()=>build({current:q,baseline:structuredClone(q)}),/SOURCE_MISMATCH/);}

(async()=>{
  let row=structuredClone(current),posts=0,saved,drop=false;
  const plan={schema:'source-option-formula-correction-review-v1',entries:[{id:row.id,baseline:structuredClone(row),replacements:[replacement]}]};
  const input={plan,baseUrl:'https://physicsedu.xyz/cloud-business',sessionToken:'secret',deviceId:'device',
    verifyBackup:async()=>({restoreVerified:true,ownershipAndPrivilegesVerified:true,sha256:'a'.repeat(64),root:'/root/scheduling-backups/postgres/20260920-000000'}),
    persistJournal:async journal=>{saved=structuredClone(journal);},
    fetchImpl:async(url,options)=>{
      if(options.method==='POST'){
        const sent=JSON.parse(options.body);posts++;assert.equal(sent.payload.expectedVersion,row.version);
        Object.assign(row,sent.payload.changes,{version:row.version+1});
        if(drop)throw Error('uncertain network');
        return {ok:true,status:200,json:async()=>({ok:true,receipt:{commandId:sent.commandId,payloadHash:sent.payloadHash,status:'committed'}})};
      }
      return {ok:true,status:200,json:async()=>({ok:true,questions:[structuredClone(row)],nextCursor:null})};
    }};
  assert.equal((await applyFormulaCorrections(input)).mode,'dry-run');assert.equal(posts,0);
  await assert.rejects(applyFormulaCorrections({...input,execute:true,verifyBackup:async()=>({restoreVerified:false})}),/BACKUP/);assert.equal(posts,0);
  row.version++;await assert.rejects(applyFormulaCorrections(input),/STATE_CHANGED/);row.version--;
  drop=true;await assert.rejects(applyFormulaCorrections({...input,execute:true}),/TRANSPORT_UNCERTAIN/);assert.equal(posts,1);
  assert.ok(saved);drop=false;
  const resumed=await applyFormulaCorrections({...input,execute:true,journal:saved});
  assert.equal(resumed.verifiedCount,1);assert.equal(posts,1,'readback resume must not submit twice');
  assert.equal(row.source,'preserve source');assert.equal(row.version,3);
  console.log('source-bound option image to native formula preparation, backup, CAS and resume checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
