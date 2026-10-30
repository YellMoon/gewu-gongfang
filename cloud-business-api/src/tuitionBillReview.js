'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {sourceFields,sourceKey,sourceOf,validSource,moneyMinor}=require('../../shared/personal-finance/tuitionReview');
const fail=code=>Object.assign(Error('CLOUD_PERSONAL_FINANCE_'+code),{code:'CLOUD_PERSONAL_FINANCE_'+code});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
function scope(owner){if(!owner?.actor?.roles?.includes('super_admin')||!owner.tenantId||!owner.actor.accountId)throw fail('ACCESS_DENIED');return [owner.tenantId,owner.actor.accountId];}
function validate(input){
 if(!exact(input,['expectedRevision','confirmed','rows'])||input.confirmed!==true||typeof input.expectedRevision!=='string'||!/^\d{1,24}$/.test(input.expectedRevision)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>50)throw fail('INPUT_INVALID');
 const used=new Set();for(const r of input.rows){
  if(!exact(r,['source','allocations','remainderAcknowledged'])||(r.remainderAcknowledged!==undefined&&typeof r.remainderAcknowledged!=='boolean')||!exact(r.source,sourceFields)||sourceFields.some(k=>typeof r.source[k]!=='string'||r.source[k].length>512)||!r.source.observationId||!Array.isArray(r.allocations)||!r.allocations.length||r.allocations.length>10||!/^([1-9]\d{0,11})$/.test(r.source.amountMinor))throw fail('INPUT_INVALID');
  const key=sourceKey(r.source);if(used.has(key))throw fail('INPUT_INVALID');used.add(key);
  let sum=0n;const students=new Set();for(const a of r.allocations){
   if(!exact(a,['studentId','amountMinor','existingPaymentId','expectedUpdatedAt','allowSimilar'])||typeof a.studentId!=='string'||!a.studentId||a.studentId.length>128||students.has(a.studentId)||typeof a.amountMinor!=='string'||!/^([1-9]\d{0,11})$/.test(a.amountMinor)||(a.existingPaymentId!==undefined&&(typeof a.existingPaymentId!=='string'||!a.existingPaymentId||a.existingPaymentId.length>128||typeof a.expectedUpdatedAt!=='string'||a.expectedUpdatedAt.length>128))||(a.allowSimilar!==undefined&&typeof a.allowSimilar!=='boolean'))throw fail('INPUT_INVALID');
   if(BigInt(a.amountMinor)>10000000000n)throw fail('TUITION_ALLOCATION_INVALID');
   students.add(a.studentId);sum+=BigInt(a.amountMinor);
  }
  if(sum>BigInt(r.source.amountMinor)||sum<BigInt(r.source.amountMinor)&&r.remainderAcknowledged!==true)throw fail('TUITION_ALLOCATION_INVALID');
 }
}
function createTuitionBillReview({writer}){
 const query=(...a)=>writer.query(...a);
 async function state(owner){const [tenant,actor]=scope(owner);if(!writer)throw fail('UNAVAILABLE');
  const revision=(await query('SELECT revision::text FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2',[tenant,actor])).rows[0]?.revision||'0';
  const students=(await query('SELECT id,name,grade_current,school_legacy AS school,parent_name_legacy AS parent_name FROM business.students WHERE tenant_id=$1 AND legacy_deleted=false ORDER BY name,id',[tenant])).rows;
  const payments=(await query('SELECT id,student_id,amount::text,payment_date::text,payment_method,notes,updated_at::text FROM business.payments WHERE tenant_id=$1 AND deleted=false ORDER BY payment_date DESC,id',[tenant])).rows;
  const links=(await query("SELECT receipt FROM business.personal_finance_receipts WHERE tenant_id=$1 AND account_id=$2 AND receipt->>'schema'='tuition-source-v1'",[tenant,actor])).rows.map(r=>r.receipt);
  const paymentMap=new Map(payments.map(p=>[p.id,p]));
  return {revision,students,payments,links:links.map(link=>({...link,needsReview:link.allocations.some(a=>{const p=paymentMap.get(a.paymentId);return !p||p.student_id!==a.studentId||moneyMinor(p.amount)!==a.amountMinor;})}))};
 }
 async function submit(owner,input,idempotencyKey){const [tenant,actor]=scope(owner);validate(input);if(!writer)throw fail('UNAVAILABLE');
  if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))throw fail('INPUT_INVALID');
  const batchKey='tuition-batch:'+idempotencyKey,requestHash=hash(input);
  return writer.transaction(async()=>{
   await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':tuition-bill-review']);
   const prior=(await query('SELECT request_hash,receipt FROM business.personal_finance_receipts WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3',[tenant,actor,batchKey])).rows[0];
   if(prior){if(prior.request_hash!==requestHash)throw fail('TUITION_RECEIPT_CONFLICT');return prior.receipt;}
   const rev=(await query('SELECT revision::text FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',[tenant,actor])).rows[0]?.revision;
   if(rev!==input.expectedRevision)throw fail('REVISION_CONFLICT');
   const results=[],paymentIds=new Set();
   for(const r of input.rows){
    const sourceRow=(await query('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[tenant,actor,r.source.observationId])).rows[0]?.data;
    if(!validSource(sourceRow)||JSON.stringify(sourceOf(sourceRow))!==JSON.stringify(Object.fromEntries(sourceFields.map(k=>[k,r.source[k]]))))throw fail('TUITION_SOURCE_CONFLICT');
    const sourceReceiptKey='tuition-source:'+hash(sourceKey(r.source));
    if((await query('SELECT receipt FROM business.personal_finance_receipts WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3',[tenant,actor,sourceReceiptKey])).rows.length)throw fail('TUITION_ALREADY_LINKED_CONFLICT');
    const allocations=[];
    for(const a of r.allocations){
     if(!(await query('SELECT id FROM business.students WHERE tenant_id=$1 AND id=$2 AND legacy_deleted=false FOR SHARE',[tenant,a.studentId])).rows.length)throw fail('TUITION_STUDENT_CONFLICT');
     let paymentId=a.existingPaymentId;
     if(paymentId){
      const p=(await query('SELECT id,student_id,amount::text,updated_at::text FROM business.payments WHERE tenant_id=$1 AND id=$2 AND deleted=false FOR UPDATE',[tenant,paymentId])).rows[0];
      if(!p||p.student_id!==a.studentId||moneyMinor(p.amount)!==a.amountMinor||p.updated_at!==a.expectedUpdatedAt)throw fail('TUITION_PAYMENT_CONFLICT');
      if(paymentIds.has(paymentId)||(await query("SELECT 1 FROM business.personal_finance_receipts WHERE tenant_id=$1 AND receipt->>'schema'='tuition-source-v1' AND receipt->'allocations' @> $2::jsonb LIMIT 1",[tenant,JSON.stringify([{paymentId}])])).rows.length)throw fail('TUITION_PAYMENT_CONFLICT');
     }else{
      const n=BigInt(a.amountMinor),amount=String(n/100n)+'.'+String(n%100n).padStart(2,'0');
      const similar=(await query('SELECT id FROM business.payments WHERE tenant_id=$1 AND student_id=$2 AND deleted=false AND amount=$3::numeric AND payment_date BETWEEN $4::date-3 AND $4::date+3 LIMIT 1',[tenant,a.studentId,amount,r.source.date])).rows;
      if(similar.length&&a.allowSimilar!==true)throw fail('TUITION_SIMILAR_PAYMENT_CONFLICT');
      paymentId='bill-payment-'+randomUUID();
      const notes='\u8d26\u5355\u8ba4\u9886\uff1a'+r.source.provider+'\uff1b\u539f\u4ea4\u6613\u53f7\uff1a'+(r.source.sourceTransactionId||r.source.observationId)+'\uff1b\u4ed8\u6b3e\u4eba\uff1a'+(sourceRow.counterparty||'')+'\uff1b\u539f\u5907\u6ce8\uff1a'+(sourceRow.description||'');
      await query('INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date,payment_method,notes) VALUES($1,$2,$3,$4::numeric,1,$5::date,$6,$7)',[paymentId,tenant,a.studentId,amount,r.source.date,r.source.provider==='wechat'?'\u5fae\u4fe1':'\u652f\u4ed8\u5b9d',notes.slice(0,2000)]);
     }
     paymentIds.add(paymentId);allocations.push({studentId:a.studentId,amountMinor:a.amountMinor,paymentId,action:a.existingPaymentId?'linked':'created'});
    }
    const receipt={schema:'tuition-source-v1',source:r.source,allocations,remainderMinor:String(BigInt(r.source.amountMinor)-allocations.reduce((n,a)=>n+BigInt(a.amountMinor),0n)),confirmedBy:actor,confirmedAt:new Date().toISOString()};
    await query('INSERT INTO business.personal_finance_receipts(tenant_id,account_id,idempotency_key,request_hash,receipt) VALUES($1,$2,$3,$4,$5::jsonb)',[tenant,actor,sourceReceiptKey,hash(r),JSON.stringify(receipt)]);results.push(receipt);
   }
   const receipt={schema:'tuition-batch-v1',rows:results,created:results.flatMap(r=>r.allocations).filter(a=>a.action==='created').length,linked:results.flatMap(r=>r.allocations).filter(a=>a.action==='linked').length};
   await query('INSERT INTO business.personal_finance_receipts(tenant_id,account_id,idempotency_key,request_hash,receipt) VALUES($1,$2,$3,$4,$5::jsonb)',[tenant,actor,batchKey,requestHash,JSON.stringify(receipt)]);return receipt;
  });
 }
 return {state,submit};
}
module.exports={createTuitionBillReview,validate};
