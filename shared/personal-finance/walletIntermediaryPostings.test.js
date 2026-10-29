'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
const {buildFinanceView}=require('./ledger');
const {findWalletIntermediaryPostings,withWalletIntermediaryPostings}=require('./walletIntermediaryPostings');
function interleavedWithdrawalFixture(){
 const date='2015-08-12',ccb='\u5efa\u8bbe\u94f6\u884c',yeb='\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u94f6\u884c\u5361',accounts=[{id:'wallet',provider:'alipay',type:'wallet',currency:'CNY',status:'active'},{id:'fund',provider:'alipay',type:'investment',sourceProduct:'alipay_yuebao',currency:'CNY',status:'active'},{id:'bank',provider:ccb,type:'debit_card',maskedIdentifier:'6943',currency:'CNY',status:'active'},{id:'card',provider:'\u5e7f\u53d1\u94f6\u884c',type:'credit_card',maskedIdentifier:'9755',currency:'CNY',status:'active'}];
 const s={id:'withdrawal',sourceIdentity:'withdrawal',sourceVersionOrdinal:1,provider:'alipay',financialAccountId:'wallet',date,occurredAt:date+'T11:42:30+08:00',currency:'CNY',amountMinor:'1000000',status:'completed',kind:'transfer',direction:'neutral',sourceTransactionId:'original-withdrawal-order',description:yeb,counterparty:ccb,accountRelations:[{product:'alipay_yuebao',activity:'investment_withdrawal',role:'target',financialAccountId:'fund'}],rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' 11:42:30','\u4ea4\u6613\u8ba2\u5355\u53f7':'original-withdrawal-order','\u5546\u54c1\u8bf4\u660e':yeb,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u91d1\u989d':'10000.00'}};
 const b={id:'receipt',sourceIdentity:'receipt',sourceVersionOrdinal:1,provider:'ccb',financialAccountId:'bank',date,occurredAt:date+'T23:59:59+08:00',currency:'CNY',amountMinor:'1000000',status:'completed',direction:'credit',paymentChannel:ccb+'\u50a8\u84c4\u5361(6943)',statementFlow:{schema:'ccb-debit-v1',incomeMinor:'1000000',expenseMinor:'0'},rawFields:{dateBasis:'transaction_date','\u4ea4\u6613\u65e5\u671f':'20150812','\u4ea4\u6613\u91d1\u989d':'10,000.00'}};
 const rows=[['20150812000251052500476***02',date+' 11:42:31','\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u63d0\u73b0\u5230\u5361','10000.00','','11000.00','\u5929\u5f18\u57fa\u91d1',''],['top1',date+' 11:52:26','\u5145\u503c','22.00','','11022.00',ccb,''],['pay1',date+' 11:52:27','\u8f6c\u8d26\u8f6c\u8d26','','-22.00','11000.00','\u652f\u4ed8\u5b9d',''],['top2',date+' 11:58:35','\u5145\u503c','16.00','','11016.00','\u5e7f\u53d1\u94f6\u884c',''],['pay2',date+' 11:58:35','\u652f\u4ed8-\u9910\u8d39','','-16.00','11000.00','\u652f\u4ed8\u5b9d',''],['1504081247762542511',date+' 11:59:16','\u63d0\u73b0','','-10000.00','1000.00',ccb,'']];
 const parsed=parseAlipayWalletBalanceRows(rows.map(row=>[row[0].padEnd(6,'0'),...row.slice(1)]).reverse());assert.deepEqual(parsed.errors,[]);const native=parsed.records.map((o,i)=>({...o,id:'native'+i,sourceIdentity:'native'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'}));
 const evidence={financialAccountId:'bank',date,bankDate:date,amountMinor:'1000000',currency:'CNY',bankDirection:'credit',reciprocalUnique:true,evidenceObservationIds:['receipt']};
 const t={id:s.id,kind:'transfer',currency:'CNY',sources:[s,b],observationIds:[s.id,b.id],consumptionMinor:'0',incomeMinor:'0',financialAccountIds:['wallet','fund','bank'],balanceEffects:{fund:'-1000000',bank:'1000000'},cashEffects:{fund:'-1000000',bank:'1000000'},balanceEffectTimes:{fund:s.occurredAt,bank:b.occurredAt},automaticAssociations:[{method:'source_statement_legacy_product',confidence:'inferred',observationIds:[s.id,b.id],evidence}]};
 const plans=new Map(),transactions=[t],observations=[s,b,...native];
 for(const[i,amount,payer]of[[1,'2200','bank'],[2,'1600','card']]){const source={id:'purchase'+i,sourceIdentity:'purchase'+i,sourceVersionOrdinal:1,sourceTransactionId:('pay'+i).padEnd(6,'0'),provider:'alipay',financialAccountId:'wallet',date,currency:'CNY',status:'completed'};observations.push(source);transactions.push({id:source.id,kind:'expense',consumptionMinor:amount,incomeMinor:'0',sources:[source],balanceEffects:{[payer]:'-'+amount},cashEffects:payer==='bank'?{[payer]:'-'+amount}:{}});const pair=native.slice(i===1?1:3,i===1?3:5);plans.set(source.id,[{method:'native_wallet_intermediary_postings',path:'known_bank_top_up_and_order_payment',cashEvidenceConfidence:'explicit_original_cash_postings',financialAccountId:'wallet',sourceObservationId:source.id,payerAccountId:payer,amountMinor:amount,netDeltaMinor:'0',proofObservationIds:pair.map(o=>o.id),events:pair.map((o,j)=>({observationId:o.id,occurredAt:o.occurredAt,date,deltaMinor:j?'-'+amount:amount}))}]);}
 return{t,transactions,observations,accounts,plans};
}
function delayedWithdrawalFixture(overnight=true,keepMiddle=false){
 const f=interleavedWithdrawalFixture(),credit=f.observations.find(o=>o.id==='native0'),debit=f.observations.find(o=>o.id==='native5'),bank=f.observations[1],source=f.observations[0];
 if(!keepMiddle){f.observations=f.observations.filter(o=>!/^native[1-4]$/.test(o.id));debit.balanceEvidence.sequence=2;f.plans.clear();}
 const date=overnight?'2015-08-13':source.date;debit.date=date;debit.occurredAt=date+(overnight?'T11:00:00+08:00':'T17:00:00+08:00');debit.rawFields['\u65f6\u95f4']=date+debit.occurredAt.slice(11,19);debit.rawFields.sourceTableCells[1]=date+' '+debit.occurredAt.slice(11,19);
 bank.date=date;bank.occurredAt=date+'T23:59:59+08:00';bank.rawFields['\u4ea4\u6613\u65e5\u671f']=date.replace(/-/g,'');f.t.balanceEffectTimes.bank=bank.occurredAt;
 if(overnight){const a=f.t.automaticAssociations[0];a.method='source_named_product_bank_receipt';a.evidence={product:'alipay_yuebao',productAccountId:'fund',financialAccountId:'bank',bankCardTail:'6943',date:source.date,bankReceiptDate:date,amountMinor:source.amountMinor,currency:'CNY',sourceProductNamed:true,bankChannel:'alipay',bankDateBasis:'transaction_date',reciprocalUnique:true,sourceObservationIds:['withdrawal','receipt'],settlementLagDays:1};}
 else{const name='\u676d\u5dde\u94f6\u884c';f.accounts.find(a=>a.id==='bank').provider=name;source.counterparty=name;bank.provider='hangzhou';bank.paymentChannel='';bank.bankAccount={provider:name,type:'debit_card',maskedIdentifier:'6943',currency:'CNY'};bank.statementFlow.schema='hangzhou-debit-v1';bank.description='\u5361\u901a\u63d0\u73b0';bank.rawFields.description=bank.description;debit.rawFields['\u8d44\u91d1\u6e20\u9053']=name;debit.rawFields.sourceTableCells[6]=name;}
 return f;
}
test('overnight and delayed same-day withdrawals keep original fund/bank dates and expose actual per-day wallet cash',()=>{
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals;
 for(const overnight of[true,false]){const f=delayedWithdrawalFixture(overnight),raw=JSON.stringify(f.t);add(f.transactions,f.observations,f.accounts,f.plans);const p=f.plans.get(f.t.id);assert.equal(p.length,1);assert.equal(p[0].maskedRedemptionEvidence.nativeProofsAdjacent,true);const after=withWalletIntermediaryPostings(f.t,p);assert.equal(after.balanceEffectTimes.bank,f.t.balanceEffectTimes.bank);assert.equal(after.cashEffects.bank,'1000000');assert.equal(after.cashEffects.fund,'-1000000');assert.deepEqual(after.cashEffectEvents.wallet,overnight?[{date:'2015-08-12',deltaMinor:1000000n},{date:'2015-08-13',deltaMinor:-1000000n}]:[{date:'2015-08-12',deltaMinor:0n}]);assert.equal(JSON.stringify(f.t),raw);}
});
test('the full native withdrawal reference resolves a Hangzhou remittance while preserving its conflicting native channel label',()=>{
 function make(){const f=delayedWithdrawalFixture(false),bank=f.observations[1],debit=f.observations.find(o=>o.id==='native5');bank.description='\u6c47\u5151/\u4f59\u989d\u5b9d\u63d0\u73b0_'+debit.relatedReference;bank.rawFields.description=bank.description;bank.counterparty='\u652f\u4ed8\u5b9d\uff08\u4e2d\u56fd\uff09\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8\u5ba2\u6237\u5907\u4ed8\u91d1';bank.rawFields.counterparty=bank.counterparty;debit.rawFields['\u8d44\u91d1\u6e20\u9053']='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c';debit.rawFields.sourceTableCells[6]=debit.rawFields['\u8d44\u91d1\u6e20\u9053'];return f;}
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals,f=make(),raw=JSON.stringify({observations:f.observations,transactions:f.transactions});add(f.transactions,f.observations,f.accounts,f.plans);const b=f.plans.get(f.t.id)[0];assert.equal(b.maskedRedemptionEvidence.bankReceiptFullWithdrawalReference,f.observations.find(o=>o.id==='native5').relatedReference);assert.equal(b.maskedRedemptionEvidence.nativeChannelNamesAnotherBank,true);assert.equal(b.nativeChannelUsedToSelectReceivingAccount,false);assert.equal(JSON.stringify({observations:f.observations,transactions:f.transactions}),raw);
 for(const change of[f=>f.observations[1].description+='1',f=>f.observations[1].rawFields.description+='1',f=>f.observations[1].rawFields.counterparty='Other',f=>f.observations.find(o=>o.id==='native5').relatedReference+='1',f=>f.observations.push({...f.observations[1],id:'duplicate-bank',sourceIdentity:'duplicate-bank'}),f=>f.t.automaticAssociations[0].evidence.reciprocalUnique=false]){const x=make();change(x);add(x.transactions,x.observations,x.accounts,x.plans);assert.equal(x.plans.has(x.t.id),false,change.toString());}
});
function weekendWithdrawalFixture(){
 const f=delayedWithdrawalFixture(true,true),source=f.observations[0],bank=f.observations[1],oldDate=source.date,newDate='2015-08-14',receiptDate='2015-08-18';
 for(const o of f.observations){if(o.date===oldDate){o.date=newDate;if(o.occurredAt){const time=String(Number(o.occurredAt.slice(11,13))+5).padStart(2,'0')+o.occurredAt.slice(13,19);o.occurredAt=newDate+'T'+time+'+08:00';}}else if(o.date==='2015-08-13'){o.date=receiptDate;if(o.occurredAt)o.occurredAt=receiptDate+o.occurredAt.slice(10);}
  if(o.balanceEvidence){if(o.relatedReference.startsWith('20150812'))o.relatedReference='20150814'+o.relatedReference.slice(8);o.rawFields['\u6d41\u6c34\u53f7']=o.relatedReference;o.rawFields['\u65f6\u95f4']=o.date+o.occurredAt.slice(11,19);o.rawFields.sourceTableCells[0]=o.relatedReference;o.rawFields.sourceTableCells[1]=o.date+' '+o.occurredAt.slice(11,19);}
 }
 source.rawFields['\u4ea4\u6613\u65f6\u95f4']=source.date+' '+source.occurredAt.slice(11,19);bank.rawFields['\u4ea4\u6613\u65e5\u671f']=bank.date.replace(/-/g,'');f.t.balanceEffectTimes.fund=source.occurredAt;f.t.balanceEffectTimes.bank=bank.occurredAt;
 for(const list of f.plans.values())for(const p of list)for(const e of p.events){const o=f.observations.find(o=>o.id===e.observationId);e.date=o.date;e.occurredAt=o.occurredAt;}
 const e=f.t.automaticAssociations[0].evidence;Object.assign(e,{date:source.date,bankReceiptDate:bank.date,settlementLagDays:4,bankReceiptFormat:'alipay_clearing_disbursement',settlementRule:require('./fundSettlementCalendar2015').ordinaryYuebaoSettlement2015(source)});assert.equal(e.settlementRule.dueDate,bank.date);return f;
}
test('a four-day withdrawal lag needs the original independently verified2015fund trading calendar and actual receipt date',()=>{
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals,f=weekendWithdrawalFixture(),raw=JSON.stringify(f.transactions);add(f.transactions,f.observations,f.accounts,f.plans);const p=f.plans.get(f.t.id);assert(p);const t=withWalletIntermediaryPostings(f.t,p);assert.deepEqual(t.cashEffectEvents.wallet,[{date:'2015-08-14',deltaMinor:1000000n},{date:'2015-08-18',deltaMinor:-1000000n}]);assert.equal(t.balanceEffectTimes.bank,f.t.balanceEffectTimes.bank);assert.equal(JSON.stringify(f.transactions),raw);
 for(const change of[f=>delete f.t.automaticAssociations[0].evidence.settlementRule,f=>f.t.automaticAssociations[0].evidence.settlementRule.dueDate='2015-08-17',f=>f.t.automaticAssociations[0].evidence.settlementRule.sources=[],f=>f.t.automaticAssociations[0].evidence.bankReceiptFormat='unknown',f=>f.t.automaticAssociations[0].evidence.settlementLagDays=3]){const x=weekendWithdrawalFixture();change(x);add(x.transactions,x.observations,x.accounts,x.plans);assert.equal(x.plans.has(x.t.id),false,change.toString());}
});
test('a previously preserved purpose-only bank receipt label does not erase a verified delayed withdrawal',()=>{
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals;
 function make(){const f=weekendWithdrawalFixture(),annotations=[{id:'bank-purpose',observationId:'receipt',revision:'1',patch:{kind:'transfer',category:'Owner confirmed internal transfer'}}];f.t.automaticAssociations[0].evidence.preservedPurposeAnnotationIds=['bank-purpose'];return{f,options:{annotations,annotatedIds:new Set(['receipt'])}};}
 const {f,options}=make();add(f.transactions,f.observations,f.accounts,f.plans,options);assert.deepEqual(f.plans.get(f.t.id)[0].maskedRedemptionEvidence.preservedReceiptPurposeAnnotationIds,['bank-purpose']);
 for(const change of[(f,o)=>o.annotations[0].patch.kind='expense',(f,o)=>o.annotations[0].patch.feeMinor='1',(f,o)=>f.t.automaticAssociations[0].evidence.preservedPurposeAnnotationIds=[],(f,o)=>o.annotations.unshift({id:'old-financial',observationId:'receipt',revision:'0',patch:{feeMinor:'1'}})]){const x=make();change(x.f,x.options);add(x.f.transactions,x.f.observations,x.f.accounts,x.f.plans,x.options);assert.equal(x.f.plans.has(x.f.t.id),false,change.toString());}
});
test('independently resolved product-funded cash between redemption and withdrawal keeps its own original fund debit',()=>{
 const f=interleavedWithdrawalFixture(),source=f.observations.find(o=>o.id==='purchase1'),root=f.transactions.find(t=>t.id==='purchase1'),p=f.plans.get(root.id)[0],credit=f.observations.find(o=>o.id===p.proofObservationIds[0]);
 Object.assign(source,{amountMinor:p.amountMinor,kind:'transfer',direction:'debit',paymentChannel:'\u4f59\u989d\u5b9d',accountRelations:[{product:'alipay_yuebao',role:'funding',activity:'funding_outflow',financialAccountId:'fund'}]});Object.assign(root,{kind:'transfer',consumptionMinor:'0',balanceEffects:{fund:'-'+p.amountMinor},cashEffects:{fund:'-'+p.amountMinor}});
 credit.description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u652f\u4ed8';credit.rawFields['\u540d\u79f0\u5907\u6ce8']=credit.description;credit.rawFields.sourceTableCells[2]=credit.description;credit.rawFields['\u8d44\u91d1\u6e20\u9053']='\u5929\u5f18\u57fa\u91d1';credit.rawFields.sourceTableCells[6]=credit.rawFields['\u8d44\u91d1\u6e20\u9053'];
 p.path='funded_payment_via_wallet';p.reversible=true;p.maskedFundedOrderEvidence={fundingAccountId:'fund',sourceFundingProduct:'alipay_yuebao',sourceOrderReferenceMatched:true,noNewFundOrBankCash:true};const raw=JSON.stringify(root);require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals(f.transactions,f.observations,f.accounts,f.plans);assert(f.plans.has(f.t.id));assert.equal(JSON.stringify(root),raw);
 f.plans.delete(f.t.id);p.maskedFundedOrderEvidence.noNewFundOrBankCash=false;require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals(f.transactions,f.observations,f.accounts,f.plans);assert.equal(f.plans.has(f.t.id),false);
});
test('a separately resolved bank-funded Yuebao deposit between redemption and next-day withdrawal stays assigned to its original order',()=>{
 const f=delayedWithdrawalFixture(true,true),root=f.transactions.find(t=>t.id==='purchase1'),source=f.observations.find(o=>o.id==='purchase1'),debit=f.observations.find(o=>o.id==='native2'),p=f.plans.get(root.id)[0];root.kind='transfer';root.consumptionMinor='0';root.balanceEffects.fund='2200';root.cashEffects.fund='2200';Object.assign(source,{kind:'transfer',direction:'neutral',description:'\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165',accountRelations:[{product:'alipay_yuebao',role:'target',activity:'investment_deposit',financialAccountId:'fund'}]});debit.description='\u8d2d\u4e70\u7406\u8d22\u4ea7\u54c1\u8f6c\u51fa(\u4f59\u989d\u5b9d\u3001\u6dd8\u5b9d\u57fa\u91d1\u3001\u62db\u8d22\u5b9d\u7b49)';debit.rawFields['\u540d\u79f0\u5907\u6ce8']=debit.description;debit.rawFields.sourceTableCells[2]=debit.description;p.path='known_bank_top_up_and_product_deposit';p.productAccountId='fund';const old=JSON.stringify({root,p});require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals(f.transactions,f.observations,f.accounts,f.plans);assert.deepEqual(f.plans.get(f.t.id)[0].maskedRedemptionEvidence.interleavedResolvedTransactionIds,['purchase1','purchase2']);assert.equal(JSON.stringify({root,p}),old);
});
test('delayed withdrawal rejects wrong bank receipt dates or tails, missing bank evidence and unrelated intervening cash',()=>{
 for(const change of[f=>f.observations[1].date='2015-08-12',f=>f.t.automaticAssociations[0].evidence.bankReceiptDate='2015-08-12',f=>f.t.automaticAssociations[0].evidence.bankCardTail='0586',f=>f.t.automaticAssociations[0].evidence.bankChannel='unknown',f=>f.t.automaticAssociations[0].evidence.reciprocalUnique=false,f=>f.observations[1].statementFlow.incomeMinor='999999',f=>f.observations[1].rawFields['\u4ea4\u6613\u91d1\u989d']='9,999.99',f=>f.observations.find(o=>o.id==='native5').occurredAt='2015-08-14T11:00:00+08:00']){const f=delayedWithdrawalFixture();change(f);require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals(f.transactions,f.observations,f.accounts,f.plans);assert.equal(f.plans.has(f.t.id),false,change.toString());}
});
test('intervening fully resolved zero-net payment pairs preserve a Yuebao withdrawal and its original bank receipt',()=>{
 const f=interleavedWithdrawalFixture(),raw=JSON.stringify({...f,plans:[...f.plans]});require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals(f.transactions,f.observations,f.accounts,f.plans);const p=f.plans.get(f.t.id);assert.equal(p.length,1);assert.deepEqual(p[0].proofObservationIds,['native0','native5']);assert.deepEqual(p[0].maskedRedemptionEvidence.interleavedResolvedTransactionIds,['purchase1','purchase2']);assert.equal(p[0].maskedRedemptionEvidence.nativeProofsAdjacent,false);const after=withWalletIntermediaryPostings(f.t,p);assert.equal(after.cashEffects.bank,'1000000');assert.equal(after.cashEffects.fund,'-1000000');assert.equal(after.balanceEffectTimes.bank,f.t.balanceEffectTimes.bank);assert.equal(after.consumptionMinor,'0');f.plans.delete(f.t.id);assert.equal(JSON.stringify({...f,plans:[...f.plans]}),raw);
});
test('interleaved withdrawal never borrows unassigned, altered, partially claimed or edited native cash',()=>{
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals;
 for(const change of[f=>f.plans.delete('purchase1'),f=>f.plans.get('purchase1')[0].events[0].deltaMinor='2201',f=>f.plans.get('purchase1')[0].proofObservationIds.pop(),f=>f.plans.get('purchase1')[0].netDeltaMinor='1',f=>f.plans.get('purchase1')[0].sourceObservationId='other',f=>f.observations[3].balanceMinor='1102201',f=>f.t.cashEffects.wallet='-1',f=>f.t.sources.pop(),f=>f.accounts.find(a=>a.id==='bank').maskedIdentifier='0586',f=>f.t.automaticAssociations[0].evidence.reciprocalUnique=false,f=>f.t.consumptionMinor='1',f=>f.observations[0].occurredAt='2015-08-12T11:42:28+08:00',f=>f.observations.push({...f.observations[0],id:'second-order',sourceIdentity:'second-order'}),f=>f.observations.push({...f.observations[2],id:'equal-version'}),f=>f.plans.set('another',f.plans.get('purchase1'))]){const f=interleavedWithdrawalFixture();change(f);add(f.transactions,f.observations,f.accounts,f.plans);assert.equal(f.plans.has(f.t.id),false,change.toString());}
 for(const options of[{annotatedIds:new Set(['withdrawal'])},{annotatedIds:new Set(['receipt'])},{annotatedIds:new Set(['native1'])},{links:[{type:'group_distinct',observationIds:['receipt','other']}]},{links:[{type:'distinct',observationIds:['withdrawal','native5']}]},{links:[{type:'duplicate',status:'deleted',observationIds:['withdrawal','native0']}]}]){const f=interleavedWithdrawalFixture();add(f.transactions,f.observations,f.accounts,f.plans,options);assert.equal(f.plans.has(f.t.id),false);}
});
test('only a fully reset purpose-only history can preserve an existing interleaved payment or bank receipt',()=>{
 const add=require('./walletIntermediaryPostings').addInterleavedYuebaoWithdrawals;
 function permitted(){const f=interleavedWithdrawalFixture(),annotations=[{id:'old-bank-purpose',observationId:'receipt',revision:'1',patch:{kind:'transfer',category:'Old'}},{id:'bank-reset',observationId:'receipt',revision:'2',reset:true,patch:{}},{id:'old-payment-purpose',observationId:'purchase1',revision:'3',patch:{kind:'transfer',category:'Old'}},{id:'payment-reset',observationId:'purchase1',revision:'4',reset:true,patch:{}}];f.plans.get('purchase1')[0].preservedPurposeResetAnnotationId='payment-reset';return{f,options:{annotations,annotatedIds:new Set(['receipt','purchase1'])}};}
 const {f,options}=permitted();add(f.transactions,f.observations,f.accounts,f.plans,options);assert.deepEqual(f.plans.get(f.t.id)[0].maskedRedemptionEvidence.preservedPurposeResetAnnotationIds,['bank-reset','payment-reset']);
 for(const change of[x=>x.options.annotations[0].patch.amountMinor='1000001',x=>x.options.annotations[1].reset=false,x=>x.options.annotations[3].patch={financialAccountId:'other'},x=>x.f.plans.get('purchase1')[0].preservedPurposeResetAnnotationId='wrong',x=>x.options.annotations.push({...x.options.annotations[3],id:'same-revision'}),x=>x.options.annotatedIds.add('native1')]){const x=permitted();change(x);add(x.f.transactions,x.f.observations,x.f.accounts,x.f.plans,x.options);assert.equal(x.f.plans.has(x.f.t.id),false,change.toString());}
});
const bank='\u6c5f\u82cf\u94f6\u884c',otherBank='\u5efa\u8bbe\u94f6\u884c',ali='\u652f\u4ed8\u5b9d';
function fixture(payment=false){
 const reference='20180304310500201010250036152233',amount=payment?'4000':'12000',money=payment?'40.00':'120.00';
 const accounts=[{id:'wallet',type:'wallet',provider:'alipay',currency:'CNY',status:'active',label:'Wallet'},{id:'fund',type:'investment',provider:'alipay',sourceProduct:'alipay_yuebao',currency:'CNY',status:'active',label:'Fund'},{id:'bank',type:'debit_card',provider:bank,maskedIdentifier:'2110',currency:'CNY',status:'active',label:'Bank'}];
 const source={id:'source',sourceIdentity:'source',sourceTransactionId:reference,financialAccountId:'wallet',provider:'alipay',date:'2018-03-04',occurredAt:'2018-03-04T15:51:20+08:00',amountMinor:amount,currency:'CNY',kind:payment?'expense':'transfer',direction:payment?'debit':'neutral',status:'completed',description:payment?'\u6536\u6b3e':'\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u94f6\u884c\u5361',counterparty:payment?'Merchant':bank,category:payment?'Food':'Investment',paymentChannel:payment?'\u4f59\u989d\u5b9d':bank+'\u50a8\u84c4\u5361(2110)',paymentAccountHint:payment?'':'2110',relatedReference:'',balanceMinor:null,rawFields:{},accountRelations:[{product:'alipay_yuebao',activity:payment?'funding_outflow':'investment_withdrawal',role:payment?'funding':'target',financialAccountId:'fund'}]};
 const parsed=parseAlipayWalletBalanceRows([
  [payment?reference:'1803040489312340',payment?'2018-03-04 15:51:22':'2018-03-04 16:04:08',payment?'\u5728\u7ebf\u652f\u4ed8':'\u63d0\u73b0','', '-'+money,'0.00',payment?ali:otherBank,''],
  [reference,'2018-03-04 15:51:21','\u8f6c\u8d26',money,'',money,ali,'']
 ]);assert.deepEqual(parsed.errors,[]);
 const proofs=parsed.records.map((r,i)=>({...r,id:'proof'+i,sourceIdentity:'proof'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'}));
 return{accounts,observations:[source,...proofs],annotations:[],links:[],imports:[],balanceSnapshots:[]};
}
test('a product withdrawal retains its actual destination and acquires only zero-net wallet timing',()=>{
 const l=fixture(),before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.observationIds.includes('source'));
 assert.equal(t.cashEffects.fund,'-12000');assert.equal(t.cashEffects.bank,'12000');assert.equal(t.cashEffects.wallet,'0');assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');
 assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['12000','-12000']);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);
 assert.equal(t.walletIntermediaryPostings[0].nativeDisbursementChannel,otherBank);assert.equal(t.walletIntermediaryPostings[0].nativeChannelUsedToSelectReceivingAccount,false);
 assert.equal(t.walletIntermediaryPostings[0].path,'product_withdrawal_via_wallet');assert.equal(JSON.stringify(l),before);
});
test('a funded purchase stays charged to the fund while the one-second wallet transit balances',()=>{
 const l=fixture(true),v=buildFinanceView(l),t=v.transactions.find(t=>t.observationIds.includes('source'));
 assert.equal(t.consumptionMinor,'4000');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.cashEffects.wallet,'0');assert.equal(v.accountStats.wallet.consumptionMinor,'0');assert.equal(v.accountStats.fund.consumptionMinor,'4000');assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);
});
test('incorrect references, broken native balances and owner vetoes cannot create transit events',()=>{
 for(const change of[
  l=>l.observations[0].sourceTransactionId='wrong',
  l=>l.observations[2].balanceMinor='1',
  l=>l.annotations.push({id:'annotation',observationId:'source',revision:'1',patch:{kind:'transfer',category:'Custom'}}),
  l=>l.links.push({type:'distinct',observationIds:['source','proof0']}),
 ]){const l=fixture();change(l);const v=buildFinanceView(l),t=v.transactions.find(t=>t.observationIds.includes('source'));assert(!t.walletIntermediaryPostings);}
});
test('existing nonzero wallet debits are never erased to manufacture an offset',()=>{
 const l=fixture(true),source=l.observations[0],t={id:'t',sources:[source],balanceEffects:{wallet:'-4000',fund:'-4000'},cashEffects:{wallet:'-4000',fund:'-4000'},financialAccountIds:['wallet','fund']};
 assert.equal(findWalletIntermediaryPostings([t],l.observations,l.accounts).size,0);
 assert.throws(()=>withWalletIntermediaryPostings(t,[{financialAccountId:'wallet',events:[]}]),/NONZERO_EXISTING_EFFECT/);
});
test('a clearing-network withdrawal needs an adjacent native debit and an already paired bank receipt',()=>{
 const l=fixture(),debit=l.observations.find(o=>o.balanceEvidence?.expenseMinor==='12000');debit.rawFields['\u8d44\u91d1\u6e20\u9053']='\u7f51\u8054';debit.rawFields.sourceTableCells[6]='\u7f51\u8054';
 const source=l.observations[0],bankSource={id:'bank-receipt',financialAccountId:'bank',provider:'jsb',status:'completed',direction:'credit',currency:'CNY',date:source.date,amountMinor:'12000',statementFlow:{schema:'jsb-debit-v1',incomeMinor:'12000',expenseMinor:'0'}};
 const t={id:'t',kind:'transfer',consumptionMinor:'0',incomeMinor:'0',sources:[source,bankSource],balanceEffects:{fund:'-12000',bank:'12000'},cashEffects:{fund:'-12000',bank:'12000'},financialAccountIds:['fund','bank']};
 assert.equal(findWalletIntermediaryPostings([t],l.observations,l.accounts).size,1);
 for(const mutate of[
  (x,y)=>y.sources.pop(),
  (x,y)=>y.sources[1].direction='debit',
  (x,y)=>y.sources[1].amountMinor='11999',
  (x,y)=>y.sources[1].date='2018-03-05',
  (x,y)=>y.cashEffects.bank='11999',
  (x,y)=>x.observations[1].balanceEvidence.sequence=3,
  (x,y)=>y.kind='expense',
  (x,y)=>y.consumptionMinor='1'
 ]){const x=structuredClone(l),y=structuredClone(t);mutate(x,y);assert.equal(findWalletIntermediaryPostings([y],x.observations,x.accounts).size,0,mutate.toString());}
});

test('an exactly referenced funded transfer keeps its original fund debit while adding the named zero-net Yuebao wallet bridge',()=>{
 const l=fixture(true),s=l.observations[0];s.kind='transfer';s.description='Transfer';l.observations[1].description='\u8f6c\u8d26\u4f59\u989d\u5b9d\u8d4e\u56de\u8f6c\u5165';l.observations[2].description='\u8f6c\u8d26\u4f59\u989d\u5b9d\u8d4e\u56de\u8f6c\u51fa';for(const p of l.observations.slice(1)){p.rawFields['\u540d\u79f0\u5907\u6ce8']=p.description;p.rawFields.sourceTableCells[2]=p.description;}
 l.observations.push({...s,id:'unrelated-same-amount',sourceIdentity:'another',sourceTransactionId:'different-reference'});const raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id===s.id),other=v.transactions.find(t=>t.id==='unrelated-same-amount');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.cashEffects.wallet,'0');assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['4000','-4000']);assert.equal(other.walletIntermediaryPostings,undefined);assert.equal(JSON.stringify(l),raw);
 l.accounts[1].sourceProduct='alipay_yulibao';const wrong=buildFinanceView(l).transactions.find(t=>t.id===s.id);assert.equal(wrong.walletIntermediaryPostings,undefined,'a named Yuebao route must not be attached to an unrelated funding product');
});

