'use strict';
// Normal cloud REST only. Never import SQL repair helpers or elevate a database role.
const crypto = require('node:crypto');
const { stableJson } = require('../shared/authorityProtocol');
const { prepareFormulaCorrection } = require('./prepare-question-formula-correction');
const { prepareSubquestionCorrection } = require('./prepare-question-subquestion-correction');
const { prepareAnswerSectionCorrection } = require('./prepare-question-answer-section-correction');
const { nativeFormulaComponent } = require('../cloud-business-api/src/wordNativeFormula');
const { listAllQuestionPages } = require('./real-question-import-publish');
const { PUBLIC_BASE_URL } = require('./real-cloud-business-acceptance');
const fail = suffix => { throw new Error('FORMULA_CORRECTION_' + suffix); };
const digest = value => crypto.createHash('sha256').update(stableJson(value)).digest('hex');
const equal = (a,b) => stableJson(a) === stableJson(b);
function matches(row, expected) {
  return row && Object.keys(expected).filter(key=>!['updated_at','updated_by'].includes(key)).every(key=>equal(row[key],expected[key]));
}

async function applyFormulaCorrections({plan,baseUrl,sessionToken,deviceId,fetchImpl=fetch,execute=false,journal,verifyBackup,persistJournal}={}) {
  // Closed set of reviewed repairs shares backup, REST, conflict and resume gates.
  const prepare = plan?.schema==='source-formula-correction-review-v1' ? prepareFormulaCorrection
    : plan?.schema==='source-subquestion-correction-review-v1' ? prepareSubquestionCorrection
    : plan?.schema==='source-answer-section-correction-review-v1' ? prepareAnswerSectionCorrection : null;
  if (baseUrl!==PUBLIC_BASE_URL || typeof sessionToken!=='string' || !sessionToken || typeof deviceId!=='string' || !deviceId
    || typeof fetchImpl!=='function' || typeof execute!=='boolean' || !prepare
    || !Array.isArray(plan.entries) || !plan.entries.length || plan.entries.length>100
    || plan.entries.some(entry=>!entry || entry.id!==entry.baseline?.id || !/^question-import-[a-f0-9]{40}$/.test(entry.id))
    || new Set(plan.entries.map(entry=>entry.id)).size!==plan.entries.length) fail('INPUT_INVALID');
  const planHash=digest(plan);
  async function request(suffix, command) {
    let response,body;
    try {
      response=await fetchImpl(baseUrl+suffix,{redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{Accept:'application/json',Authorization:'Bearer '+sessionToken,'x-device-id':deviceId,...(command?{'Content-Type':'application/json'}:{})},
        ...(command?{method:'POST',body:JSON.stringify(command)}:{})});
      body=await response.json();
    } catch { fail(command?'TRANSPORT_UNCERTAIN':'READ_UNAVAILABLE'); }
    if (!response.ok || body?.ok!==true) fail('HTTP_'+response.status);
    return body;
  }
  const list=async()=>new Map((await listAllQuestionPages(afterId=>request('/api/desktop/question-bank/questions?limit=200'+
    (afterId===null?'':'&afterId='+encodeURIComponent(afterId))))).map(row=>[row.id,row]));
  let backup=null;
  if (execute) {
    if(typeof verifyBackup!=='function' || (!journal && typeof persistJournal!=='function')) fail('BACKUP_OR_JOURNAL_REQUIRED');
    backup=await verifyBackup();
    if(backup?.restoreVerified!==true || backup.ownershipAndPrivilegesVerified!==true || !/^[a-f0-9]{64}$/.test(backup.sha256||'')
      || !/^\/root\/scheduling-backups\/postgres\/\d{8}-\d{6}$/.test(backup.root||'')) fail('BACKUP_INVALID');
  }
  const rows=await list();
  let entries;
  if(journal) {
    if(journal.schema!=='formula-correction-execution-v1' || journal.baseUrl!==baseUrl || journal.planHash!==planHash
      || !Array.isArray(journal.entries) || journal.entries.length!==plan.entries.length) fail('JOURNAL_INVALID');
    entries=journal.entries;
    for(let i=0;i<entries.length;i++) {
      let command;
      try {command=prepare({current:entries[i].before,baseline:plan.entries[i].baseline,replacements:plan.entries[i].replacements,
        sourceBefore:plan.entries[i].sourceBefore,sourceAfter:plan.entries[i].sourceAfter,validateFormula:nativeFormulaComponent});}
      catch {fail('JOURNAL_INVALID');}
      if(!equal(command,entries[i].command)) fail('JOURNAL_INVALID');
    }
  } else entries=plan.entries.map(entry=>{
    const before=rows.get(entry.id);
    const command=prepare({current:before,baseline:entry.baseline,replacements:entry.replacements,
      sourceBefore:entry.sourceBefore,sourceAfter:entry.sourceAfter,validateFormula:nativeFormulaComponent});
    return {before:structuredClone(before),command};
  });
  const expected=entry=>({...entry.before,...entry.command.payload.changes,version:entry.before.version+1});
  // Check the entire batch before the first POST; a partial earlier run is read back, not overwritten.
  for(const entry of entries) {
    const row=rows.get(entry.before.id);
    if(!matches(row,entry.before) && !(journal && matches(row,expected(entry)))) fail('STATE_CHANGED');
  }
  if(!execute) return {mode:'dry-run',questionIds:entries.map(entry=>entry.before.id),planHash};
  if(!journal) {
    journal={schema:'formula-correction-execution-v1',baseUrl,planHash,backup,entries};
    try {await persistJournal(structuredClone(journal));} catch {fail('JOURNAL_PERSIST_FAILED');}
  }
  const verified=[];
  for(const entry of entries) {
    const current=(await list()).get(entry.before.id);
    if(matches(current,expected(entry))) {verified.push({id:current.id,version:current.version,mode:'readback-resumed'});continue;}
    if(!matches(current,entry.before)) fail('STATE_CHANGED');
    const {receipt}=await request('/api/desktop/question-bank/commands',entry.command);
    if(receipt?.status!=='committed' || receipt.commandId!==entry.command.commandId || receipt.payloadHash!==entry.command.payloadHash) fail('RECEIPT_REJECTED');
    const readback=(await list()).get(entry.before.id);
    if(!matches(readback,expected(entry))) fail('READBACK_MISMATCH');
    verified.push({id:readback.id,version:readback.version,mode:'committed-and-readback'});
  }
  return {mode:'execute',verifiedCount:verified.length,verified,planHash,backupSha256:backup.sha256};
}

