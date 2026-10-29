'use strict';

// A transfer describes the payment rail, not necessarily its economic purpose.
// Recover only explicit paid rent/service purposes from complete native rows.
// Funding, debt, source records and owner decisions remain under ledger control.
const excluded=/\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u5b9a\u91d1|\u9884\u6388\u6743|\u51bb\u7ed3|\u9000\u6b3e|\u9000\u79df|\u9000\u8fd8|\u8fd4\u8fd8|\u8fd4\u79df|\u501f\u6b3e|\u8d37\u6b3e|\u8fd8\u6b3e|\u672c\u91d1|\u6536\u76ca|\u7406\u8d22|\u57fa\u91d1|\u4ee3\u6536|\u4ee3\u4ed8|\u5468\u8f6c|\u63d0\u73b0|\u5145\u503c/;
function amountMinor(value){
 const m=String(value??'').match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
 return m?(BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))).toString():null;
}
function refreshExplicitLivingExpense(record,{excludedCounterparties=new Set()}={}){
 if(!['alipay','wechat'].includes(record.provider)||record.currency!=='CNY'||record.kind!=='transfer'||record.status!=='completed'||record.direction!=='debit'||!/^\d+$/.test(record.amountMinor)||BigInt(record.amountMinor)<=0n)return record;
 const raw=record.rawFields,description=String(record.description||'');
 if(!raw||excluded.test(description)||excludedCounterparties.has(String(record.counterparty||'').normalize('NFKC').trim())||['kind','\u4ea4\u6613\u7c7b\u578b','\u4e1a\u52a1\u7c7b\u578b'].some(k=>Object.hasOwn(raw,k)&&record.provider==='alipay')||record.accountRelations?.some(r=>r.role!=='funding'||!['funding_outflow','credit_charge'].includes(r.activity)))return record;
 const rent=/\u623f\u79df|\u79df\u91d1|\u79df\u6559\u5ba4/.test(description),utility=record.provider==='alipay'&&/^(?:\d{1,2}\u6708-)?(?:\u6c34\u8d39|\u7535\u8d39|\u71c3\u6c14\u8d39)(?:-|$)/.test(description)&&/\u6c34\u52a1|\u7535\u529b|\u5929\u7136\u6c14|\u71c3\u6c14/.test(record.counterparty||'')&&raw['\u4ea4\u6613\u5206\u7c7b']==='\u5145\u503c\u7f34\u8d39';
 if(!rent&&!utility)return record;
 const at=raw['\u4ea4\u6613\u65f6\u95f4'];
 if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)||at.slice(0,10)!==record.date||Date.parse(at.replace(' ','T')+'+08:00')!==Date.parse(record.occurredAt)||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u4ea4\u6613\u5bf9\u65b9']!==record.counterparty)return record;
 if(record.provider==='alipay'){
  if(raw['\u5546\u54c1\u8bf4\u660e']!==description||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==record.paymentChannel||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u4ea4\u6613\u5206\u7c7b']!==record.category||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==record.sourceTransactionId||!/^\d{16,40}$/.test(record.sourceTransactionId)||amountMinor(raw['\u91d1\u989d'])!==record.amountMinor)return record;
 }else if(!rent||raw['\u5546\u54c1']!==description||raw['\u652f\u4ed8\u65b9\u5f0f']!==record.paymentChannel||raw['\u4ea4\u6613\u7c7b\u578b']!=='\u8f6c\u8d26'||raw['\u5f53\u524d\u72b6\u6001']!=='\u5bf9\u65b9\u5df2\u6536\u94b1'||raw['\u4ea4\u6613\u5355\u53f7']!==record.sourceTransactionId||!/^\d{16,40}$/.test(record.sourceTransactionId)||amountMinor(raw['\u91d1\u989d(\u5143)'])!==record.amountMinor)return record;
 return {...record,kind:'expense',automaticClassification:{method:rent?'explicit_platform_rent_payment':'explicit_utility_service_payment',confidence:'explicit_native_paid_purpose',evidenceObservationIds:[record.id]}};
}
module.exports={refreshExplicitLivingExpense};
