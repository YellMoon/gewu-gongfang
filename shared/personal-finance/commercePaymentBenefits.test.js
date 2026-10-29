'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView}=require('./ledger'),{commercePaymentBenefit,findCommercePaymentBenefits}=require('./commercePaymentBenefits');

function fixture(global=false){
 const date='2024-07-14',time=date+'T00:24:29+08:00',cardProvider=global?'\u5174\u4e1a\u94f6\u884c':'\u5e7f\u53d1\u94f6\u884c',provider=global?'cib':'cgb',channel=global?'\u4e91\u95ea\u4ed8':'\u94f6\u8054\u652f\u4ed8',description=global?'\u5168\u7403\u8d2d-Console':'Paper',merchant='\u4eac\u4e1c\u5e73\u53f0\u5546\u6237',bankMerchant=global?'\u7f51\u94f6\u56fd\u9645\u8d2dInternational':'(\u6d88\u8d39)\u4eac\u4e1c\u5546\u57ce\u5e73\u53f0\u5546\u6237';
 const common={date,occurredAt:time,currency:'CNY',status:'completed',kind:'expense',direction:'debit',principalMinor:null,interestMinor:null,feeMinor:null,paymentAccountHint:'',relatedReference:'',balanceMinor:null,category:'Daily',sourceVersionOrdinal:1};
 const p={...common,id:'p',sourceIdentity:'p',sourceTransactionId:'jd-order',provider:'jd',financialAccountId:'jd',amountMinor:'13356',description,counterparty:merchant,paymentChannel:channel,rawFields:{'\u4ea4\u6613\u8ba2\u5355\u53f7':'249397730304','\u4ea4\u6613\u65f6\u95f4':date+' 00:24:29','\u4ea4\u6613\u8bf4\u660e':description,'\u5546\u6237\u540d\u79f0':merchant,'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':channel,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u6536/\u652f':'\u652f\u51fa','\u91d1\u989d':'133.56'}};
 const b={...common,id:'b',sourceIdentity:'b',sourceTransactionId:'bank-order',provider,financialAccountId:'card',amountMinor:'13348',occurredAt:date+'T23:59:59+08:00',description:bankMerchant,counterparty:bankMerchant,paymentChannel:'',bankAccount:{provider:cardProvider,type:'credit_card',maskedIdentifier:'1235',currency:'CNY'},bankStatement:{schema:'bank-credit-v1',provider,cardTail:'1235',nonCash:false,statementDate:'2024-07-25',postedDate:date},rawFields:{cardTail:'1235',tradeDate:date,dateBasis:'transaction_date',statementCredit:false,statementAmountMinor:'13348',excludedFromBilledTotal:false,...(global?{sourceTradeDateTime:date+' 00:24'}:{})}};
 const ann={id:'confirmed',observationId:'p',revision:'1',patch:{commercePayment:{schema:'commerce-payment-v1',bankObservationId:'b',discountMinor:'8',basis:'owner_confirmed_credit_payment_benefit'}}};
 return {accounts:[{id:'jd',provider:'jd',type:'wallet',label:'JD',currency:'CNY',status:'active'},{id:'card',provider:cardProvider,type:'credit_card',maskedIdentifier:'1235',label:'Credit 1235',currency:'CNY',status:'active'}],observations:[p,b],annotations:[ann],links:[],imports:[],balanceSnapshots:[]};
}
const plans=l=>findCommercePaymentBenefits(l.observations,l.accounts,{annotations:new Map(l.annotations.map(a=>[a.observationId,a])),links:l.links});
const hasTrace=l=>buildFinanceView(l).transactions.some(t=>t.automaticAssociations.some(a=>a.method==='owner_confirmed_commerce_payment_benefit'));

test('confirmed order discount counts actual card payment once and preserves both originals',()=>{
 for(const global of [false,true]){
  const l=fixture(global),before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions[0];
  assert.equal(v.transactions.length,1);assert.equal(v.review.transactionCount,0);assert.equal(t.amountMinor,'13348');assert.equal(t.consumptionMinor,'13348');assert.equal(t.incomeMinor,'0');assert.deepEqual(t.balanceEffects,{card:'-13348'});assert.deepEqual(t.cashEffects,{});assert.deepEqual(t.reportingAccountIds,['card']);assert.equal(t.description,l.observations[0].description);assert.equal(t.category,'Daily');assert.equal(t.automaticAssociations.find(a=>a.method==='owner_confirmed_commerce_payment_benefit').evidence.paymentDifferenceMinor,'8');assert.deepEqual(t.sources,l.observations);assert.equal(JSON.stringify(l),before);
 }
});
test('small differences require an explicit confirmation and reset restores the pending records',()=>{
 const l=fixture();l.annotations=[];assert.equal(hasTrace(l),false);assert.equal(buildFinanceView(l).transactions.length,2);
 l.annotations=fixture().annotations;l.annotations.push({id:'reset',observationId:'p',revision:'2',patch:{},reset:true});assert.equal(hasTrace(l),false);
});
test('invalid identity, amounts, native source or unproven global merchant is rejected',()=>{
 const changes=[l=>l.annotations[0].patch.commercePayment.discountMinor='9',l=>l.annotations[0].patch.commercePayment.discountMinor='0',l=>l.annotations[0].patch.commercePayment.basis='guessed',l=>l.annotations[0].patch.commercePayment.extra='x',l=>l.observations[0].rawFields['\u91d1\u989d']='133.55',l=>l.observations[0].rawFields['\u4ea4\u6613\u65f6\u95f4']='wrong',l=>l.observations[0].rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']='x',l=>l.observations[0].paymentChannel='Other',l=>l.observations[0].accountRelations=[{role:'funding'}],l=>l.annotations[0].patch.kind='transfer',l=>l.annotations[0].patch.feeMinor='1',l=>l.observations.pop(),l=>l.accounts[1].status='archived',l=>l.accounts[1].type='debit_card',l=>l.accounts[1].currency='USD',l=>l.observations[1].bankStatement.nonCash=true,l=>l.observations[1].rawFields.statementAmountMinor='13356',l=>l.observations[1].rawFields.cardTail='9999',l=>l.observations[1].rawFields.tradeDate='2024-07-15',l=>l.observations[1].rawFields.dateBasis='posting_date',l=>l.observations[1].description=l.observations[1].counterparty='Other merchant',l=>l.observations[1].rawFields.sourceTradeDateTime='2024-07-14 00:25',l=>l.observations[1].bankAccount.provider='Other bank'];
 for(const[i,change]of changes.entries()){const l=fixture();change(l);assert.throws(()=>commercePaymentBenefit(l.observations[0],l.annotations[0],l.accounts,l.observations),/COMMERCE_PAYMENT_INVALID/,'case '+i);}
 for(const change of [l=>delete l.observations[1].rawFields.sourceTradeDateTime,l=>l.observations[0].description='Domestic order']){const l=fixture(true);change(l);assert.throws(()=>commercePaymentBenefit(l.observations[0],l.annotations[0],l.accounts,l.observations),/COMMERCE_PAYMENT_INVALID/);}
});
test('vetoes, old-version decisions and double use of the same payment block association',()=>{
 for(const link of [{type:'distinct',observationIds:['p','b']},{type:'group_distinct',observationIds:['b','other']},{type:'duplicate',status:'deleted',observationIds:['p','b']}]){const l=fixture();l.links=[link];assert.equal(plans(l).length,0);}
 const old=fixture();old.observations.push({...old.observations[1],id:'old-b',sourceVersionOrdinal:0});old.annotations.push({id:'old-owner',observationId:'old-b',revision:'2',patch:{category:'Owner choice'}});assert.equal(plans(old).length,0);
 const both=fixture();both.observations.push({...both.observations[0],id:'other-order',sourceIdentity:'other-order'});both.annotations.push({...both.annotations[0],id:'second',observationId:'other-order'});assert.equal(plans(both).length,0);
 const occupied=fixture();occupied.observations.push({...occupied.observations[1],id:'unrelated',sourceIdentity:'unrelated'});assert.equal(findCommercePaymentBenefits(occupied.observations,occupied.accounts,{annotations:new Map([['p',occupied.annotations[0]]]),rootOf:id=>id==='unrelated'?'b':id}).length,0);
});
test('cloud annotation validates only the current owner ledger and supports full reset',async()=>{
 const {createPersonalFinanceRepository}=require('../../cloud-business-api/src/personalFinanceRepository'),l=fixture(),source=l.observations[0],owned={accounts:l.accounts,observations:l.observations};let saved;
 const q=async(sql,values)=>{
  if(sql.startsWith('SELECT revision'))return{rows:[{revision:'0'}]};
  if(sql.startsWith('UPDATE business.personal_finance_owners'))return{rows:[{revision:'1'}]};
  if(sql.startsWith('SELECT data FROM business.personal_finance_observations')){assert.deepEqual(values,['test','alice','p']);return{rows:[{data:source}]};}
  if(sql.startsWith('SELECT data FROM business.personal_finance_accounts'))return{rows:[{data:l.accounts[0]}]};
  if(sql.startsWith('SELECT jsonb_build_object')){assert.deepEqual(values,['test','alice']);return{rows:[{ledger:owned}]};}
  if(sql.startsWith('INSERT INTO business.personal_finance_annotations'))saved=JSON.parse(values[5]);
  return{rows:[]};
 };
 const repo=createPersonalFinanceRepository({query:q,transaction:async work=>work(q),parseBillFile:()=>({})}),input={tenantId:'test',actor:{accountId:'alice',roles:['teacher']},observationId:'p',patch:l.annotations[0].patch};
 await repo.annotateObservation(input);assert.deepEqual(saved.patch.commercePayment,input.patch.commercePayment);
 owned.observations=[source];await assert.rejects(repo.annotateObservation(input),/COMMERCE_PAYMENT_INVALID/);
 owned.observations=l.observations;owned.accounts=l.accounts.slice(0,1);await assert.rejects(repo.annotateObservation(input),/COMMERCE_PAYMENT_INVALID/);
 owned.accounts=l.accounts;l.accounts[1].status='archived';await assert.rejects(repo.annotateObservation(input),/COMMERCE_PAYMENT_INVALID/);l.accounts[1].status='active';
 await repo.annotateObservation({...input,patch:{}});assert.equal(saved.reset,true);
});