async function main(env=process.env) {
  const fs=require('node:fs'),path=require('node:path');
  const {parseArgs}=require('node:util');
  const {values}=parseArgs({options:{plan:{type:'string'},'plan-sha256':{type:'string'},journal:{type:'string'},execute:{type:'boolean',default:false},resume:{type:'boolean',default:false}},strict:true,allowPositionals:false});
  if(!values.plan || !/^[a-f0-9]{64}$/.test(values['plan-sha256']||'') || (values.execute && !values.journal) || (values.resume && !values.journal)) fail('INPUT_INVALID');
  const raw=fs.readFileSync(values.plan);
  if(crypto.createHash('sha256').update(raw).digest('hex')!==values['plan-sha256']) fail('PLAN_HASH_MISMATCH');
  const journal=values.resume?JSON.parse(fs.readFileSync(values.journal,'utf8')):undefined;
  // A new non-resume run must never overwrite an earlier execution journal.
  if(values.execute && !values.resume && fs.existsSync(values.journal)) fail('JOURNAL_EXISTS');
  return applyFormulaCorrections({plan:JSON.parse(raw.toString('utf8')),baseUrl:PUBLIC_BASE_URL,
    sessionToken:env.REAL_QUESTION_CORRECTION_SESSION_TOKEN,deviceId:env.REAL_QUESTION_CORRECTION_DEVICE_ID,
    execute:values.execute,journal,
    verifyBackup:async()=>{
      const {execFile}=require('node:child_process');
      const {promisify}=require('node:util');
      const result=await promisify(execFile)(env.PYTHON||'python',[path.join(__dirname,'backup_cloud_postgres.py'),'--json'],{encoding:'utf8',timeout:660000,maxBuffer:1024*1024,windowsHide:true});
      return JSON.parse(result.stdout);
    },
    persistJournal:async value=>{
      const fd=fs.openSync(values.journal,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(value,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }});
}
module.exports={applyFormulaCorrections,main};
if(require.main===module) main().then(result=>console.log(JSON.stringify(result))).catch(error=>{
  // Never print transport errors, URLs with credentials, or raw backup subprocess output.
  console.error(/^(FORMULA|SUBQUESTION|ANSWER_SECTION)_CORRECTION_[A-Z0-9_]+$/.test(error.message)?error.message:'FORMULA_CORRECTION_EXECUTION_FAILED');process.exitCode=1;
});