test('same-second funded payment bridges preserve both raw cash events without changing their zero net amount',()=>{
 const l=fixture(true),p=l.observations[2];p.occurredAt=l.observations[1].occurredAt;p.rawFields['\u65f6\u95f4']=p.date+p.occurredAt.slice(11,19);p.rawFields.sourceTableCells[1]=p.date+' '+p.occurredAt.slice(11,19);const t=buildFinanceView(l).transactions.find(t=>t.id==='source');assert.equal(t.walletIntermediaryPostings.length,1);assert.equal(t.balanceEffectEvents.wallet.length,2);assert.equal(t.balanceEffectEvents.wallet[0].occurredAt,t.balanceEffectEvents.wallet[1].occurredAt);assert.equal(t.cashEffects.wallet,'0');
});

function maskedWithdrawalFixture(){
 const l=fixture(),s=l.observations[0],credit=l.observations[1],debit=l.observations[2];
 l.accounts[2].provider='\u5efa\u8bbe\u94f6\u884c';s.counterparty='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c';
 s.rawFields={'\u4ea4\u6613\u65f6\u95f4':s.date+' '+s.occurredAt.slice(11,19),'\u4ea4\u6613\u8ba2\u5355\u53f7':s.sourceTransactionId,'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u91d1\u989d':'120.00'};
 credit.description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u63d0\u73b0\u5230\u5361';credit.relatedReference='20180304000251052500146***04';credit.rawFields['\u540d\u79f0\u5907\u6ce8']=credit.description;credit.rawFields['\u6d41\u6c34\u53f7']=credit.relatedReference;credit.rawFields['\u8d44\u91d1\u6e20\u9053']='\u5929\u5f18\u57fa\u91d1';
 debit.description='\u63d0\u73b0\u6797\u6708\u9ec4';debit.rawFields['\u540d\u79f0\u5907\u6ce8']=debit.description;
 const bank={id:'actual-bank-credit',provider:'ccb',financialAccountId:'bank',status:'completed',direction:'credit',date:s.date,occurredAt:s.date+'T23:59:59+08:00',currency:'CNY',amountMinor:'12000',statementFlow:{incomeMinor:'12000',expenseMinor:'0',timePrecision:'day'}};
 l.observations.push(bank);
 const t={id:'event',sources:[s,bank],balanceEffects:{fund:'-12000',bank:'12000'},cashEffects:{fund:'-12000',bank:'12000'},balanceEffectTimes:{fund:s.occurredAt,bank:bank.occurredAt},financialAccountIds:['fund','bank']};
 return{l,t};
}

