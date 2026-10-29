'use strict';

const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_STORED_VALUE_TOP_UP_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_STORED_VALUE_TOP_UP_INVALID'});};
const text=(s,max=512)=>typeof s==='string'&&s.length>0&&s.length<=max&&s.trim()===s;
const minor=s=>typeof s==='string'&&/^[1-9]\d{0,19}$/.test(s);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;

function validateStoredValueTopUps(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schema','rules'].includes(k))||value.schema!=='stored-value-topups-v1'||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>64)invalid();
 const used=new Set();
 for(const r of value.rules){
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['sourceTransactionId','sourceDate','receivingAccountId','cashPaidMinor','creditedMinor','confirmedAt'].includes(k))||!text(r.sourceTransactionId)||used.has(r.sourceTransactionId)||!date(r.sourceDate)||!text(r.receivingAccountId)||!minor(r.cashPaidMinor)||!minor(r.creditedMinor)||BigInt(r.creditedMinor)<BigInt(r.cashPaidMinor)||!text(r.confirmedAt,64)||!/^\d{4}-\d{2}-\d{2}T/.test(r.confirmedAt)||Number.isNaN(Date.parse(r.confirmedAt)))invalid();
  used.add(r.sourceTransactionId);
 }
 return value;
}

function storedValueSourceValid(source){return source?.status==='active'&&source.type==='debit_card'&&source.provider==='\u534e\u590f\u94f6\u884c'&&source.currency==='CNY'&&/^\d{4}$/.test(source.maskedIdentifier||'')&&!source.sourceProduct;}
function storedValueAccountsValid(source,target){return storedValueSourceValid(source)&&target?.status==='active'&&target.type==='other'&&target.provider==='\u534e\u4e3a\u94b1\u5305'&&target.currency===source.currency&&target.id!==source.id&&!target.sourceProduct;}

// Only exact owner-confirmed orders supply the credited face value. Huawei's
// merchant name alone does not identify a transport card or its discount.
function findStoredValueTopUps(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 if(!accounts.some(a=>a.storedValueTopUps))return new Map();
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const k=key(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key));
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|')));
 for(const l of links)if(l.status!=='deleted'||l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')))for(const id of l.observationIds){const o=byId.get(id);if(o)blocked.add(key(o));}
 const rows=[...latest.values()],out=new Map(),norm=v=>String(v||'').normalize('NFKC').trim();
 for(const source of accounts){
  if(!source.storedValueTopUps)continue;
  const policy=validateStoredValueTopUps(source.storedValueTopUps);if(!storedValueSourceValid(source))continue;
  for(const rule of policy.rules){
   const target=accountMap.get(rule.receivingAccountId);if(!storedValueAccountsValid(source,target))continue;
   const candidates=rows.filter(o=>o.financialAccountId===source.id&&o.sourceTransactionId===rule.sourceTransactionId);
   if(candidates.length!==1)continue;
   const o=candidates[0],raw=o.rawFields||{},flow=o.statementFlow||{},cash=String(raw['\u4ea4\u6613\u91d1\u989d']||'').match(/^-(\d+)(?:\.(\d{1,2}))?$/);
   const channelValid=!o.paymentChannel||norm(o.paymentChannel)===source.provider+'\u50a8\u84c4\u5361('+source.maskedIdentifier+')';
   if(blocked.has(key(o))||o.provider!=='huaxia'||o.status!=='completed'||o.kind!=='unknown'||o.direction!=='debit'||o.currency!==source.currency||o.date!==rule.sourceDate||o.amountMinor!==rule.cashPaidMinor||o.accountRelations?.length||o.paymentAccountHint||!channelValid||o.automaticClassification||flow.schema!=='huaxia-debit-v1'||flow.timePrecision!=='day'||flow.incomeMinor!=='0'||flow.expenseMinor!==o.amountMinor||o.occurredAt!==o.date+'T23:59:59+08:00'||raw['\u8bb0\u8d26\u65e5\u671f']!==o.date||raw['\u6458\u8981']!=='\u94f6\u8054'||norm(o.description)!=='\u94f6\u8054'||norm(o.counterparty)!=='(\u7279\u7ea6)\u534e\u4e3a\u652f\u4ed8(\u8baf\u8054\u667a\u4ed8)\u5546\u6237'||norm(raw['\u5bf9\u65b9\u59d3\u540d'])!==norm(o.counterparty)||norm(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7'])||norm(raw['\u5bf9\u65b9\u5f00\u6237\u884c'])||norm(raw['\u9644\u8a00'])||!cash||String(BigInt(cash[1])*100n+BigInt((cash[2]||'').padEnd(2,'0')))!==o.amountMinor)continue;
   // Competing originals count even when annotated. A later actual receipt
   // must be associated explicitly before deriving another receiving leg.
   if(rows.some(p=>p.id!==o.id&&p.status==='completed'&&p.currency===o.currency&&(p.financialAccountId===source.id&&p.date===o.date&&p.direction==='debit'&&p.amountMinor===o.amountMinor||p.financialAccountId===target.id&&p.direction==='credit'&&p.amountMinor===rule.creditedMinor&&Math.abs(Date.parse(p.date)-Date.parse(o.date))<=86400000)))continue;
   out.set(o.id,{method:'owner_confirmed_stored_value_top_up',confidence:'owner_confirmed',sourceObservationId:o.id,sourceTransactionId:o.sourceTransactionId,sourceAccountId:source.id,receivingAccountId:target.id,cashPaidMinor:rule.cashPaidMinor,creditedMinor:rule.creditedMinor,nonCashBenefitMinor:String(BigInt(rule.creditedMinor)-BigInt(rule.cashPaidMinor)),confirmedAt:rule.confirmedAt,receivingLeg:'owner_confirmed_derived',receivingDateBasis:'cash_date_proxy_without_native_receipt',currentBalanceImplied:false,reversible:true});
  }
 }
 return out;
}

module.exports={validateStoredValueTopUps,storedValueSourceValid,storedValueAccountsValid,findStoredValueTopUps};
