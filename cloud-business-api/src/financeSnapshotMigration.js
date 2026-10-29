'use strict';
// Administrative migration only. No HTTP route accepts a snapshot or invokes this module.
const crypto=require('node:crypto');
const {validateRecord}=require('../../shared/personal-finance/ledger');
const {validateFinanceAccount,createPersonalFinanceRepository}=require('./personalFinanceRepository');
const {settlementPolicyBindings}=require('./financeSettlementPolicy');
const COLLECTIONS=['accounts','observations','annotations','links','balanceSnapshots','imports'];
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
const fail=code=>{throw Error('FINANCE_SNAPSHOT_'+code);};
function ledgerDigest(l){return hash(Object.fromEntries(['revision',...COLLECTIONS].map(k=>[k,l[k]])));}
function index(rows){if(!Array.isArray(rows))fail('COLLECTION_INVALID');const m=new Map();for(const r of rows){if(!r||typeof r.id!=='string'||!r.id||r.id.length>512||m.has(r.id))fail('ID_INVALID');m.set(r.id,r);}return m;}
function planAcceptedSnapshot({before,accepted,expectedRevision,expectedDigest}){
 if(String(before.revision)!==String(expectedRevision)||ledgerDigest(before)!==expectedDigest)fail('REVISION_OR_BASELINE_CHANGED');
 if(!/^\d+$/.test(String(accepted.revision)))fail('REVISION_INVALID');
 const maps=Object.fromEntries(COLLECTIONS.map(k=>[k,index(accepted[k])])),old=Object.fromEntries(COLLECTIONS.map(k=>[k,index(before[k])])),insert={},update={accounts:[],imports:[]};
 for(const k of COLLECTIONS){insert[k]=[];for(const [id,r]of old[k]){if(!maps[k].has(id))fail('EXISTING_ROW_MISSING');if(stable(r)!==stable(maps[k].get(id))){if(!['accounts','imports'].includes(k))fail('IMMUTABLE_ROW_CHANGED');update[k].push({before:r,after:maps[k].get(id)});}}for(const [id,r]of maps[k])if(!old[k].has(id))insert[k].push(r);}
 for(const a of accepted.accounts){validateFinanceAccount(a);settlementPolicyBindings(a,accepted);}
 for(const {before:a,after:b}of update.accounts)for(const k of ['type','provider','currency','maskedIdentifier','sourceProduct','balanceConvention'])if(a[k]!==b[k])fail('ACCOUNT_IDENTITY_CHANGED');
 for(const {before:a,after:b}of update.imports){const changed=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>stable(a[k])!==stable(b[k]));if(changed.some(k=>!['statementOwner','statementAccountIdentities'].includes(k)||a[k]!==undefined))fail('IMPORT_SOURCE_CHANGED');}
 const source=id=>{const s=maps.observations.get(id);if(!s)fail('SOURCE_NOT_FOUND');return s;};
 for(const i of accepted.imports){if(!maps.accounts.has(i.financialAccountId)||!/^[a-f0-9]{64}$/.test(i.fileHash)||!Array.isArray(i.observationIds))fail('IMPORT_INVALID');for(const id of i.observationIds)source(id);}
 for(const o of accepted.observations){validateRecord(o);const a=maps.accounts.get(o.financialAccountId),i=maps.imports.get(o.importId);if(!a||a.currency!==o.currency||!i||!i.observationIds.includes(o.id))fail('SOURCE_BINDING_INVALID');for(const r of o.accountRelations||[])if(r.financialAccountId&&!maps.accounts.has(r.financialAccountId))fail('RELATED_ACCOUNT_NOT_FOUND');if(typeof o.sourceIdentity!=='string'||!o.sourceIdentity||o.sourceIdentity.length>1024)fail('SOURCE_IDENTITY_INVALID');}
 for(const a of accepted.annotations){source(a.observationId);if(!a.patch||typeof a.patch!=='object'||Array.isArray(a.patch)||!/^[1-9]\d*$/.test(String(a.revision)))fail('ANNOTATION_INVALID');for(const k of ['financialAccountId','settlementAccountId'])if(a.patch[k]&&!maps.accounts.has(a.patch[k]))fail('ANNOTATION_ACCOUNT_NOT_FOUND');}
 for(const l of accepted.links){if(l.status!==undefined&&!['active','deleted'].includes(l.status)||!['duplicate','transfer','refund','distinct'].includes(l.type)||!Array.isArray(l.observationIds)||l.observationIds.length!==2||l.observationIds[0]===l.observationIds[1])fail('LINK_INVALID');l.observationIds.forEach(source);}
 for(const s of accepted.balanceSnapshots){const a=maps.accounts.get(s.financialAccountId);if(!a||a.currency!==s.currency||! /^-?(0|[1-9]\d*)$/.test(s.balanceMinor)||!Number.isFinite(Date.parse(s.asOf)))fail('BALANCE_INVALID');if(s.sourceObservationId)source(s.sourceObservationId);}
 const revision=(accepted.annotations.reduce((n,a)=>BigInt(a.revision)>n?BigInt(a.revision):n,BigInt(accepted.revision)>BigInt(before.revision)?BigInt(accepted.revision):BigInt(before.revision))+1n).toString();
 return {insert,update,revision,expectedDigest,acceptedDigest:ledgerDigest(accepted),counts:Object.fromEntries(COLLECTIONS.map(k=>[k,{insert:insert[k].length,update:update[k]?.length||0}]))};
}
async function readOwnerLedger(q,owner){return createPersonalFinanceRepository({query:q,transaction:()=>fail('NESTED_TRANSACTION'),parseBillFile:()=>fail('SOURCE_PARSE_NOT_USED')}).getLedger({tenantId:owner[0],actor:{accountId:owner[1],roles:['teacher']}});}
function assertSnapshotReadback({actual,accepted,revision}){
 if(actual.revision!==revision)fail('READBACK_REVISION_MISMATCH');
 for(const k of COLLECTIONS){const expected=accepted[k].map(r=>k==='accounts'?{...r,maskedIdentifier:r.maskedIdentifier??''}:k==='imports'?{...r,archiveReference:r.archiveReference??null}:k==='annotations'?{...r,createdAt:r.createdAt??null}:r);if(stable(actual[k])!==stable(expected))fail('READBACK_'+k.toUpperCase()+'_MISMATCH');}
}
async function applyAcceptedSnapshot({query:q,owner,accepted,expectedRevision,expectedDigest,migrationId}){
 if(!Array.isArray(owner)||owner.length!==2||owner.some(x=>typeof x!=='string'||!x.trim())||!/^[a-zA-Z0-9_-]{8,160}$/.test(migrationId||''))fail('SCOPE_INVALID');
 const locked=(await q('SELECT revision::text AS revision FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',owner)).rows[0];if(!locked||locked.revision!==String(expectedRevision))fail('REVISION_OR_BASELINE_CHANGED');
 const before=await readOwnerLedger(q,owner),plan=planAcceptedSnapshot({before,accepted,expectedRevision,expectedDigest}),chunk=async(rows,work)=>{for(let n=0;n<rows.length;n+=250)await work(rows.slice(n,n+250));},batch=async(table,rows,columns,select)=>chunk(rows,async part=>q(`INSERT INTO business.${table}(${columns}) SELECT ${select} FROM jsonb_array_elements($3::jsonb) r`,[...owner,JSON.stringify(part)]));
 const newAccounts=plan.insert.accounts.map(a=>({...a,maskedIdentifier:a.maskedIdentifier??''}));
 await batch('personal_finance_accounts',newAccounts,'id,tenant_id,account_id,data',"r->>'id',$1,$2,r");
 for(const {before:a,after:b}of plan.update.accounts){const r=await q('UPDATE business.personal_finance_accounts SET data=$4::jsonb WHERE tenant_id=$1 AND account_id=$2 AND id=$3 AND data=$5::jsonb',[...owner,b.id,JSON.stringify(b),JSON.stringify(a)]);if(r.rowCount!==1)fail('BASELINE_ROW_CHANGED');}
 const newImports=plan.insert.imports.map(i=>({...i,archiveReference:i.archiveReference??null}));
 await batch('personal_finance_imports',newImports,'id,tenant_id,account_id,financial_account_id,file_hash,data,created_at',"r->>'id',$1,$2,r->>'financialAccountId',r->>'fileHash',r,(r->>'createdAt')::timestamptz");
 for(const {before:a,after:b}of plan.update.imports){const {observationIds:omit,...original}=a,{observationIds:omitNew,...data}=b;const r=await q('UPDATE business.personal_finance_imports SET data=data||$4::jsonb WHERE tenant_id=$1 AND account_id=$2 AND id=$3 AND data @> $5::jsonb',[...owner,b.id,JSON.stringify(data),JSON.stringify(original)]);if(r.rowCount!==1)fail('BASELINE_ROW_CHANGED');}
 const observations=plan.insert.observations.map(o=>({data:o,sourceKey:hash({migrationId,id:o.id,sourceIdentity:o.sourceIdentity,recordFingerprint:o.recordFingerprint??null}),transactionKey:/^[a-f0-9]{64}$/.test(o.sourceIdentity)?o.sourceIdentity:hash(o.sourceIdentity)}));
 await batch('personal_finance_observations',observations,'id,tenant_id,account_id,financial_account_id,import_id,source_key,transaction_key,data',"r->'data'->>'id',$1,$2,r->'data'->>'financialAccountId',r->'data'->>'importId',r->>'sourceKey',r->>'transactionKey',r->'data'");
 const annotations=plan.insert.annotations.map(a=>({...a,createdAt:a.createdAt??null}));
 await batch('personal_finance_annotations',annotations,'id,tenant_id,account_id,observation_id,revision,data',"r->>'id',$1,$2,r->>'observationId',(r->>'revision')::bigint,r");
 await batch('personal_finance_links',plan.insert.links,'id,tenant_id,account_id,observation_a,observation_b,status,data',"r->>'id',$1,$2,r->'observationIds'->>0,r->'observationIds'->>1,COALESCE(r->>'status','active'),r");
 await batch('personal_finance_balance_snapshots',plan.insert.balanceSnapshots,'id,tenant_id,account_id,financial_account_id,data',"r->>'id',$1,$2,r->>'financialAccountId',r");
 const receipts=plan.insert.imports.map(i=>({key:migrationId+':'+i.id,hash:hash(i),receipt:{importId:i.id,financialAccountId:i.financialAccountId,observationIds:i.observationIds,recordCount:i.recordCount,fileHash:i.fileHash,revision:plan.revision,migrationId}}));
 if(receipts.some(r=>r.key.length>256))fail('RECEIPT_KEY_TOO_LONG');
 await batch('personal_finance_receipts',receipts,'tenant_id,account_id,idempotency_key,request_hash,receipt',"$1,$2,r->>'key',r->>'hash',r->'receipt'");
 const tables={accounts:'accounts',observations:'observations',annotations:'annotations',links:'links',balanceSnapshots:'balance_snapshots',imports:'imports'};
 for(const k of COLLECTIONS)await q(`UPDATE business.personal_finance_${tables[k]} t SET ledger_ordinal=s.ordinal FROM jsonb_array_elements_text($3::jsonb) WITH ORDINALITY s(id,ordinal) WHERE t.tenant_id=$1 AND t.account_id=$2 AND t.id=s.id`,[...owner,JSON.stringify(accepted[k].map(r=>r.id))]);
 await q('UPDATE business.personal_finance_owners SET revision=$3::bigint WHERE tenant_id=$1 AND account_id=$2',[...owner,plan.revision]);
 await q('INSERT INTO business.personal_finance_audit(id,tenant_id,account_id,revision,action,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',['finance_snapshot_'+migrationId,...owner,plan.revision,'accepted_reconciliation_snapshot',{migrationId,expectedDigest,acceptedDigest:plan.acceptedDigest,counts:plan.counts,accountChanges:plan.update.accounts,importMetadataChanges:plan.update.imports,normalizations:{unknownAnnotationCreatedAt:'null',absentAccountMaskedIdentifier:'empty_string',unarchivedImportReference:'null'},originalObservationsRewritten:0}].map((v,i)=>i===5?JSON.stringify(v):v));
 const actual=await readOwnerLedger(q,owner);assertSnapshotReadback({actual,accepted,revision:plan.revision});
 return {revision:plan.revision,counts:plan.counts,acceptedDigest:plan.acceptedDigest,readbackPassed:true};
}
module.exports={ledgerDigest,planAcceptedSnapshot,applyAcceptedSnapshot,assertSnapshotReadback};