test('masked native Tianhong withdrawal needs an explicit product order and existing bank receipt, preserving both original cash legs',()=>{
 const {l,t}=maskedWithdrawalFixture(),raw=JSON.stringify({l,t}),plans=findWalletIntermediaryPostings([t],l.observations,l.accounts).get(t.id);
 assert.equal(plans.length,1);assert.equal(plans[0].maskedRedemptionEvidence.sourceOrderReferenceMatched,false);assert.equal(plans[0].maskedRedemptionEvidence.bankTimeUsedForMatching,false);assert.equal(plans[0].maskedRedemptionEvidence.nativeMaskedRedemptionReference,'20180304000251052500146***04');
 const after=withWalletIntermediaryPostings(t,plans);assert.deepEqual(after.cashEffects,{fund:'-12000',bank:'12000',wallet:0n});assert.deepEqual(after.balanceEffectEvents.wallet.map(e=>e.deltaMinor),[12000n,-12000n]);assert.equal(after.balanceEffectTimes.bank,t.balanceEffectTimes.bank);assert.equal(JSON.stringify({l,t}),raw);
});

test('masked redemption transit rejects unknown product, altered native cash, wrong receiving bank, missing receipt and nonzero wallet cash',()=>{
 for(const change of[
  ({l})=>l.observations[0].accountRelations[0].product='alipay_yulibao',
  ({l})=>l.observations[1].rawFields['\u8d44\u91d1\u6e20\u9053']='Other fund',
  ({l})=>l.observations[1].balanceMinor='11999',
  ({l})=>l.observations[0].rawFields['\u91d1\u989d']='119.99',
  ({l})=>l.accounts[2].provider='\u676d\u5dde\u94f6\u884c',
  ({t})=>t.sources.pop(),
  ({l})=>l.observations[0].occurredAt='2018-03-04T15:51:18+08:00',
  ({t})=>t.cashEffects.wallet='-12000',
  ({l})=>l.observations[2].balanceEvidence.sequence=3,
 ]){const f=maskedWithdrawalFixture();change(f);assert.equal(findWalletIntermediaryPostings([f.t],f.l.observations,f.l.accounts).size,0);}
});

