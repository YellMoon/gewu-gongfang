'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('./testFixtures/nativeMerchantServiceFee'),{buildFinanceView}=require('./ledger'),{validateNativeMerchantFeeAllocation:validate}=require('./nativeMerchantServiceFees');
test('the original large-gateway service fee uses its printed amount and shop bearer even when it is not one percent of the receipt',()=>{
 const l=fixture(),parent=l.observations.find(o=>o.id==='order'),credit=l.observations.find(o=>o.id==='credit'),fee=l.observations.find(o=>o.id==='fee');parent.amountMinor='17464';parent.rawFields['\u91d1\u989d']='174.64';credit.balanceEvidence.incomeMinor='17464';credit.balanceMinor='17464';Object.assign(credit.rawFields,{'\u6536\u5165':'174.64','\u8d26\u6237\u4f59\u989d':'174.64'});fee.description=fee.description.replace('\u5feb\u6377\u652f\u4ed8','\u5927\u989d\u7f51\u5173');fee.rawFields['\u540d\u79f0\u5907\u6ce8']=fee.description;fee.balanceEvidence.expenseMinor='158';fee.balanceMinor='17306';Object.assign(fee.rawFields,{'\u652f\u51fa':'-1.58','\u8d26\u6237\u4f59\u989d':'173.06'});const before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='fee');assert(t);assert.equal(t.amountMinor,'158');assert.equal(t.nativeMerchantServiceFee.parentCashReceiptMinor,'17464');assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');assert.deepEqual(t.cashEffects,{wallet:'-158'});assert.deepEqual(t.balanceEffects,{family:'158',wallet:'-158'});assert.equal(v.currencyTotals.CNY.cashInMinor,'17464');assert.equal(v.currencyTotals.CNY.cashOutMinor,'158');assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),before);
});
test('a large-gateway title still requires its exact receipt prefix and an authorized fee bearer',()=>{
 for(const mutate of [l=>l.observations.find(o=>o.id==='fee').description=l.observations.find(o=>o.id==='fee').description.replace('201401011100100195','201401011100100196'),l=>l.annotations[0].patch.settlementAccountId='another',l=>l.annotations[1].patch.kind='expense',l=>l.links.push({type:'distinct',observationIds:['fee','credit']}),l=>l.observations.push({...l.observations.find(o=>o.id==='order'),id:'competing-order',sourceIdentity:'competing-order'})]){const l=fixture(),fee=l.observations.find(o=>o.id==='fee');fee.description=fee.description.replace('\u5feb\u6377\u652f\u4ed8','\u5927\u989d\u7f51\u5173');fee.rawFields['\u540d\u79f0\u5907\u6ce8']=fee.description;mutate(l);assert.throws(()=>validate(fee,l.annotations[1],l),/NATIVE_MERCHANT_FEE_ALLOCATION_INVALID/,String(mutate));}
});
test('native service fee lowers the shop payable, never personal spending, while raw zero-face proof remains intact',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='fee');assert.equal(JSON.stringify(l),raw);assert(t);
 assert.equal(t.amountMinor,'100');assert.equal(t.kind,'transfer');assert.equal(t.direction,'debit');assert.equal(t.consumptionMinor,t.incomeMinor);assert.equal(t.consumptionMinor,'0');assert.deepEqual(t.balanceEffects,{family:'100',wallet:'-100'});assert.deepEqual(t.cashEffects,{wallet:'-100'});assert.equal(t.sources[0].amountMinor,'0');assert.equal(t.sources[0].direction,'neutral');assert(t.sources[0].balanceEvidence);
 assert.equal(t.nativeMerchantServiceFee.parentObservationId,'order');assert.equal(t.nativeMerchantServiceFee.parentCashReceiptProofId,'credit');assert.equal(t.nativeMerchantServiceFee.ownerAnnotationId,'fee-bearer');assert(t.nativeMerchantServiceFee.reversible);assert.equal(t.cashPostingEvidence[0].proofObservationId,'fee');assert.equal(t.cashPostingEvidence[0].deltaMinor,'-100');
 assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.currencyTotals.CNY.cashInMinor,'10000');assert.equal(v.currencyTotals.CNY.cashOutMinor,'100');assert.equal(v.review.transactionCount,0);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);
 assert.equal(buildFinanceView(l,{accountIds:['family']}).currencyTotals.CNY.cashOutMinor,'0');assert.equal(buildFinanceView(l,{accountIds:['wallet']}).currencyTotals.CNY.cashOutMinor,'100');
});
test('reset reverses fee materialization and restores the independent balance discrepancy',()=>{
 const l=fixture();l.annotations.push({id:'undo',observationId:'fee',revision:'3',reset:true});const v=buildFinanceView(l);assert(!v.transactions.some(t=>t.id==='fee'));assert.equal(v.currencyTotals.CNY.cashOutMinor,'0');assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,1);
});
test('cash, exact merchant order, existing owner purpose, fee bearer and vetoes are jointly required',()=>{
 for(const change of[
  x=>x.observations.find(o=>o.id==='fee').balanceEvidence.expenseMinor='101',
  x=>x.observations.find(o=>o.id==='credit').rawFields['\u8d44\u91d1\u6e20\u9053']='Other',
  x=>x.observations.find(o=>o.id==='order').sourceTransactionId+='1',
  x=>x.annotations[0].patch.settlementAccountId='another',
  x=>x.annotations[0].reset=true,
  x=>x.annotations[1].patch.kind='expense',
  x=>x.annotations[1].patch.amountMinor='999',
  x=>x.accounts.find(a=>a.id==='family').type='wallet',
  x=>x.links.push({id:'veto',status:'active',type:'distinct',observationIds:['fee','credit']}),
  x=>x.observations.push({...x.observations.find(o=>o.id==='order'),id:'another',sourceIdentity:'another'}),
  x=>x.observations.find(o=>o.id==='order').relatedReference='not-a-shop-order'
 ]){const l=fixture();change(l);assert.throws(()=>validate(l.observations.find(o=>o.id==='fee'),l.annotations[1],l),/NATIVE_MERCHANT_FEE_ALLOCATION_INVALID/,change.toString());}
});
test('a partial original merchant receipt authorizes its actual fee only and never invents the missing gross receipt',()=>{
 const l=fixture(),p=l.observations.find(o=>o.id==='order');p.amountMinor='20000';p.rawFields['\u91d1\u989d']='200.00';
 const d=validate(l.observations.find(o=>o.id==='fee'),l.annotations[1],l);assert.equal(d.amountMinor,'100');assert(d.nativeMerchantServiceFee.partialReceiptDoesNotAssertGrossWasPaid);assert.equal(d.nativeMerchantServiceFee.originalExportOrderGrossMinor,'20000');assert.equal(d.nativeMerchantServiceFee.parentCashReceiptMinor,'10000');
});
