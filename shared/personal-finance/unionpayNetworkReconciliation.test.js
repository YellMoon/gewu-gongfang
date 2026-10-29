'use strict';
// Synthetic fixtures only. This planner never performs a financial mutation.
const test=require('node:test'),assert=require('node:assert/strict');
const {planUnionpayNetworkEvidence:plan}=require('./unionpayNetworkReconciliation');
const bank='\u62db\u5546\u94f6\u884c',channel='\u4e91\u95ea\u4ed8';
const account={id:'card',provider:bank,maskedIdentifier:'1234',currency:'CNY',type:'credit_card',status:'active'};
function record(n=1){const id='UI-2026-'+String(n).padStart(5,'0');return {sourceTransactionId:'',date:'2026-10-01',occurredAt:'2026-10-01T23:59:59+08:00',amountMinor:'1234',currency:'CNY',direction:'debit',kind:'unknown',status:'completed',description:'Synthetic merchant',counterparty:'Synthetic merchant',paymentChannel:channel,paymentAccountHint:bank+'(1234)',balanceMinor:null,relatedReference:'',rawFields:{captureRecordId:id,sourceSha256:'a'.repeat(64),displayedTime:'12:34',timeAccuracyVerified:false,dateBasis:'visible_date_label',nativeRowText:['Synthetic merchant','-\u00a512.34',bank+'[1234] \u00b7 12:34']},bankNetwork:{schema:'unionpay-network-capture-v1',recordId:id,bank,cardTail:'1234',scope:'channel_only',dateBasis:'visible_date_label',timePrecision:'day',displayedTime:'12:34',timeAccuracyVerified:false,nativeStatus:'settled',nativeAmountText:'-\u00a512.34',sourceSha256:'a'.repeat(64),bankTransactionIdPrinted:false,bankPostingDatePrinted:false}};}
function transaction(id='old',extra={}){return {id,date:'2026-10-01',occurredAt:'2026-10-01T23:59:59+08:00',currency:'CNY',status:'completed',kind:'expense',observationIds:[id],cashEffects:{},balanceEffects:{card:'-1234'},sources:[{id,financialAccountId:'card',provider:'synthetic-bank',kind:'expense',direction:'debit',status:'completed',description:'Synthetic merchant',counterparty:'',paymentChannel:'',statementFlow:{schema:'synthetic-not-bank-evidence'},rawFields:{}}],...extra};}
const run=(records,transactions,extra={})=>plan({records,transactions,accounts:[account],...extra});
function minuteCase(){
 const name='\u5174\u4e1a\u94f6\u884c',r=record();r.bankNetwork.bank=name;r.paymentAccountHint=name+'(1234)';r.rawFields.nativeRowText[2]=name+'[1234] \u00b7 12:34';
 const mkBank=(id,description,time)=>({id,financialAccountId:'card',provider:'cib',kind:'expense',direction:'debit',status:'completed',description,counterparty:description,date:r.date,currency:'CNY',amountMinor:'1234',bankStatement:{schema:'bank-credit-v1',provider:'cib',nonCash:false,cardTail:'1234',postedDate:r.date,statementDate:'2026-10-25'},rawFields:{cardTail:'1234',dateBasis:'transaction_date',tradeDate:r.date,postedDate:r.date,statementDate:'2026-10-25',statementAmountMinor:'1234',statementCredit:false,...(time?{sourceTradeDateTime:r.date+' '+time}:{})}});
 const chosen=transaction('direct');chosen.sources=[mkBank('direct','Synthetic merchant','12:34')];
 const w={id:'wechat-original',financialAccountId:'wallet',provider:'wechat',kind:'expense',direction:'debit',status:'completed',description:'Other item',counterparty:'Other merchant',date:r.date,occurredAt:r.date+'T17:04:43+08:00',currency:'CNY',amountMinor:'1234',sourceTransactionId:'original-order',paymentChannel:name+'\u4fe1\u7528\u5361(1234)',rawFields:{'\u4ea4\u6613\u65f6\u95f4':r.date+' 17:04:43','\u4ea4\u6613\u5355\u53f7':'original-order','\u5546\u54c1':'Other item','\u4ea4\u6613\u5bf9\u65b9':'Other merchant','\u6536/\u652f':'\u652f\u51fa','\u5f53\u524d\u72b6\u6001':'\u652f\u4ed8\u6210\u529f','\u4ea4\u6613\u7c7b\u578b':'\u5546\u6237\u6d88\u8d39','\u91d1\u989d(\u5143)':'12.34','\u652f\u4ed8\u65b9\u5f0f':name+'\u4fe1\u7528\u5361(1234)'}};
 const other=transaction('wechat');other.sources=[w,mkBank('wechat-bank','\u8d22\u4ed8\u901a\u5feb\u6377--Other merchant')];other.observationIds=other.sources.map(s=>s.id);return{r,chosen,other,accounts:[{...account,provider:name}]};
}
test('original bank minute corroborates one native row while a separately timed WeChat bank payment remains untouched',()=>{
 const {r,chosen,other,accounts}=minuteCase(),before=JSON.stringify({r,chosen,other});const p=run([r],[chosen,other],{accounts});assert.equal(p.matches.length,1);const m=p.matches[0];assert.deepEqual(m.transactionIds,['direct']);assert.equal(m.timeUsedForMatching,true);assert.equal(m.timeEvidence[0].confidence,'inferred');assert.equal(m.timeEvidence[0].nativeTimeAccuracyClaimed,false);assert.equal(m.excludedCandidateEvidence[0].platformOriginalOccurredAt,other.sources[0].occurredAt);assert.equal(m.noNewCash,true);assert.equal(r.bankNetwork.timeAccuracyVerified,false);assert.equal(JSON.stringify({r,chosen,other}),before);
});
test('corroborated bank minute can exclude a separately timed original Alipay payment with its own real bank leg',()=>{
 const q=minuteCase(),s=q.other.sources[0];s.provider='alipay';s.relatedReference='merchant-order';s.rawFields={'\u4ea4\u6613\u65f6\u95f4':q.r.date+' 17:04:43','\u4ea4\u6613\u8ba2\u5355\u53f7':s.sourceTransactionId,'\u5546\u5bb6\u8ba2\u5355\u53f7':s.relatedReference,'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u5bf9\u65b9':s.counterparty,'\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':'12.34','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':s.paymentChannel};const b=q.other.sources[1];b.description=b.counterparty='\u652f\u4ed8\u5b9d\u5feb\u6377--Travel merchant';const before=JSON.stringify(q),p=run([q.r],[q.chosen,q.other],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.deepEqual(p.matches[0].transactionIds,['direct']);assert.equal(p.matches[0].excludedCandidateEvidence[0].platformProvider,'alipay');assert.equal(p.matches[0].timeEvidence[0].nativeTimeAccuracyClaimed,false);assert.equal(p.matches[0].noNewCash,true);assert.equal(JSON.stringify(q),before);
 for(const mutate of[x=>x.other.sources[0].rawFields['\u91d1\u989d']='12.35',x=>x.other.sources[0].rawFields['\u4ea4\u6613\u72b6\u6001']='\u4ea4\u6613\u5173\u95ed',x=>x.other.sources[0].rawFields['\u4ea4\u6613\u65f6\u95f4']=q.r.date+' 17:04:42',x=>x.other.sources[1].description='Unknown channel',x=>x.other.appliedAnnotations=[{patch:{category:'Owner choice'}}],x=>x.other.observationIds=['wechat-original']]){const z=structuredClone(q);mutate(z);assert.equal(run([z.r],[z.chosen,z.other],{accounts:z.accounts}).matches.length,0);}
});
test('corroborated minute does not exclude unknown-time, contradictory, edited or duplicate bank candidates',()=>{
 for(const change of [q=>delete q.chosen.sources[0].rawFields.sourceTradeDateTime,q=>q.chosen.sources[0].rawFields.sourceTradeDateTime=q.r.date+' 12:35',q=>q.chosen.sources[0].rawFields.statementAmountMinor='1235',q=>q.chosen.sources[0].bankStatement.nonCash=true,q=>q.chosen.sources[0].rawFields.postedDate='2026-10-02',q=>q.other.sources[0].rawFields['\u4ea4\u6613\u65f6\u95f4']=q.r.date+' 17:04:42',q=>q.other.sources[0].paymentChannel+='&discount',q=>q.other.sources[0].rawFields['\u91d1\u989d(\u5143)']='12.35',q=>q.other.sources[1].description='Unknown processor',q=>q.other.sources[0].occurredAt=q.r.date+'T12:34:43+08:00',q=>q.chosen.sources.push({...q.chosen.sources[0],id:'duplicate-bank'})]){const q=minuteCase();change(q);assert.equal(run([q.r],[q.chosen,q.other],{accounts:q.accounts}).matches.length,0,String(change));}
 const q=minuteCase(),second=structuredClone(q.r);second.bankNetwork.recordId=second.rawFields.captureRecordId='UI-2026-00002';assert.equal(run([q.r,second],[q.chosen,q.other],{accounts:q.accounts}).matches.length,0);const unknown=transaction('unknown');assert.equal(run([q.r],[q.chosen,q.other,unknown],{accounts:q.accounts}).matches.length,0);assert.equal(run([q.r],[q.chosen,q.other],{accounts:q.accounts,links:[{type:'distinct',observationIds:['wechat-bank','another']}]}).matches.length,0);
});
function bankEnvelopeCase(provider,bankName,description,title='Synthetic merchant'){
 const r=record();r.description=r.counterparty=title;r.bankNetwork.bank=bankName;r.paymentAccountHint=bankName+'(1234)';r.rawFields.nativeRowText=[title,'-\u00a512.34',bankName+'[1234] \u00b7 12:34'];const t=transaction();Object.assign(t.sources[0],{provider,currency:'CNY',date:r.date,amountMinor:r.amountMinor,description,counterparty:description,bankStatement:{schema:'bank-credit-v1',cardTail:'1234'},rawFields:{cardTail:'1234',dateBasis:'transaction_date',tradeDate:r.date,statementAmountMinor:'1234',statementCredit:false}});return {r,t,accounts:[{...account,provider:bankName}]};
}
test('printed CCB city and operation wrappers are removed only for an exact native bank leg',()=>{
 for(const description of ['\u4e0a\u6d77 \u8de8\u884c\u6d88\u8d39 Synthetic merchant','\u8de8\u884c\u6d88\u8d39 Synthetic merchant']){const {r,t,accounts}=bankEnvelopeCase('ccb','\u5efa\u8bbe\u94f6\u884c',description),before=JSON.stringify(t);assert.equal(run([r],[t],{accounts}).matches.length,1);assert.equal(JSON.stringify(t),before);}
 for(const mutate of [s=>s.rawFields.tradeDate='2026-10-02',s=>s.rawFields.cardTail='9999',s=>s.rawFields.statementAmountMinor='1235',s=>s.rawFields.statementCredit=true,s=>s.provider='other',s=>s.bankStatement.cardTail='9999']){const {r,t,accounts}=bankEnvelopeCase('ccb','\u5efa\u8bbe\u94f6\u884c','\u4e0a\u6d77 \u8de8\u884c\u6d88\u8d39 Synthetic merchant');mutate(t.sources[0]);assert.equal(run([r],[t],{accounts}).matches.length,0,String(mutate));}
});
test('a printed Huawei Pay suffix is a device-token envelope, not another physical card',()=>{
 const {r,t,accounts}=bankEnvelopeCase('cmb',bank,'Synthetic merchant-Huawei Pay:7253'),before=JSON.stringify({r,t,accounts});const p=run([r],[t],{accounts});assert.equal(p.matches.length,1);assert.equal(p.matches[0].financialAccountId,'card');assert.equal(r.bankNetwork.cardTail,'1234');assert.equal(JSON.stringify({r,t,accounts}),before);t.sources[0].description='Other merchant-Huawei Pay:7253';t.sources[0].counterparty=t.sources[0].description;assert.equal(run([r],[t],{accounts}).matches.length,0);
});
function refundCase(provider,bankName,description,title='Synthetic merchant'){
 const data=bankEnvelopeCase(provider,bankName,description,title),{r,t}=data;r.direction='credit';r.kind='refund';r.bankNetwork.nativeStatus='refund';r.bankNetwork.nativeAmountText='+\u00a512.34';r.rawFields.nativeRowText[1]='+\u00a512.34';r.rawFields.nativeRowText.push('\u9000\u6b3e');t.kind='refund';t.balanceEffects.card='1234';Object.assign(t.sources[0],{direction:'credit',kind:'refund'});Object.assign(t.sources[0].rawFields,{statementCredit:true,statementAmountMinor:'-1234'});return data;
}
test('literal CCB refund operation envelopes retain the original credit and bank posting date',()=>{
 for(const prefix of ['\u5317\u4eac \u8de8\u884c\u9000\u8d27 ','\u8de8\u884c\u9000\u8d27 ']){const {r,t,accounts}=refundCase('ccb','\u5efa\u8bbe\u94f6\u884c',prefix+'Synthetic merchant'),before=JSON.stringify(t);t.sources[0].rawFields.postedDate='2026-10-02';const original=JSON.stringify(t);assert.equal(run([r],[t],{accounts}).matches.length,1);assert.equal(JSON.stringify(t),original);assert.notEqual(before,original);}
 for(const change of [s=>s.direction='debit',s=>s.kind='debt_payment',s=>s.rawFields.statementAmountMinor='1234',s=>s.rawFields.tradeDate='2026-09-30']){const {r,t,accounts}=refundCase('ccb','\u5efa\u8bbe\u94f6\u884c','\u8de8\u884c\u9000\u8d27 Synthetic merchant');change(t.sources[0]);assert.equal(run([r],[t],{accounts}).matches.length,0);}
});
test('CIB refund merchant date suffixes require a complete validated bank leg and an actual nonfuture calendar date',()=>{
 const {r,t,accounts}=refundCase('cib','\u5174\u4e1a\u94f6\u884c','Synthetic merchant20260930'),raw=JSON.stringify(t);assert.equal(run([r],[t],{accounts}).matches.length,1);assert.equal(JSON.stringify(t),raw);
 for(const text of ['Synthetic merchant20261002','Synthetic merchant20260230','Other merchant20260930']){const q=refundCase('cib','\u5174\u4e1a\u94f6\u884c',text);assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,0);}
 const q=refundCase('cib','\u5174\u4e1a\u94f6\u884c','Synthetic merchant20260930');q.t.sources[0].rawFields.cardTail='9999';assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,0);
});
test('CCB debit POS merchant is taken from its literal operation and original printed remark, never from a masked name',()=>{
 const r=record();r.bankNetwork.bank='\u5efa\u8bbe\u94f6\u884c';r.paymentAccountHint=r.bankNetwork.bank+'(1234)';r.rawFields.nativeRowText[2]=r.bankNetwork.bank+'[1234] \u00b7 12:34';const accounts=[{...account,provider:r.bankNetwork.bank,type:'debit_card'}],t=transaction();
 Object.assign(t.sources[0],{provider:'ccb',date:r.date,currency:'CNY',amountMinor:r.amountMinor,description:'\u8de8\u884cPOS\u6d88\u8d39 Synthetic merchant',counterparty:'***Company',statementFlow:{schema:'ccb-debit-v1',expenseMinor:r.amountMinor,incomeMinor:'0'},rawFields:{dateBasis:'transaction_date','\u6458\u8981':'\u8de8\u884cPOS\u6d88\u8d39','\u4ea4\u6613\u65e5\u671f':'20261001','\u4ea4\u6613\u91d1\u989d':'-12.34','\u4ea4\u6613\u5730\u70b9/\u9644\u8a00':'Synthetic merchant'}});
 assert.equal(run([r],[t],{accounts}).matches.length,1);
 for(const change of [s=>s.rawFields['\u4ea4\u6613\u65e5\u671f']='20260930',s=>s.rawFields['\u4ea4\u6613\u91d1\u989d']='12.34',s=>s.rawFields['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']='Other merchant',s=>s.rawFields['\u6458\u8981']='Other operation']){const q=structuredClone(t);change(q.sources[0]);assert.equal(run([r],[q],{accounts}).matches.length,0);}
});
function utilityCase(type='water'){
 const labels={water:['\u6c34\u8d39\u7f34\u7eb3','\u6c34\u8d39-Utility account'],power:['\u7535\u8d39\u7f34\u7eb3','\u7535\u8d39-Utility account'],gas:['\u71c3\u6c14\u8d39\u7f34\u7eb3','\u71c3\u6c14\u8d39-Utility account']},[title,description]=labels[type],r=record(),t=transaction();r.description=r.counterparty='\uff08\u7279\u7ea6\uff09'+title;r.rawFields.nativeRowText[0]=r.description;delete t.sources[0].statementFlow;
 Object.assign(t.sources[0],{provider:'alipay',financialAccountId:'wallet',date:r.date,currency:'CNY',amountMinor:r.amountMinor,kind:'transfer',description,counterparty:'Synthetic utility bureau',paymentChannel:bank+'\u4fe1\u7528\u5361(1234)&\u73b0\u91d1\u62b5\u4ef7\u5238',rawFields:{'\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u5206\u7c7b':'\u5145\u503c\u7f34\u8d39','\u91d1\u989d':'12.34','\u5546\u54c1\u8bf4\u660e':description,'\u4ea4\u6613\u8ba2\u5355\u53f7':'utility-order','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':bank+'\u4fe1\u7528\u5361(1234)&\u73b0\u91d1\u62b5\u4ef7\u5238'}});t.sources[0].sourceTransactionId='utility-order';return {r,t};
}
test('explicit water, power and gas bill purposes match the same printed paying card without changing the original allocation',()=>{
 for(const type of ['water','power','gas']){const {r,t}=utilityCase(type),raw=JSON.stringify(t);assert.equal(run([r],[t]).matches.length,1);assert.equal(JSON.stringify(t),raw);}
 const {r,t}=utilityCase();r.description=r.counterparty='\u516c\u5171\u4e8b\u4e1a\u7f34\u8d39\uff08\u6c34\u8d39\uff09';r.rawFields.nativeRowText[0]=r.description;assert.equal(run([r],[t]).matches.length,1);
});
test('utility equivalence does not discard competing candidates or relax type, raw payment, direction, currency or order checks',()=>{
 for(const change of [s=>s.paymentChannel=bank+'\u4fe1\u7528\u5361(9999)',s=>s.currency='USD',s=>s.direction='credit',s=>s.amountMinor='1235',s=>s.date='2026-09-30',s=>s.rawFields['\u4ea4\u6613\u72b6\u6001']='closed',s=>s.rawFields['\u6536/\u652f']='\u4e0d\u8ba1\u6536\u652f',s=>s.rawFields['\u4ea4\u6613\u5206\u7c7b']='\u8f6c\u8d26\u7ea2\u5305',s=>s.rawFields['\u5546\u54c1\u8bf4\u660e']='Other',s=>s.rawFields['\u91d1\u989d']='12.35']){const {r,t}=utilityCase();change(t.sources[0]);assert.equal(run([r],[t]).matches.length,0);}
 const {r,t}=utilityCase(),other=transaction('other');other.sources[0].description='Unrelated merchant';assert.equal(run([r],[t,other]).matches.length,0);const q=utilityCase('power');q.r.description=q.r.counterparty='\u6c34\u8d39\u7f34\u7eb3';q.r.rawFields.nativeRowText[0]=q.r.description;assert.equal(run([q.r],[q.t]).matches.length,0);
});
test('explicit native platform envelopes can match the complete printed clearing label',()=>{
 const {r,t,accounts}=bankEnvelopeCase('bocom','\u4ea4\u901a\u94f6\u884c','\u6d88\u8d39 (\u7279\u7ea6)\u7f8e\u56e2','Synthetic shop_\uff08\u7279\u7ea6\uff09\u7f8e\u56e2');assert.equal(run([r],[t],{accounts}).matches.length,1);t.sources[0].description=t.sources[0].counterparty='\u6d88\u8d39 (\u7279\u7ea6)Other';assert.equal(run([r],[t],{accounts}).matches.length,0);
});
test('nested native WeChat and UnionPay tags preserve both explicit channel identities',()=>{
 const r=record();r.description=r.counterparty='Synthetic shop_\u8d22\u4ed8\u901a(\u94f6\u8054\u4e91\u95ea\u4ed8)';r.rawFields.nativeRowText[0]=r.description;const t=transaction();Object.assign(t.sources[0],{provider:'wechat',description:'Different printed merchant',counterparty:'Different printed merchant'});assert.equal(run([r],[t]).matches.length,1);t.sources[0].provider='alipay';assert.equal(run([r],[t]).matches.length,0);
});
test('generic processor credit label can corroborate an explicit original credit-card repayment',()=>{
 const title='\u652f\u4ed8\u5b9d\uff08\u4e2d\u56fd\uff09\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8',{r,t,accounts}=bankEnvelopeCase('bocom','\u4ea4\u901a\u94f6\u884c','Synthetic owner/\u4ed8\u6b3e\u5c3e\u53f7:0156/\u94f6\u8054\u5165\u8d26',title);r.direction='credit';r.bankNetwork.nativeAmountText='+\u00a512.34';r.rawFields.nativeRowText[1]='+\u00a512.34';t.kind='debt_payment';t.balanceEffects.card='1234';Object.assign(t.sources[0],{direction:'credit',kind:'refund'});t.sources[0].rawFields.statementCredit=true;t.sources[0].rawFields.statementAmountMinor='-1234';assert.equal(run([r],[t],{accounts}).matches.length,1);t.sources[0].description=t.sources[0].counterparty='Unexplained credit';assert.equal(run([r],[t],{accounts}).matches.length,0);
});
test('a matching bank envelope never excludes an unsupported equal-amount competitor',()=>{
 const {r,t,accounts}=bankEnvelopeCase('ccb','\u5efa\u8bbe\u94f6\u884c','\u8de8\u884c\u6d88\u8d39 Synthetic merchant'),other=transaction('other');other.sources[0].description=other.sources[0].counterparty='Unrelated';const p=run([r],[t,other],{accounts});assert.equal(p.matches.length,0);assert.equal(p.held[0].candidateTransactionIds.length,2);
});
test('credit-card liability movement matches even though no cash inflow or outflow exists',()=>{
 const records=[record()],transactions=[transaction()];const before=JSON.stringify({records,transactions});const p=run(records,transactions);assert.equal(p.summary.matchedEvidenceRows,1);assert.equal(p.matches[0].deltaMinor,'-1234');assert.equal(p.matches[0].noNewCash,true);assert.equal(p.matches[0].noNewIncomeOrConsumption,true);assert.equal(p.matches[0].preservesOwnerClassification,true);assert.equal(p.matches[0].timeUsedForMatching,false);assert.equal(JSON.stringify({records,transactions}),before);
});
test('contrary sign, date or actual account never matches',()=>{
 for(const extra of [{balanceEffects:{card:'1234'}},{date:'2026-09-30',occurredAt:'2026-09-30T23:59:59+08:00'},{balanceEffects:{other:'-1234'}}]){const p=run([record()],[transaction('old',extra)]);assert.equal(p.matches.length,0);assert.equal(p.held.length,1);}
});
test('cash posting day owns the match rather than the order date',()=>{
 const t=transaction('old',{date:'2026-09-30',occurredAt:'2026-09-30T10:00:00+08:00',balanceEffectEvents:{card:[{occurredAt:'2026-10-01T01:02:03+08:00',deltaMinor:'-1234'}]}});assert.equal(run([record()],[t]).matches.length,1);
});
test('printed bank trade date can match a network trade without rewriting next-day posting',()=>{
 const t=transaction('old',{occurredAt:'2026-10-02T23:59:59+08:00',balanceEffectTimes:{card:'2026-10-02T23:59:59+08:00'}});Object.assign(t.sources[0],{date:'2026-10-01',amountMinor:'1234'});const before=JSON.stringify(t);const p=run([record()],[t]);assert.equal(p.matches.length,1);assert.equal(JSON.stringify(t),before);
 t.sources[0].amountMinor='1235';assert.equal(run([record()],[t]).matches.length,0,'a nearby date without equal original bank amount is not evidence');
});
test('CNY-only identity never merges a same-suffix USD card',()=>{
 const p=run([record()],[transaction()],{accounts:[{...account,currency:'USD'}]});assert.equal(p.identities.length,1);assert.equal(p.matches.length,0);
});
test('merchant mismatch needs a printed compatible network channel',()=>{
 const t=transaction();t.sources[0].description='Other merchant';assert.equal(run([record()],[t]).held[0].reason,'merchant_channel_or_purpose_not_supported');t.sources[0].description='\u94f6\u8054\u6d88\u8d39';assert.equal(run([record()],[t]).matches.length,1);
});
test('two identical amounts against one network row are not reciprocal unique',()=>{
 const p=run([record()],[transaction('a'),transaction('b')]);assert.equal(p.matches.length,0);assert.equal(p.held[0].candidateTransactionIds.length,2);assert.equal(p.held[0].reason,'cash_movement_cardinality_ambiguous');
});
test('equal-count groups preserve economic event count without assigning row identities',()=>{
 const p=run([record(1),record(2)],[transaction('a'),transaction('b')]);assert.equal(p.matches.length,1);assert.equal(p.matches[0].networkCount,2);assert.equal(p.matches[0].existingEconomicEventCount,2);assert.equal(p.matches[0].individualIdentity,'undetermined_within_group');assert.equal(p.matches[0].reversible,true);
 const partial=run([record(1),record(2)],[transaction('a'),transaction('b'),transaction('c')]);assert.equal(partial.matches.length,0);assert.equal(partial.held.length,2);
});
test('an owner-excluded competing record still blocks a false unique match',()=>{
 const p=run([record()],[transaction('a'),transaction('b')],{links:[{type:'distinct',observationIds:['b','other']}]});assert.equal(p.matches.length,0);assert.equal(p.held[0].candidateTransactionIds.length,2);
});
test('a newer failed source version remains a competing conflict',()=>{
 const a=transaction('a');a.sources=[{...a.sources[0],sourceIdentity:'same',sourceVersionOrdinal:1},{...a.sources[0],id:'a-failed',sourceIdentity:'same',sourceVersionOrdinal:2,status:'failed'}];const p=run([record()],[a,transaction('b')]);assert.equal(p.matches.length,0);assert.equal(p.held[0].candidateTransactionIds.length,2);
});
test('network owner decisions and undo links are respected',()=>{
 const r=record(),id=r.bankNetwork.recordId;assert.equal(run([r],[transaction()],{annotations:[{observationId:id,revision:'1',patch:{kind:'transfer'}}]}).matches.length,0);assert.equal(run([r],[transaction()],{annotations:[{observationId:id,revision:'2',reset:true},{observationId:id,revision:'1',patch:{kind:'transfer'}}]}).matches.length,1);assert.equal(run([r],[transaction()],{links:[{type:'duplicate',deletedAt:'2026-10-02',observationIds:[id,'old']}]}).matches.length,0);
});
test('refund cannot silently attach to an ordinary income or repayment',()=>{
 const r=record();r.direction='credit';r.kind='refund';r.bankNetwork.nativeStatus='refund';r.bankNetwork.nativeAmountText='+\u00a512.34';r.rawFields.nativeRowText[1]='+\u00a512.34';r.rawFields.nativeRowText.push('\u9000\u6b3e');const t=transaction('old',{kind:'income',balanceEffects:{card:'1234'}});assert.equal(run([r],[t]).matches.length,0);t.kind='refund';assert.equal(run([r],[t]).matches.length,1);
});
test('frozen face amount is retained without selecting any posted balance movement',()=>{
 const r=record();r.direction='neutral';r.status='pending';r.bankNetwork.nativeStatus='frozen';r.bankNetwork.nativeAmountText='\u00a512.34';r.rawFields.nativeRowText[1]='\u00a512.34';r.rawFields.nativeRowText.push('\u51bb\u7ed3');const p=run([r],[transaction('old',{balanceEffects:{card:'1234'}})]);assert.equal(p.matches.length,0);assert.equal(p.nonCash.length,1);assert.equal(p.nonCash[0].amountMinor,'1234');assert.equal(p.nonCash[0].noCash,true);
});
test('an unmatched or ambiguous row remains visible and no account is invented',()=>{
 const p=run([record()],[]);assert.equal(p.held.length,1);assert.equal(p.financialMutationPerformed,false);assert.equal(p.summary.sourceRows,p.summary.heldRows);const q=run([record()],[transaction()],{accounts:[]});assert.equal(q.identities.length,1);assert.equal(q.matches.length,0);
});
test('duplicate source identities cannot masquerade as two independent group rows',()=>{
 assert.throws(()=>run([record(1),record(1)],[transaction('a'),transaction('b')]),/Duplicate network/);
});
test('complete merchant and platform components can appear in reverse printed order without a fuzzy name match',()=>{
 const q=bankEnvelopeCase('bocom','\u4ea4\u901a\u94f6\u884c','\u6d88\u8d39 \u6dd8\u5b9d\u5e73\u53f0\u5546\u6237Synthetic company','Synthetic company_\u6dd8\u5b9d\u5e73\u53f0\u5546\u6237');assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,1);q.t.sources[0].description=q.t.sources[0].counterparty='\u6d88\u8d39 \u6dd8\u5b9d\u5e73\u53f0\u5546\u6237Other company';assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,0);
});
test('one missing final CGB parenthesis is repaired only within the validated original card envelope',()=>{
 const q=bankEnvelopeCase('cgb','\u5e7f\u53d1\u94f6\u884c','(\u6d88\u8d39)Synthetic company(Travel alias','Synthetic company(Travel alias)');assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,1);
 for(const change of [s=>s.rawFields.cardTail='9999',s=>s.rawFields.statementAmountMinor='1235',s=>s.provider='other',s=>s.description=s.counterparty='(\u6d88\u8d39)Other company(Travel alias']){const t=structuredClone(q.t);change(t.sources[0]);assert.equal(run([q.r],[t],{accounts:q.accounts}).matches.length,0);}
});
function delayedCmbRefund(){
 const q=refundCase('cmb',bank,'\u4e91\u95ea\u4ed8\u626b\u7801-Synthetic merchant'),s=q.t.sources[0];s.date='2026-06-26';s.occurredAt='2026-06-26T23:59:59+08:00';Object.assign(s.rawFields,{tradeDate:s.date,postedDate:'2026-10-02',statementDate:'2026-10-06'});Object.assign(s.bankStatement,{postedDate:'2026-10-02',statementDate:'2026-10-06',nonCash:false});q.t.date=s.date;q.t.occurredAt=s.occurredAt;q.t.balanceEffectTimes={card:'2026-10-02T23:59:59+08:00'};return q;
}
test('CMB refund posting evidence can support the native visible day while preserving its much older bank trade day',()=>{
 const q=delayedCmbRefund(),before=JSON.stringify(q),p=run([q.r],[q.t],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.equal(p.matches[0].dateEvidence[0].originalBankTradeDate,'2026-06-26');assert.equal(p.matches[0].dateEvidence[0].bankPostingDate,'2026-10-02');assert.equal(p.matches[0].dateEvidence[0].nativeVisibleDate,'2026-10-01');assert.equal(p.matches[0].dateEvidence[0].bankPostingDaysAfterNative,1);assert.equal(JSON.stringify(q),before);
 for(const change of [s=>s.rawFields.postedDate='2026-10-03',s=>s.bankStatement.postedDate='2026-10-03',s=>s.rawFields.statementAmountMinor='1234',s=>s.rawFields.cardTail='9999',s=>s.description=s.counterparty='\u4e91\u95ea\u4ed8\u626b\u7801-Other merchant',s=>s.kind='income']){const t=structuredClone(q.t);change(t.sources[0]);assert.equal(run([q.r],[t],{accounts:q.accounts}).matches.length,0);}
});
test('alternative trade and posting days cannot consume a single original bank leg twice',()=>{
 const q=delayedCmbRefund(),other=structuredClone(q.r);other.bankNetwork.recordId='UI-2026-00002';other.rawFields.captureRecordId=other.bankNetwork.recordId;other.date='2026-10-02';other.occurredAt=other.date+'T23:59:59+08:00';const p=run([q.r,other],[q.t],{accounts:q.accounts});assert.equal(p.matches.length,0);assert.equal(p.held.length,2);assert(p.held.every(h=>h.reason==='bank_cash_leg_reused_across_dates'));
});
test('rejecting one native candidate does not veto an unrelated candidate using the same original bank leg; removing that veto restores competition',()=>{
 const q=delayedCmbRefund(),other=structuredClone(q.r);other.bankNetwork.recordId='UI-2026-00002';other.rawFields.captureRecordId=other.bankNetwork.recordId;other.date='2026-10-02';other.occurredAt=other.date+'T23:59:59+08:00';const veto={id:'owner-veto',type:'distinct',observationIds:['UI-2026-00002','old'],status:'active'};
 const p=run([q.r,other],[q.t],{accounts:q.accounts,links:[veto]});assert.equal(p.matches.length,1);assert.deepEqual(p.matches[0].networkObservationIds,['UI-2026-00001']);assert.equal(p.held.length,1);
 const reset=run([q.r,other],[q.t],{accounts:q.accounts,links:[{...veto,status:'deleted',deletedAt:'2026-10-03T00:00:00Z'}]});assert.equal(reset.matches.length,0);assert.equal(reset.held.length,2);assert(reset.held.every(h=>h.reason==='bank_cash_leg_reused_across_dates'));
});

test('tax-service label corroborates a literal successful social-insurance payment to the tax bureau on the same printed card',()=>{
 const make=()=>{const {r,t}=utilityCase();r.description=r.counterparty='\u529e\u7a0e\u670d\u52a1\u5385';r.rawFields.nativeRowText[0]=r.description;const s=t.sources[0];s.description='\u793e\u4fdd\u7f34\u8d39';s.counterparty='\u56fd\u5bb6\u7a0e\u52a1\u603b\u5c40\u6d59\u6c5f\u7701\u7a0e\u52a1\u5c40';Object.assign(s.rawFields,{'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u5bf9\u65b9':s.counterparty,'\u4ea4\u6613\u5206\u7c7b':'\u516c\u5171\u670d\u52a1'});return {r,t};};
 const q=make(),before=JSON.stringify(q);assert.equal(run([q.r],[q.t]).matches.length,1);assert.equal(JSON.stringify(q),before);
 for(const change of [s=>s.counterparty='Other collector',s=>s.rawFields['\u4ea4\u6613\u5bf9\u65b9']='Other collector',s=>s.rawFields['\u4ea4\u6613\u5206\u7c7b']='\u5145\u503c\u7f34\u8d39',s=>s.rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']='other-order',s=>s.paymentChannel=bank+'(9999)',s=>s.direction='credit']){const x=make();change(x.t.sources[0]);assert.equal(run([x.r],[x.t]).matches.length,0,String(change));}
 assert.equal(run([q.r],[q.t,transaction('competing')]).matches.length,0);
});

function yulibaoRoute(){
 const r=record();r.direction='credit';r.bankNetwork.nativeAmountText='+\u00a512.34';r.description=r.counterparty='\uff08\u7279\u7ea6\uff09\u7f51\u5546\u94f6\u884cT1\uff08\u8d44\u91d1\u7ed3\u7b97\uff09';r.rawFields.nativeRowText=[r.description,'+\u00a512.34',bank+'[1234] \u00b7 12:34'];const s={id:'fund-original',provider:'mybank',status:'completed',currency:'CNY',date:r.date,direction:'debit',amountMinor:'1234',financialAccountId:'fund',description:'Fund redemption',rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u6b63\u5e38\u8d4e\u56de','\u4ea4\u6613\u91d1\u989d':'-12.34','\u5bf9\u65b9\u8d26\u53f7':'1234','\u5bf9\u65b9\u673a\u6784\u540d\u79f0':bank,'\u4ea4\u6613\u65f6\u95f4':r.date+'08:31:59'},statementFlow:{schema:'mybank-yulibao-v1',incomeMinor:'0',expenseMinor:'1234'}},t=transaction('withdrawal',{kind:'transfer',balanceEffects:{card:'1234',fund:'-1234'},sources:[s]});return {r,t,accounts:[{...account,type:'debit_card'}]};
}
test('MYbank redemption original explicitly names the receiving bank and card; generic settlement alone is not a route',()=>{
 const q=yulibaoRoute(),before=JSON.stringify(q),p=run([q.r],[q.t],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.equal(JSON.stringify(q),before);
 for(const number of ['****1234','***************1234','622222221234']){const x=yulibaoRoute();x.t.sources[0].rawFields['\u5bf9\u65b9\u8d26\u53f7']=number;assert.equal(run([x.r],[x.t],{accounts:x.accounts}).matches.length,1);}
 for(const number of ['123','unknown1234','****12345','1234unknown']){const x=yulibaoRoute();x.t.sources[0].rawFields['\u5bf9\u65b9\u8d26\u53f7']=number;assert.equal(run([x.r],[x.t],{accounts:x.accounts}).matches.length,0);}
 for(const change of [s=>s.rawFields['\u5bf9\u65b9\u8d26\u53f7']='9999',s=>s.rawFields['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']='Other bank',s=>s.rawFields['\u4ea4\u6613\u65f6\u95f4']='2026-09-30',s=>s.rawFields['\u4ea4\u6613\u91d1\u989d']='-12.35',s=>s.rawFields['\u4ea4\u6613\u7c7b\u578b']='Purchase',s=>s.statementFlow.schema='mybank-current-v1',s=>s.statementFlow.expenseMinor='1235',s=>s.status='failed']){const x=yulibaoRoute();change(x.t.sources[0]);assert.equal(run([x.r],[x.t],{accounts:x.accounts}).matches.length,0,String(change));}
 const x=yulibaoRoute();x.t.balanceEffects.fund='-1235';assert.equal(run([x.r],[x.t],{accounts:x.accounts}).matches.length,0);const z=yulibaoRoute();z.t.balanceEffects.third='1';assert.equal(run([z.r],[z.t],{accounts:z.accounts}).matches.length,0);
 assert.equal(run([q.r],[q.t,transaction('other',{balanceEffects:{card:'1234'}})],{accounts:q.accounts}).matches.length,0);
});

function repaymentWithProvenSavingsRival(){
 const q=bankEnvelopeCase('huaxia','\u534e\u590f\u94f6\u884c','\u94f6\u8054','\u4fe1\u7528\u5361\u8fd8\u6b3e');q.r.kind='debt_payment';q.t.kind='debt_payment';q.accounts[0].type='debit_card';
 const a={...account,id:'recipient',provider:'\u5efa\u8bbe\u94f6\u884c',maskedIdentifier:'5678',type:'debit_card'};q.accounts.push(a);
 const debit={id:'payer-original',provider:'huaxia',financialAccountId:'card',status:'completed',currency:'CNY',date:q.r.date,direction:'debit',amountMinor:'1234',description:'\u624b\u673a\u94f6\u884c\u8f6c\u8d26',counterparty:'Synthetic owner',statementFlow:{schema:'huaxia-debit-v1',expenseMinor:'1234',incomeMinor:'0'},rawFields:{'\u6458\u8981':'\u624b\u673a\u94f6\u884c\u8f6c\u8d26','\u8bb0\u8d26\u65e5\u671f':q.r.date,'\u5bf9\u65b9\u5f00\u6237\u884c':'\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u603b\u884c','\u5bf9\u65b9\u5361/\u8d26\u53f7':'****5678','\u4ea4\u6613\u91d1\u989d':'-12.34'}},credit={id:'recipient-original',provider:'ccb',financialAccountId:'recipient',status:'completed',currency:'CNY',date:q.r.date,direction:'credit',amountMinor:'1234',description:'\u7535\u5b50\u6c47\u5165',counterparty:'Synthetic owner',statementFlow:{schema:'ccb-debit-v1',incomeMinor:'1234',expenseMinor:'0'},rawFields:{dateBasis:'transaction_date','\u4ea4\u6613\u65e5\u671f':'20261001','\u6458\u8981':'\u7535\u5b50\u6c47\u5165','\u4ea4\u6613\u91d1\u989d':'12.34','\u5bf9\u65b9\u8d26\u53f7':'****1234'}};
 q.rival=transaction('cash-transfer',{kind:'transfer',balanceEffects:{card:'-1234',recipient:'1234'},observationIds:[debit.id,credit.id],sources:[debit,credit]});return q;
}
test('two mutually naming bank originals prove a savings transfer is not a credit repayment, without changing that transfer',()=>{
 const q=repaymentWithProvenSavingsRival(),before=JSON.stringify(q),p=run([q.r],[q.t,q.rival],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.deepEqual(p.matches[0].transactionIds,['old']);assert.equal(p.matches[0].excludedCandidateEvidence.length,1);assert.equal(p.matches[0].excludedCandidateEvidence[0].recipientAccountType,'debit_card');assert.equal(JSON.stringify(q),before);
 for(const change of [x=>x.accounts[1].type='credit_card',x=>x.rival.sources.pop(),x=>x.rival.sources[0].rawFields['\u5bf9\u65b9\u5361/\u8d26\u53f7']='****9999',x=>x.rival.sources[1].rawFields['\u5bf9\u65b9\u8d26\u53f7']='****9999',x=>x.rival.sources[0].rawFields['\u4ea4\u6613\u91d1\u989d']='-12.35',x=>x.rival.sources[1].statementFlow.schema='other',x=>x.rival.sources[1].date='2026-09-30',x=>x.rival.sources[1].rawFields['\u4ea4\u6613\u65e5\u671f']='20260930',x=>x.rival.balanceEffects.recipient='1235']){const x=repaymentWithProvenSavingsRival();change(x);assert.equal(run([x.r],[x.t,x.rival],{accounts:x.accounts}).matches.length,0,String(change));}
 const x=repaymentWithProvenSavingsRival();assert.equal(run([x.r],[x.t,x.rival],{accounts:x.accounts,links:[{type:'distinct',observationIds:['payer-original','other']}]}).matches.length,0,'owner-excluded competitors still block');
 const y=repaymentWithProvenSavingsRival();y.r.kind='unknown';y.r.description=y.r.counterparty='Unspecified service';y.r.rawFields.nativeRowText[0]=y.r.description;assert.equal(run([y.r],[y.t,y.rival],{accounts:y.accounts}).matches.length,0,'do not infer repayment intent from the other sources');
});

function printedLegalSuffixCase(provider='cmb'){
 const base=provider==='cmb'?'\u5e73\u9633\u53bf\u57ce\u4e61\u516c\u5171\u4ea4\u901a\u6709\u9650\u516c':'\u4e2d\u6d77\u7269\u4e1a\u7ba1\u7406\u6709\u9650\u516c\u53f8\u676d\u5dde',suffix=provider==='cmb'?'\u53f8':'\u5206\u516c\u53f8';
 const q=bankEnvelopeCase(provider,provider==='cmb'?bank:'\u5efa\u8bbe\u94f6\u884c',provider==='cmb'?base+'-Huawei Pay:7253':'\u4e0a\u6d77 \u8de8\u884c\u6d88\u8d39 '+base,base+suffix);q.t.sources[0].bankStatement.nonCash=false;return {...q,base,suffix};
}
test('bounded legal suffix completion retains both printed merchant names and cannot become arbitrary prefix matching',()=>{
 for(const provider of ['cmb','ccb']){const q=printedLegalSuffixCase(provider),before=JSON.stringify(q),p=run([q.r],[q.t],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.equal(p.matches[0].merchantNameEvidence[0].inferredMissingSuffix,q.suffix);assert.equal(p.matches[0].merchantNameEvidence[0].printedBankHanCharacterCount,12);assert.equal(p.matches[0].merchantNameEvidence[0].edgeIsCompatibilityOnly,true);assert.equal(JSON.stringify(q),before);
  for(const change of [x=>x.t.sources[0].bankStatement.nonCash=true,x=>x.t.sources[0].rawFields.cardTail='9999',x=>x.t.sources[0].rawFields.tradeDate='2026-09-30',x=>x.t.sources[0].rawFields.statementAmountMinor='1235',x=>x.t.sources[0].kind='fee',x=>{x.r.description=x.r.counterparty=x.base+'Other branch';x.r.rawFields.nativeRowText[0]=x.r.description;}]){const x=printedLegalSuffixCase(provider);change(x);assert.equal(run([x.r],[x.t],{accounts:x.accounts}).matches.length,0,String(change));}
  const other=transaction('unresolved-competitor');other.sources[0].description='Other merchant';assert.equal(run([q.r],[q.t,other],{accounts:q.accounts}).matches.length,0);
 }
 const q=printedLegalSuffixCase();q.t.sources[0].description=q.t.sources[0].counterparty='\u5e73\u9633\u53bf\u57ce\u4e61\u516c\u5171\u4ea4\u901a\u6709\u9650-Huawei Pay:7253';assert.equal(run([q.r],[q.t],{accounts:q.accounts}).matches.length,0);
});
test('two same-title legal-name completions are a whole equal-count group and never individual row assignments',()=>{
 const q=printedLegalSuffixCase(),r2=structuredClone(q.r);r2.bankNetwork.recordId='UI-2026-00002';r2.rawFields.captureRecordId=r2.bankNetwork.recordId;const t2=structuredClone(q.t);t2.id='second-bank-row';t2.observationIds=['second-bank-row'];t2.sources[0].id='second-bank-row';
 const p=run([q.r,r2],[q.t,t2],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.equal(p.matches[0].individualIdentity,'undetermined_within_group');assert.equal(p.matches[0].existingEconomicEventCount,2);assert.equal(p.matches[0].merchantNameEvidence.length,4);assert.equal(p.matches[0].timeUsedForMatching,false);
 assert.equal(run([q.r,r2],[q.t],{accounts:q.accounts}).matches.length,0);
});

function telecomAndFine(){
 const q=bankEnvelopeCase('ccb','\u5efa\u8bbe\u94f6\u884c','\u9752\u5c9b\u5e02 \u8de8\u884c\u6d88\u8d39 Synthetic(\u7535\u4fe1\u5145\u503c)','Synthetic(\u7535\u4fe1\u5145\u503c)'),s={id:'fine-original',provider:'alipay',status:'completed',direction:'debit',currency:'CNY',date:q.r.date,amountMinor:'1234',description:'\u6267\u6536\u5355\u4f4d\uff1a\u6d4b\u8bd5\u5e02\u516c\u5b89\u5c40\u4ea4\u901a\u8b66\u5bdf\u652f\u961f\uff0c\u7f34\u6b3e\u5355\u53f7\uff1atest-fine',counterparty:'\u6d4b\u8bd5\u5e02\u8d22\u653f\u5c40',sourceTransactionId:'fine-order',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u4fe1\u7528\u5361(1234)',rawFields:{}};
 Object.assign(s.rawFields,{'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u5bf9\u65b9':s.counterparty,'\u4ea4\u6613\u5206\u7c7b':'\u516c\u5171\u670d\u52a1','\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u4ea4\u6613\u8ba2\u5355\u53f7':s.sourceTransactionId,'\u91d1\u989d':'12.34','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':s.paymentChannel});
 const bankRow=structuredClone(q.t.sources[0]);bankRow.id='fiscal-bank-original';bankRow.description=bankRow.counterparty='\u652f\u4ed8\u5b9d-'+s.counterparty;bankRow.bankStatement.nonCash=false;
 q.rival=transaction('traffic-fine',{kind:'expense',sources:[s,bankRow],observationIds:[s.id,bankRow.id]});return q;
}
test('explicit telecom service cannot consume a separately proven traffic fine paid to a fiscal bureau',()=>{
 const q=telecomAndFine(),before=JSON.stringify(q),p=run([q.r],[q.t,q.rival],{accounts:q.accounts});assert.equal(p.matches.length,1);assert.deepEqual(p.matches[0].transactionIds,['old']);assert.equal(p.matches[0].excludedCandidateEvidence[0].platformObservationId,'fine-original');assert.equal(JSON.stringify(q),before);
 for(const change of [x=>x.rival.sources.pop(),x=>x.rival.sources[0].rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']='other-order',x=>x.rival.sources[0].paymentChannel='\u5efa\u8bbe\u94f6\u884c(9999)',x=>x.rival.sources[0].rawFields['\u4ea4\u6613\u5206\u7c7b']='Other service',x=>x.rival.sources[1].rawFields.tradeDate='2026-09-30',x=>x.rival.sources[1].bankStatement.nonCash=true,x=>x.rival.sources[1].description='Other collector',x=>x.rival.sources[0].status='failed']){const x=telecomAndFine();change(x);assert.equal(run([x.r],[x.t,x.rival],{accounts:x.accounts}).matches.length,0,String(change));}
 const x=telecomAndFine();assert.equal(run([x.r],[x.t,x.rival,transaction('unknown-rival')],{accounts:x.accounts}).matches.length,0,'an additional unproved competitor still blocks uniqueness');
});