test('competing same-second masked withdrawal orders, owner edits and explicit vetoes retain ambiguity',()=>{
 for(const change of[
  ({l,t})=>{const other={...t.sources[0],id:'rival',sourceIdentity:'rival',sourceTransactionId:'another',rawFields:{...t.sources[0].rawFields,'\u4ea4\u6613\u8ba2\u5355\u53f7':'another'}};l.observations.push(other);t.sources.push(other);},
  ({l})=>l.annotations.push({id:'edit',observationId:'source',revision:'1',patch:{kind:'transfer',category:'Custom'}}),
  ({l})=>l.links.push({type:'distinct',observationIds:['source','proof0']}),
  ({l})=>l.links.push({type:'group_distinct',observationIds:['proof0','unrelated']}),
 ]){const f=maskedWithdrawalFixture();change(f);assert.equal(findWalletIntermediaryPostings([f.t],f.l.observations,f.l.accounts,{annotatedIds:new Set(f.l.annotations.map(a=>a.observationId)),links:f.l.links}).size,0);}
});

function maskedFundedFixture(){
 const l=fixture(true),s=l.observations[0],credit=l.observations[1];
 s.rawFields={'\u4ea4\u6613\u65f6\u95f4':s.date+' '+s.occurredAt.slice(11,19),'\u4ea4\u6613\u8ba2\u5355\u53f7':s.sourceTransactionId,'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':'40.00'};
 credit.description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u652f\u4ed8';credit.relatedReference='20180304000251052500146***04';credit.rawFields['\u540d\u79f0\u5907\u6ce8']=credit.description;credit.rawFields['\u6d41\u6c34\u53f7']=credit.relatedReference;credit.rawFields['\u8d44\u91d1\u6e20\u9053']='\u5929\u5f18\u57fa\u91d1';
 return l;
}
function huabeiRepaymentFixture(){
 const l=maskedFundedFixture(),s=l.observations[0],debit=l.observations.find(o=>o.balanceEvidence?.expenseMinor==='4000');Object.assign(s,{principalMinor:null,interestMinor:null,feeMinor:null});l.accounts.push({id:'huabei',type:'credit_card',provider:'alipay',sourceProduct:'alipay_huabei',currency:'CNY',status:'active'});
 Object.assign(s,{kind:'debt_payment',direction:'neutral',description:'\u82b1\u5457\u81ea\u52a8\u8fd8\u6b3e',counterparty:'\u8682\u8681\u82b1\u5457'});s.accountRelations.unshift({product:'alipay_huabei',activity:'repayment',role:'target',financialAccountId:'huabei'});Object.assign(s.rawFields,{'\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u72b6\u6001':'\u8fd8\u6b3e\u6210\u529f','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':s.paymentChannel});debit.description='\u8682\u8681\u82b1\u5457/\u5206\u671f\u8d2d\u8fd8\u6b3e';debit.rawFields['\u540d\u79f0\u5907\u6ce8']=debit.description;return l;
}
test('explicit successful Huabei repayment preserves debt and Yuebao money while its native wallet transit closes',()=>{
 const l=huabeiRepaymentFixture(),raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='source');assert.equal(t.kind,'debt_payment');assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');assert.equal(t.balanceEffects.huabei,'4000');assert.equal(t.balanceEffects.fund,'-4000');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.balanceEffects.wallet,'0');assert.equal(t.sources[0].rawFields['\u4ea4\u6613\u72b6\u6001'],'\u8fd8\u6b3e\u6210\u529f');assert.equal(t.walletIntermediaryPostings[0].maskedFundedOrderEvidence.sourceOrderReferenceMatched,true);assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['4000','-4000']);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);
});
test('repayment-success status does not authorize generic payments, unknown debts or unverified native Huabei cash',()=>{
 for(const change of[l=>l.observations[0].rawFields['\u4ea4\u6613\u72b6\u6001']='\u8fd8\u6b3e\u5931\u8d25',l=>l.observations[0].rawFields['\u4ea4\u6613\u72b6\u6001']='\u5904\u7406\u4e2d',l=>l.observations[0].kind='expense',l=>l.observations[0].description='Other payment',l=>l.observations[0].counterparty='Other lender',l=>l.observations[0].rawFields['\u6536/\u652f']='\u652f\u51fa',l=>l.observations[0].rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='\u4f59\u989d',l=>l.observations[0].accountRelations[0].product='alipay_jiebei',l=>l.accounts.find(a=>a.id==='huabei').sourceProduct='alipay_jiebei',l=>l.accounts.find(a=>a.id==='huabei').currency='USD',l=>l.observations.find(o=>o.balanceEvidence?.expenseMinor==='4000').description='\u5728\u7ebf\u652f\u4ed8',l=>l.observations.find(o=>o.balanceEvidence?.incomeMinor==='4000').description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237',l=>l.links.push({type:'distinct',observationIds:['source','proof0']})]){const l=huabeiRepaymentFixture();change(l);const t=buildFinanceView(l).transactions.find(t=>t.observationIds.includes('source'));assert.equal(t.walletIntermediaryPostings,undefined,change.toString());}
 const l=maskedFundedFixture();l.observations[0].rawFields['\u4ea4\u6613\u72b6\u6001']='\u8fd8\u6b3e\u6210\u529f';assert.equal(buildFinanceView(l).transactions.find(t=>t.id==='source').walletIntermediaryPostings,undefined);
});

test('an exactly referenced native debit and adjacent Tianhong credit restore funded cash transit despite masked redemption and delayed cash',()=>{
 const l=maskedFundedFixture(),s=l.observations[0];s.occurredAt='2018-03-04T15:49:20+08:00';s.rawFields['\u4ea4\u6613\u65f6\u95f4']='2018-03-04 15:49:20';const raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='source');
 assert.equal(t.consumptionMinor,'4000');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.balanceEffects.fund,'-4000');assert.equal(t.cashEffects.wallet,'0');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['4000','-4000']);assert.equal(t.walletIntermediaryPostings[0].maskedFundedOrderEvidence.sourceOrderReferenceMatched,true);assert.equal(t.walletIntermediaryPostings[0].maskedFundedOrderEvidence.nativeRedemptionReferenceMatched,false);assert.equal(t.walletIntermediaryPostings[0].maskedFundedOrderEvidence.orderToRedemptionDelaySeconds,121);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);
});

