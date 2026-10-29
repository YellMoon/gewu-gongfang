'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement'),{planNativeGroupedBankTopUps:plan,appendNativeGroupedBankTopUps:apply}=require('./nativeGroupedBankTopUps');
function fixture(){
 const wallet={id:'wallet',label:'Alipay',provider:'alipay',type:'wallet',status:'active',currency:'CNY'},bank={id:'bank',label:'CCB6943',provider:'\u5efa\u8bbe\u94f6\u884c',type:'debit_card',maskedIdentifier:'6943',status:'active',currency:'CNY'};
 const base={date:'2015-11-20',currency:'CNY',status:'completed',sourceVersionOrdinal:1,paymentAccountHint:'',relatedReference:'',feeMinor:null,interestMinor:null,principalMinor:null,balanceMinor:null};
 const banks=[1,2].map((n)=>({...base,id:'bank'+n,sourceIdentity:'bank'+n,sourceTransactionId:'ccb-debit:'+n,financialAccountId:'bank',provider:'ccb',importId:'statement',kind:'expense',direction:'debit',amountMinor:'50000',description:'\u6d88\u8d39 \u652f\u4ed8\u5b9d',counterparty:'',category:'\u6d88\u8d39',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361(6943)',occurredAt:base.date+'T23:59:59+08:00',statementFlow:{schema:'ccb-debit-v1',sequence:n,incomeMinor:'0',expenseMinor:'50000',balanceKind:'total',timePrecision:'day',periodStart:base.date,periodEnd:base.date},rawFields:{'\u5e8f\u53f7':String(n),'\u6458\u8981':'\u6d88\u8d39','\u4ea4\u6613\u5730\u70b9/\u9644\u8a00':'\u652f\u4ed8\u5b9d','\u4ea4\u6613\u65e5\u671f':'20151120','\u4ea4\u6613\u91d1\u989d':'-500.00','\u8d26\u6237\u4f59\u989d':'0.00'}}));
 const description='\u5145\u503c-\u666e\u901a\u5145\u503c',ref='20151120200040011100250075919167',order={...base,id:'order',sourceIdentity:'order',sourceTransactionId:ref,financialAccountId:'wallet',provider:'alipay',kind:'transfer',direction:'neutral',amountMinor:'50000',description,counterparty:'**\u9ec4',category:'\u8f6c\u8d26\u7ea2\u5305',paymentChannel:'',occurredAt:base.date+'T15:59:51+08:00',rawFields:{'\u91d1\u989d':'500.00','\u4ea4\u6613\u8ba2\u5355\u53f7':ref,'\u4ea4\u6613\u65f6\u95f4':'2015-11-20 15:59:51','\u5546\u54c1\u8bf4\u660e':description,'\u4ea4\u6613\u5bf9\u65b9':'**\u9ec4','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f'}};
 const parsed=parseAlipayWalletBalanceRows([['2015112000000176***55','2015-11-20 16:11:15','\u5145\u503c\u4ea4\u6613\u6210\u529f','500.00','','1000.00','\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c',''],['2015112000000176***75','2015-11-20 16:03:29','\u5145\u503c\u4ea4\u6613\u6210\u529f','500.00','','500.00','\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c','']]);assert.deepEqual(parsed.errors,[]);
 const proofs=parsed.records.map((o,i)=>({...o,id:'proof'+i,sourceIdentity:'proof'+i,sourceVersionOrdinal:1,importId:'native',financialAccountId:'wallet',provider:'alipay'}));
 const l={accounts:[wallet,bank],observations:[...banks,order,...proofs],imports:[{id:'statement',provider:'ccb',financialAccountId:'bank',fileHash:'a'.repeat(64),statementOwner:{schema:'bank-statement-owner-v1',fullName:'\u6d4b\u8bd5\u7528\u6237'},observationIds:banks.map(o=>o.id)}],annotations:[],links:[],balanceSnapshots:[]};
 const root=(o,id,delta)=>({...o,observationIds:[o.id],sources:[o],financialAccountIds:[o.financialAccountId],selectedObservationIds:[o.id],reportingAccountIds:[o.financialAccountId],consumptionMinor:o.kind==='expense'?50000n:0n,selectedConsumptionMinor:o.kind==='expense'?50000n:0n,incomeMinor:0n,selectedIncomeMinor:0n,balanceEffects:{[id]:delta},cashEffects:{[id]:delta},balanceEffectTimes:{[id]:o.occurredAt},automaticAssociations:[],appliedAnnotations:[]});
 const tx=[...banks.map(o=>root(o,'bank',-50000n)),{...root(order,'wallet',50000n),walletTopupReceipt:{sourceAccountKnown:false,amountMinor:'50000'}}],issues=[{reason:'unresolved_account_movement',observationId:'order',basis:'native_wallet_receipt_source_unknown',receivingAccountId:'wallet'},{reason:'other_unresolved',observationId:'order'}];
 return{l,tx,issues,banks,order,proofs};
}
test('whole group removes duplicate consumption while preserving bank legs and raw originals',()=>{
 const {l,tx,issues}=fixture(),snapshot=JSON.stringify(l);assert.equal(plan(l,tx).length,1);
 apply(l,tx,new Set(['wallet','bank']),issues,(derived,opts)=>buildFinanceView(derived,opts).transactions.map(t=>({...t,balanceEffects:Object.fromEntries(Object.entries(t.balanceEffects).map(([k,v])=>[k,BigInt(v)])),cashEffects:Object.fromEntries(Object.entries(t.cashEffects).map(([k,v])=>[k,BigInt(v)])),consumptionMinor:BigInt(t.consumptionMinor),incomeMinor:BigInt(t.incomeMinor)})));
 assert.equal(tx.length,5);assert.equal(JSON.stringify(l),snapshot);assert.deepEqual(issues,[{reason:'other_unresolved',observationId:'order'}]);
 assert.equal(tx.reduce((n,t)=>n+BigInt(t.consumptionMinor),0n),0n);assert.equal(tx.reduce((n,t)=>n+BigInt(t.balanceEffects.bank||0),0n),-100000n);assert.equal(tx.reduce((n,t)=>n+BigInt(t.balanceEffects.wallet||0),0n),100000n);
 for(const t of tx){assert.equal(t.kind,'transfer');assert.equal(t.nativeGroupedBankTopUp.individualBankReceiptIdentity,'undetermined_within_group');assert.equal(t.nativeGroupedBankTopUp.exportOrderReceiptIdentity,'undetermined_within_group');assert.equal(t.nativeGroupedBankTopUp.exportOrderCount,1);assert(t.nativeGroupedBankTopUp.reversible);}
 for(const t of tx.filter(t=>t.id.startsWith('bank'))){assert.equal(t.occurredAt,'2015-11-20T23:59:59+08:00');assert.equal(t.sources[0].kind,'expense');assert.equal(t.balanceEffects.bank,-50000n);}
 for(const t of tx.filter(t=>t.id.startsWith('proof'))){assert.equal(t.sources[0].amountMinor,'0');assert.equal(t.sources[0].balanceEvidence.incomeMinor,'50000');assert(!t.balanceEffects.bank);}
 const order=tx.find(t=>t.id==='order');assert.equal(order.balanceEffects.wallet,0n);assert(order.nativeGroupedBankTopUpOriginalReceipt);assert.equal(order.walletTopupReceipt,undefined);assert(order.automaticFunding.groupAccountIdentificationOnly);
});
test('actual ledger integration changes only inferred consumption and wallet cash, selection remains correct',()=>{
 const {l}=fixture(),snapshot=JSON.stringify(l),v=buildFinanceView(l),bank=buildFinanceView(l,{accountIds:['bank']}),wallet=buildFinanceView(l,{accountIds:['wallet']});
 assert.equal(JSON.stringify(l),snapshot);assert.equal(v.transactions.filter(t=>t.nativeGroupedBankTopUp).length,5);assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert.equal(bank.currencyTotals.CNY.consumptionMinor,'0');assert.equal(wallet.currencyTotals.CNY.consumptionMinor,'0');assert(!v.unresolvedAssociations.some(i=>i.basis==='native_wallet_receipt_source_unknown'));assert.equal(plan(l,v.transactions).length,0);
});
test('incomplete bank/native counts, owner conflicts, edited and claimed originals stay unresolved',()=>{
 const changes=[
  x=>x.l.observations.splice(x.l.observations.findIndex(o=>o.id==='bank2'),1),
  x=>x.l.observations.push({...x.banks[0],id:'extra',sourceIdentity:'extra'}),
  x=>x.l.observations.push({...x.banks[0],id:'other',sourceIdentity:'other',financialAccountId:'another'}),
  x=>x.l.observations.find(o=>o.id==='bank2').statementFlow.expenseMinor='49999',
  x=>x.l.imports[0].statementOwner.fullName='*',
  x=>x.l.annotations.push({observationId:'bank1'}),
  x=>x.l.annotations.push({observationId:'order'}),
  x=>x.l.links.push({observationIds:['proof0','order'],type:'duplicate',status:'deleted'}),
  x=>x.tx[0].automaticAssociations.push({method:'another'}),
  x=>x.tx[0].cashPostingEvidence=[{proofObservationId:'proof0'}],
  x=>x.proofs[0].rawFields['\u8d44\u91d1\u6e20\u9053']='\u4e2d\u56fd\u519c\u4e1a\u94f6\u884c',
  x=>x.proofs[0].balanceMinor='99999',
  x=>x.order.paymentChannel='\u5efa\u8bbe\u94f6\u884c',
  x=>x.order.occurredAt='2015-11-20T15:00:00+08:00',
  x=>x.l.observations.push({...x.order,id:'order2',sourceIdentity:'order2'}),
  x=>x.l.accounts[1].type='credit_card'
 ];
 for(const mutate of changes){const x=fixture();mutate(x);assert.equal(plan(x.l,x.tx).length,0,mutate.toString());}
});
test('two exported orders may participate only when both complete raw receipts remain eligible',()=>{
 const x=fixture(),order={...structuredClone(x.order),id:'order2',sourceIdentity:'order2',sourceTransactionId:'20151120200040011100250075919168'};order.rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']=order.sourceTransactionId;
 x.l.observations.push(order);x.tx.push({...x.tx[2],...order,observationIds:[order.id],sources:[order]});assert.equal(plan(x.l,x.tx).length,1);
});

function singleMissingOrderFixture(){
 const x=fixture();x.l.observations=[x.banks[0],x.proofs[0]];x.l.imports[0].observationIds=[x.banks[0].id];x.tx=[x.tx[0]];x.issues=[];return x;
}
test('one unique bank debit and original wallet recharge restore a missing export without inventing an order or another bank leg',()=>{
 const {l}=singleMissingOrderFixture(),raw=JSON.stringify(l);assert.equal(plan(l,[{...l.observations[0],observationIds:['bank1'],sources:[l.observations[0]],consumptionMinor:50000n,incomeMinor:0n,balanceEffects:{bank:-50000n},cashEffects:{bank:-50000n},automaticAssociations:[],appliedAnnotations:[]}]).length,1);
 const v=buildFinanceView(l);assert.equal(v.transactions.length,2);assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.currencyTotals.CNY.netCashFlowMinor,'0');assert.equal(v.review.transactionCount,0);
 const debit=v.transactions.find(t=>t.id==='bank1'),credit=v.transactions.find(t=>t.id==='proof0');assert.equal(debit.kind,'transfer');assert.deepEqual(debit.balanceEffects,{bank:'-50000'});assert.deepEqual(credit.balanceEffects,{wallet:'50000'});assert.equal(debit.occurredAt,'2015-11-20T23:59:59+08:00');assert.equal(credit.occurredAt,'2015-11-20T16:03:29+08:00');assert.equal(debit.sources[0].kind,'expense');assert.equal(credit.sources[0].amountMinor,'0');assert.equal(credit.nativeGroupedBankTopUp.exportOrderCount,0);assert.equal(credit.nativeGroupedBankTopUp.missingExportOrderNotInvented,true);assert.equal(credit.nativeGroupedBankTopUp.individualBankReceiptIdentity,'inferred_unique_bank_and_wallet_cash');assert.equal(credit.nativeGroupedBankTopUp.exportOrderReceiptIdentity,'missing_export_order');assert.equal(JSON.stringify(l),raw);assert.equal(plan(l,v.transactions).length,0);
});
test('single missing-order inference rejects extra bank cash, an existing export, original wallet receipts, claims and owner decisions',()=>{
 for(const change of[x=>x.l.observations.push(x.banks[1]),x=>{x.l.observations.push(x.order);x.tx.push(fixture().tx[2]);},x=>x.l.imports[0].statementOwner.fullName='*',x=>x.l.annotations.push({observationId:'proof0'}),x=>x.l.annotations.push({observationId:'bank1'}),x=>x.l.links.push({type:'distinct',observationIds:['proof0','bank1']}),x=>x.tx[0].automaticAssociations.push({method:'already-linked'}),x=>x.tx[0].cashPostingEvidence=[{proofObservationId:'proof0'}],x=>x.l.accounts[1].type='credit_card',x=>x.tx.push({id:'other-receipt',date:'2015-11-20',currency:'CNY',balanceEffects:{wallet:'50000'},cashEffects:{wallet:'50000'}}),x=>x.tx.push({id:'other-bridge',date:'2015-11-20',currency:'CNY',balanceEffects:{wallet:'0'},balanceEffectEvents:{wallet:[{occurredAt:'2015-11-20T16:00:00+08:00',deltaMinor:'50000'}]}})]){const x=singleMissingOrderFixture();change(x);assert.equal(plan(x.l,x.tx).length,0,change.toString());}
});
