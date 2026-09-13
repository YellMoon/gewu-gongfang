'use strict';
const assert = require('node:assert/strict');
const { applyFormulaCorrections } = require('./apply-question-formula-corrections');
const oldLatex = String.raw`u^{'}_{1}^{2}`, after = String.raw`{u^{\prime}}_{1}^{2}`;
const source = n => ({ id:'question-import-'+String(n).repeat(40), version:2, status:'published', subject:'physics',type:'calculation',difficulty:3,
  content:'stem',options:[],answer:'answer',analysis:'analysis',knowledge_point_ids:[],model_point_ids:[],taxonomy_ids:{},has_formula:true,
  rich_content:{sections:{stem:{type:'doc',content:[{type:'formula',attrs:{id:'f',canonicalLatex:oldLatex}}]}}},source:'preserve metadata'});
const originals = [source(1),source(2)];
const plan = {schema:'source-formula-correction-review-v1',entries: originals.map(baseline=>({id:baseline.id,baseline,
  replacements:[{path:['sections','stem','content',0,'attrs','canonicalLatex'],before:oldLatex,after}]}))};
function fixture() {
  const state={rows:structuredClone(originals),posts:[],events:[],journal:null,dropResponse:false,reject:false,mutateReadback:false};
  const fetchImpl=async(url,options={})=>{
    assert.equal(options.headers.Authorization,'Bearer secret'); assert.equal(options.headers['x-device-id'],'device');
    assert.equal(options.redirect,'error');
    if(options.method==='POST') {
      assert.ok(state.journal,'durable journal must exist before any submission');
      const command=JSON.parse(options.body);state.posts.push(command);state.events.push('post');
      if(!state.reject) {
        const row=state.rows.find(r=>r.id===command.payload.id);
        assert.equal(row.version,command.payload.expectedVersion);
        Object.assign(row,command.payload.changes,{version:row.version+1});
        if(state.mutateReadback) row.analysis='unexpected';
      }
      if(state.dropResponse) throw new Error('network failure with Bearer secret');
      return {ok:true,status:200,json:async()=>({ok:true,receipt:{commandId:command.commandId,payloadHash:command.payloadHash,status:state.reject?'rejected':'committed'}})};
    }
    state.events.push('read');
    const paged=new URL(url).searchParams.has('afterId');
    return {ok:true,status:200,json:async()=>({ok:true,questions:structuredClone([state.rows[paged?1:0]]),nextCursor:paged?null:state.rows[0].id})};
  };
  const args={plan,baseUrl:'https://physicsedu.xyz/cloud-business',sessionToken:'secret',deviceId:'device',fetchImpl,
    verifyBackup:async()=>{state.events.push('backup');return {restoreVerified:true,ownershipAndPrivilegesVerified:true,sha256:'a'.repeat(64),root:'/root/scheduling-backups/postgres/20260913-000000'};},
    persistJournal:async journal=>{state.events.push('persist');state.journal=structuredClone(journal);}};
  return {state,args};
}
(async()=>{
  let f=fixture();const dry=await applyFormulaCorrections(f.args);assert.equal(dry.mode,'dry-run');assert.equal(f.state.posts.length,0);assert.equal(f.state.journal,null);assert.ok(!f.state.events.includes('backup'));
  f=fixture();const done=await applyFormulaCorrections({...f.args,execute:true});assert.equal(done.verifiedCount,2);assert.equal(f.state.posts.length,2);assert.ok(f.state.events.indexOf('backup')<f.state.events.indexOf('persist'));assert.ok(!JSON.stringify(f.state.journal).includes('secret'));assert.equal(f.state.rows[0].source,'preserve metadata');
  f=fixture();f.state.rows[1].version=3;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/STATE_CHANGED/);assert.equal(f.state.posts.length,0,'preflight every target before any write');
  f=fixture();await assert.rejects(applyFormulaCorrections({...f.args,execute:true,verifyBackup:async()=>({restoreVerified:false})}),/BACKUP/);assert.equal(f.state.posts.length,0);
  f=fixture();await assert.rejects(applyFormulaCorrections({...f.args,execute:true,persistJournal:async()=>{throw Error('disk');}}),/JOURNAL/);assert.equal(f.state.posts.length,0);
  f=fixture();f.state.dropResponse=true;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/^Error: FORMULA_CORRECTION_TRANSPORT_UNCERTAIN$/);assert.equal(f.state.posts.length,1);
  const journal=f.state.journal;f.state.dropResponse=false;const resumed=await applyFormulaCorrections({...f.args,execute:true,journal});assert.equal(resumed.verifiedCount,2);assert.equal(f.state.posts.length,2,'already-applied first question must not be submitted again');
  f=fixture();f.state.reject=true;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/RECEIPT/);assert.equal(f.state.posts.length,1);
  f=fixture();f.state.mutateReadback=true;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/READBACK/);assert.equal(f.state.posts.length,1);
  f=fixture();await applyFormulaCorrections({...f.args,execute:true});const changed=structuredClone(f.state.journal);changed.entries[0].command.payload.changes.content='smuggled';await assert.rejects(applyFormulaCorrections({...f.args,execute:true,journal:changed}),/JOURNAL/);
  f=fixture();await assert.rejects(applyFormulaCorrections({...f.args,baseUrl:'https://another.example'}),/INPUT/);assert.equal(f.state.events.length,0);
  f=fixture();const duplicate={...plan,entries:[plan.entries[0],plan.entries[0]]};await assert.rejects(applyFormulaCorrections({...f.args,plan:duplicate,execute:true}),/INPUT/);assert.equal(f.state.posts.length,0);
  f=fixture();f.state.rows[0].content='new edit';const injected=structuredClone(plan);injected.entries[0].current=originals[0];await assert.rejects(applyFormulaCorrections({...f.args,plan:injected,execute:true}),/STATE_CHANGED/);assert.equal(f.state.posts.length,0);
  f=fixture();f.state.rows[0].source='new source metadata';await applyFormulaCorrections({...f.args,execute:true});assert.equal(f.state.rows[0].source,'new source metadata','fresh unrelated metadata must be preserved');
  function subquestionFixture() {
    const f=fixture(),p=text=>({type:'paragraph',content:[{type:'text',text}]}),d=(...content)=>({type:'doc',content});
    f.state.rows.forEach(row=>{
      row.content='Intro\n(1) Find speed';
      row.rich_content={sections:{stem:d(p('Intro'),p('(1) Find speed')),subQuestions:[{label:'(1)',content:d(p('Find speed')),answer:d()}]}};
    });
    f.args.plan={schema:'source-subquestion-correction-review-v1',entries:f.state.rows.map(row=>({id:row.id,baseline:structuredClone(row)}))};
    return f;
  }
  f=subquestionFixture();await applyFormulaCorrections(f.args);assert.equal(f.state.posts.length,0);
  f=subquestionFixture();await applyFormulaCorrections({...f.args,execute:true});assert.equal(f.state.posts.length,2);assert.equal(f.state.rows[0].content,'Intro');
  assert.equal(f.state.rows[0].rich_content.sections.subQuestions[0].content.content[0].content[0].text,'Find speed');
  f=subquestionFixture();f.state.rows[1].version++;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/STATE_CHANGED/);assert.equal(f.state.posts.length,0);
  f=subquestionFixture();f.state.dropResponse=true;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/TRANSPORT_UNCERTAIN/);
  f.state.dropResponse=false;await applyFormulaCorrections({...f.args,execute:true,journal:f.state.journal});assert.equal(f.state.posts.length,2);
  // UTF-8: answer-section repair uses the same verified backup and resume gates.
  function answerSectionFixture() {
    const f=fixture(),p=text=>({type:'paragraph',content:[{type:'text',text}]}),d=(...content)=>({type:'doc',content});
    f.state.rows.forEach(row=>{
      row.rich_content={sections:{stem:d(p('stem')),options:[],answer:d(p('answer')),analysis:d(p('analysis')),
        subQuestions:[{id:'sub-original',label:'(1)',content:d(p('question')),answer:d(p('solution'))}]}};
    });
    f.args.plan={schema:'source-answer-section-correction-review-v1',entries:f.state.rows.map(row=>{
      const sourceBefore={stem:row.content,options:[],answer:row.answer,analysis:row.analysis,assets:[],formulas:[],rich_content:structuredClone(row.rich_content)};
      const sourceAfter=structuredClone(sourceBefore);
      sourceAfter.analysis='analysis\n(1) solution';sourceAfter.rich_content.sections.analysis=d(p('analysis'),p('(1) solution'));
      sourceAfter.rich_content.sections.subQuestions[0].answer=d(p('source answer'));
      return {id:row.id,baseline:structuredClone(row),sourceBefore,sourceAfter};
    })};
    return f;
  }
  f=answerSectionFixture();await applyFormulaCorrections(f.args);assert.equal(f.state.posts.length,0);
  f=answerSectionFixture();await applyFormulaCorrections({...f.args,execute:true});assert.equal(f.state.posts.length,2);assert.equal(f.state.rows[0].analysis,'analysis\n(1) solution');
  f=answerSectionFixture();f.state.rows[1].version++;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/STATE_CHANGED/);assert.equal(f.state.posts.length,0);
  f=answerSectionFixture();await assert.rejects(applyFormulaCorrections({...f.args,execute:true,verifyBackup:async()=>({restoreVerified:false})}),/BACKUP/);assert.equal(f.state.posts.length,0);
  f=answerSectionFixture();f.state.dropResponse=true;await assert.rejects(applyFormulaCorrections({...f.args,execute:true}),/TRANSPORT_UNCERTAIN/);
  f.state.dropResponse=false;await applyFormulaCorrections({...f.args,execute:true,journal:f.state.journal});assert.equal(f.state.posts.length,2);
  const {spawnSync}=require('node:child_process'),path=require('node:path');
  for(const args of [[],['--execute'],['--unknown']]) {
    const result=spawnSync(process.execPath,[path.join(__dirname,'apply-question-formula-corrections.js'),...args],{encoding:'utf8',timeout:10000,windowsHide:true});
    assert.equal(result.status,1);assert.match(result.stderr,/FORMULA_CORRECTION_/);assert.ok(!result.stderr.includes('Bearer'));
  }
  console.log('formula correction REST preflight, durable resume, and readback checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