test('cash-only repair retains a user-classified course task and its actual fund debit without recreating personal consumption',()=>{
 const l=maskedFundedFixture();l.annotations.push({id:'owner-purpose',observationId:'source',revision:'1',patch:{kind:'transfer',category:'Owner confirmed course task'}});const v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='source');assert.equal(t.kind,'transfer');assert.equal(t.category,'Owner confirmed course task');assert.equal(t.consumptionMinor,'0');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.cashEffects.wallet,'0');assert.equal(t.walletIntermediaryPostings[0].maskedFundedOrderEvidence.purposeOnlyAnnotationPreserved,true);
});

test('masked funded transit cannot replace wallet money, override a cash edit, ignore a veto or borrow a different order reference',()=>{
 for(const change of[
  l=>{const p=l.observations[2];p.relatedReference='other-order-reference';p.rawFields['\u6d41\u6c34\u53f7']=p.relatedReference;},
  l=>l.observations[1].rawFields['\u8d44\u91d1\u6e20\u9053']='Another fund',
  l=>l.observations[1].balanceMinor='1',
  l=>{const s=l.observations[0];s.paymentChannel='\u8d26\u6237\u4f59\u989d';s.accountRelations=[];},
  l=>l.annotations.push({id:'cash-edit',observationId:'source',revision:'1',patch:{kind:'transfer',financialAccountId:'bank'}}),
  l=>l.links.push({type:'distinct',observationIds:['source','proof1']}),
  l=>{const s=l.observations[0];l.observations.push({...s,id:'rival',sourceIdentity:'rival'});},
 ]){const l=maskedFundedFixture();change(l);const t=buildFinanceView(l).transactions.find(t=>t.observationIds.includes('source'));assert.equal(t.walletIntermediaryPostings,undefined);}
});

