'use strict';
const { hash, stableJson, contentHash } = require('./repair-question-formula-identities');
function fail(code) { throw new Error('PACKED_OPTION_REPAIR_'+code); }
function validateProposal(before, entry) {
  if (!before || entry?.id!==before.id || entry.baselineHash!==hash(before)
      || before.contentHash!==contentHash(before,before.richContent)) fail('BASELINE_CHANGED');
  if (before.status!=='draft' || !Number.isSafeInteger(before.version) || before.version<1
      || !/^question-import-[a-f0-9]{40}$/.test(before.id)) fail('SCOPE_CHANGED');
  const after=entry.after;
  if (!after || Object.keys(after).sort().join(',')!=='options,richContent'
      || !Array.isArray(after.options) || after.options.length<4 || after.options.length>7
      || after.options.map(o=>o.label).join('')!=='ABCDEFG'.slice(0,after.options.length)
      || after.richContent?.sections?.options?.map(o=>o.label).join('')!==after.options.map(o=>o.label).join('')) fail('SCOPE_CHANGED');
  const unchanged=structuredClone(after.richContent);
  unchanged.sections.options=before.richContent.sections.options;
  if (stableJson(unchanged)!==stableJson(before.richContent)) fail('SCOPE_CHANGED');
  return {...before,...after,contentHash:contentHash({...before,options:after.options},after.richContent)};
}

// Caller owns BEGIN/ROLLBACK and verifies a reviewed plan digest plus restored backup.
async function applyPlan(query, rows, entries, actor) {
  if (!actor?.roles?.includes('super_admin') || !actor.accountId || !actor.tenantId) fail('ACCESS_DENIED');
  if (!Array.isArray(entries) || !entries.length || new Set(entries.map(e=>e.id)).size!==entries.length) fail('PLAN_INVALID');
  const prepared=entries.map(entry=>{
    const before=rows.find(row=>row.id===entry.id);
    return {before,entry,after:validateProposal(before,entry)};
  });
  const planHash=hash(entries), receipts=[];
  for (const {before,entry,after} of prepared) {
    const updated=await query(`UPDATE business.question_contents SET options_json=$3::jsonb,
      rich_content_json=$4::jsonb,content_hash=$5,version=version+1,updated_at=transaction_timestamp()
      WHERE tenant_id=$1 AND question_id=$2 AND version=$6 AND content_hash=$7
      AND options_json=$8::jsonb AND rich_content_json=$9::jsonb AND deleted=false RETURNING version`,
      [actor.tenantId,entry.id,stableJson(after.options),stableJson(after.richContent),after.contentHash,
        before.version,before.contentHash,stableJson(before.options),stableJson(before.richContent)]);
    if (updated.rowCount!==1 || Number(updated.rows[0]?.version)!==before.version+1) fail('STATE_CHANGED');
    const question=await query(`UPDATE business.questions SET updated_at=transaction_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND status='draft' AND deleted=false`,[actor.tenantId,entry.id]);
    if (question.rowCount!==1) fail('STATE_CHANGED');
    const result={id:entry.id,status:'draft',version:before.version+1,contentHash:after.contentHash,
      previousContentHash:before.contentHash,maintenance:'split-original-packed-options',planHash,
      originalSourceHash:before.sourceHash??null,originalItemId:before.itemId??null};
    const commandId='packed-option-repair-'+hash({id:entry.id,planHash}).slice(0,48);
    const receipt=await query(`INSERT INTO business.desktop_question_command_receipts
      (tenant_id,command_id,payload_hash,status,result_json,result_hash,actor_account_id)
      VALUES ($1,$2,$3,'committed',$4::jsonb,$5,$6)`,
      [actor.tenantId,commandId,hash(entry),stableJson(result),hash(result),actor.accountId]);
    if (receipt.rowCount!==1) fail('RECEIPT_FAILED');
    receipts.push({commandId,resultHash:hash(result),...result});
  }
  return receipts;
}
module.exports={validateProposal,applyPlan};