test('an omitted funding method is recovered from explicitly named Yuebao redemption and the exact native debit order',()=>{
 const direct=maskedFundedFixture();direct.observations[0].paymentChannel='';direct.observations[0].accountRelations=[];direct.observations[0].rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='';assert.equal(require('./walletIntermediaryPostings').findNativeYuebaoFunding(direct.observations,direct.accounts).size,1,'direct original evidence must resolve before ledger projection');
 const l=maskedFundedFixture(),s=l.observations[0];s.paymentChannel='';s.accountRelations=[];s.rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='';const raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='source');assert.equal(t.automaticFunding.method,'native_yuebao_debit_order_and_redemption');assert.equal(t.cashEffects.fund,'-4000');assert.equal(t.cashEffects.wallet,'0');assert.equal(t.consumptionMinor,'4000');assert.equal(v.accountStats.fund.consumptionMinor,'4000');assert.equal(v.accountStats.wallet.consumptionMinor,'0');assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);
});

test('native Yuebao funding requires the literal product, unique fund identity, exact order, blank source method and valid original cash',()=>{
 const find=require('./walletIntermediaryPostings').findNativeYuebaoFunding;
 for(const change of[
  l=>{const p=l.observations[1];p.description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u63d0\u73b0\u5230\u4f59\u989d';p.rawFields['\u540d\u79f0\u5907\u6ce8']=p.description;},
  l=>l.accounts.push({...l.accounts[1],id:'other-yuebao'}),
  l=>{const p=l.observations[2];p.relatedReference='other-order';p.rawFields['\u6d41\u6c34\u53f7']=p.relatedReference;},
  l=>l.observations[0].paymentChannel='\u8d26\u6237\u4f59\u989d',
  l=>l.observations[1].balanceMinor='1',
  l=>l.links.push({type:'distinct',observationIds:['source','proof0']}),
  l=>l.annotations.push({id:'cash-owner',observationId:'source',revision:'1',patch:{paymentChannel:'\u8d26\u6237\u4f59\u989d'}}),
  l=>{l.observations.push({id:'confirmed-bank-payer',provider:'ccb',financialAccountId:'bank',status:'completed',direction:'debit',currency:'CNY',amountMinor:'4000'});l.links.push({type:'duplicate',observationIds:['source','confirmed-bank-payer']});},
 ]){const l=maskedFundedFixture(),s=l.observations[0];s.paymentChannel='';s.accountRelations=[];s.rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='';change(l);assert.equal(find(l.observations,l.accounts,{annotations:l.annotations,links:l.links}).size,0);}
});

function fundCashPurposeFixture(loan){const date='2016-09-14',reference='2016091410193018530000000000250006720268',description=loan?'\u8682\u8681\u501f\u5457\u8fd8\u6b3e':'1806\u623f\u62bc\u91d1',counterparty=loan?'\u8682\u8681\u501f\u5457':'Tenant',wallet={id:'wallet',type:'wallet',provider:'alipay',currency:'CNY',status:'active'},fund={id:'fund',type:'investment',provider:'alipay',sourceProduct:'alipay_yuebao',currency:'CNY',status:'active'},target={id:'loan',type:'loan',provider:'alipay',sourceProduct:'alipay_jiebei',currency:'CNY',status:'active'},source={id:'order',sourceIdentity:'order',sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',sourceTransactionId:reference,date,occurredAt:date+'T15:33:40+08:00',currency:'CNY',kind:loan?'debt_payment':'transfer',status:'completed',direction:loan?'neutral':'debit',amountMinor:'4000',description,counterparty,paymentChannel:'\u4f59\u989d\u5b9d',accountRelations:[...(loan?[{role:'target',activity:'repayment',product:'alipay_jiebei',financialAccountId:'loan'}]:[]),{role:'funding',activity:'funding_outflow',product:'alipay_yuebao',financialAccountId:'fund'}],rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' 15:33:40','\u4ea4\u6613\u8ba2\u5355\u53f7':reference,'\u5546\u54c1\u8bf4\u660e':description,'\u4ea4\u6613\u5bf9\u65b9':counterparty,'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'\u4f59\u989d\u5b9d','\u6536/\u652f':loan?'\u4e0d\u8ba1\u6536\u652f':'\u652f\u51fa','\u91d1\u989d':'40.00','\u4ea4\u6613\u72b6\u6001':loan?'\u8fd8\u6b3e\u6210\u529f':'\u4ea4\u6613\u6210\u529f'}};
const credit='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237'+(loan?'\u4f59\u989d\u5b9d\u652f\u4ed8':description),debit=loan?'\u8682\u8681\u501f\u5457/\u8d37\u6b3e\u8fd8\u6b3e':description.repeat(2),parsed=parseAlipayWalletBalanceRows([[reference,date+' 15:33:46',debit,'','-40.00','0.00','\u652f\u4ed8\u5b9d',''],['20160914000251052500426***89',date+' 15:33:45',credit,'40.00','','40.00','\u5929\u5f18\u57fa\u91d1','']]);assert.deepEqual(parsed.errors,[]);const originals=[source,...parsed.records.map((o,i)=>({...o,id:'proof'+i,sourceIdentity:'proof'+i,sourceVersionOrdinal:1,provider:'alipay',financialAccountId:'wallet',importId:'native'}))],transaction={...source,id:'order',sources:[source],observationIds:['order'],balanceEffects:{fund:'-4000',...(loan?{loan:'3950'}:{})},cashEffects:{fund:'-4000'},balanceEffectTimes:{fund:source.occurredAt},consumptionMinor:loan?'50':'0',incomeMinor:'0',reportingAccountIds:['fund']};return{accounts:[wallet,fund,...(loan?[target]:[])],observations:originals,transaction};}
function fundCashPurposePlans(f,options){return findWalletIntermediaryPostings([f.transaction],f.observations,f.accounts,options);}
test('native fund transit integrates with the full ledger while preserving independently specified loan principal and interest',()=>{const f=fundCashPurposeFixture(true),source=f.observations[0];Object.assign(source,{principalMinor:'3950',interestMinor:'50',feeMinor:'0'});const before=JSON.stringify(f),v=buildFinanceView({accounts:f.accounts,observations:f.observations,annotations:[],links:[],imports:[],balanceSnapshots:[]}),t=v.transactions.find(t=>t.id==='order');assert.equal(t.kind,'debt_payment');assert.equal(t.consumptionMinor,'50');assert.equal(t.balanceEffects.loan,'3950');assert.equal(t.balanceEffects.fund,'-4000');assert.equal(t.balanceEffects.wallet,'0');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['4000','-4000']);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(f),before);});
test('a room deposit needs both native titles to name the exact original room, not just matching cash',()=>{for(const change of [f=>{const p=f.observations[2];p.description='1807\u623f\u62bc\u91d1'.repeat(2);p.rawFields['\u540d\u79f0\u5907\u6ce8']=p.description;},f=>{const p=f.observations[1];p.description='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u62371807\u623f\u62bc\u91d1';p.rawFields['\u540d\u79f0\u5907\u6ce8']=p.description;},f=>f.transaction.sources[0].kind='expense']){const f=fundCashPurposeFixture(false);change(f);assert.equal(fundCashPurposePlans(f).size,0,change.toString());}});
test('deposit and loan interest retain their economic purpose, fund debit and principal with exact native transit',()=>{for(const loan of [false,true]){const f=fundCashPurposeFixture(loan);f.transaction.financialAccountIds=['fund',...(loan?['loan']:[])];const before=JSON.stringify(f),p=fundCashPurposePlans(f).get('order');assert.equal(p.length,1);const t=withWalletIntermediaryPostings(f.transaction,p);assert.equal(t.kind,f.transaction.kind);assert.equal(t.consumptionMinor,f.transaction.consumptionMinor);assert.equal(t.balanceEffects.fund,'-4000');assert.equal(t.balanceEffects.wallet,0n);if(loan)assert.equal(t.balanceEffects.loan,'3950');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),[4000n,-4000n]);assert.equal(JSON.stringify(f),before);}});
test('an unrelated lender, inconsistent principal, wrong native order, account edit or explicit veto cannot create loan cash',()=>{for(const change of [f=>f.transaction.sources[0].counterparty='Other lender',f=>f.transaction.sources[0].accountRelations[0].product='alipay_huabei',f=>f.accounts.find(a=>a.id==='loan').sourceProduct='other',f=>f.transaction.balanceEffects.loan='0',f=>f.transaction.balanceEffects.loan='4001',f=>f.transaction.consumptionMinor='0',f=>{const o=f.observations[2];o.relatedReference+='1';o.rawFields['\u6d41\u6c34\u53f7']=o.relatedReference;}]){const f=fundCashPurposeFixture(true);change(f);assert.equal(fundCashPurposePlans(f).size,0,change.toString());}const f=fundCashPurposeFixture(true);assert.equal(fundCashPurposePlans(f,{annotatedIds:new Set(['order'])}).size,0);assert.equal(fundCashPurposePlans(f,{links:[{type:'distinct',observationIds:['order','proof0']}]}).size,0);});
