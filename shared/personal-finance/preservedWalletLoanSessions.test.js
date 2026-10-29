'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {findLoanWalletReceipts}=require('./loanWalletReceipts');
const balance='\u4f59\u989d',auto='\u4f59\u989d\u5b9d-\u81ea\u52a8\u8f6c\u5165',manual='\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165';
const accounts=[
 {id:'wallet',type:'wallet',provider:'alipay',status:'active',currency:'CNY'},
 {id:'loan',type:'loan',sourceProduct:'alipay_jiebei',status:'active',currency:'CNY'},
 {id:'fund',type:'investment',provider:'alipay',sourceProduct:'alipay_yuebao',status:'active',currency:'CNY'},
 {id:'tasks',type:'receivable',balanceConvention:'signed',status:'active',currency:'CNY',counterpartySettlement:{schema:'counterparty-settlement-v1',counterparty:'Course tasks'}}
];
function fixture({overnight=false}={}){
 function row(id,time,amount,patch={}){
  const o={id,sourceIdentity:id,sourceTransactionId:id,provider:'alipay',financialAccountId:'wallet',date:time.slice(0,10),occurredAt:time+'+08:00',currency:'CNY',status:'completed',kind:'transfer',direction:'debit',description:'Course payment',counterparty:'Owner task account',paymentChannel:balance,paymentAccountHint:'',amountMinor:amount,...patch};
  o.rawFields={'\u4ea4\u6613\u65f6\u95f4':time.replace('T',' '),'\u6536/\u652f':o.direction==='debit'?'\u652f\u51fa':'\u4e0d\u8ba1\u6536\u652f','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':o.paymentChannel,'\u5546\u54c1\u8bf4\u660e':o.description,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f'};return o;
 }
 const start=overnight?'2016-04-06':'2016-04-07',end=overnight?'2016-04-07T03:07:15':'2016-04-07T17:50:00';
 return [row('draw',start+'T17:11:44','1000000',{kind:'loan_drawdown',direction:'neutral',description:'\u4e2a\u4eba\u6d88\u8d39\u8d37\u6b3e\u653e\u6b3e',paymentChannel:'',accountRelations:[{role:'target',product:'alipay_jiebei',activity:'loan_drawdown',financialAccountId:'loan'}]}),row('task1',start+'T17:15:00','200000'),row('task2',start+'T17:16:00','214100'),row('sweep',end,'585900',{kind:'transfer',direction:'neutral',description:overnight?auto:manual,accountRelations:[{role:'target',product:'alipay_yuebao',activity:'investment_deposit',financialAccountId:'fund'}]})];
}
function options(){return{annotatedIds:new Set(['task1','task2']),annotations:new Map(['task1','task2'].map(id=>[id,{observationId:id,revision:'1',patch:{kind:'transfer',category:'Owner-confirmed course advance',settlementAccountId:'tasks'}}])),actualLoanDrawEvidence:new Map([['draw',['actual-loan-proof']]])};}
const run=(rows,opts=options(),acc=accounts)=>findLoanWalletReceipts(rows,acc,opts);
test('confirmed receivable annotations preserve cash sources and purpose while closing a loan wallet session',()=>{
 const rows=fixture(),opts=options(),before=JSON.stringify([rows,[...opts.annotations],accounts]);
 const result=run(rows,opts);assert.equal(result.size,1);const receipt=result.get('draw');assert.equal(receipt.confidence,'inferred');assert.equal(receipt.sessionInflowMinor,'1000000');assert.equal(receipt.sessionOutflowMinor,'1000000');assert.deepEqual(receipt.preservedSettlementAnnotationObservationIds,['task1','task2']);assert.equal(receipt.supportingDecisionsUnchanged,true);assert.equal(receipt.overnightAutomaticSweep,undefined);assert.equal(JSON.stringify([rows,[...opts.annotations],accounts]),before);
});
test('next-day original automatic sweep closes exact amount without moving original dates',()=>{
 const rows=fixture({overnight:true}),before=JSON.stringify(rows),receipt=run(rows).get('draw');assert(receipt);assert.equal(receipt.overnightAutomaticSweep,true);assert.equal(receipt.originalDateBoundaryPreserved,true);assert.equal(receipt.sessionStart,'2016-04-06T17:11:44+08:00');assert.equal(receipt.sessionEnd,'2016-04-07T03:07:15+08:00');assert.equal(JSON.stringify(rows),before);
});
test('annotation changes to amount attribution, source, purpose or invalid settlement accounts block session inference',()=>{
 for(const patch of[{kind:'expense',category:'Override',settlementAccountId:'tasks'},{kind:'transfer',category:'Override'},{kind:'transfer',category:'Override',settlementAccountId:'fund'},{kind:'transfer',category:'Override',settlementAccountId:'tasks',feeMinor:'1'},{kind:'transfer',category:'Override',settlementAccountId:'tasks',paymentAllocation:[]}]){
  const opts=options();opts.annotations.set('task1',{observationId:'task1',revision:'2',patch});assert.equal(run(fixture(),opts).size,0);
 }
 const reset=options();reset.annotations.set('task1',{reset:true});assert.equal(run(fixture(),reset).size,0);
 for(const accountPatch of[{type:'wallet'},{status:'deleted'},{currency:'USD'},{balanceConvention:'asset_positive'},{counterpartySettlement:null}])assert.equal(run(fixture(),options(),accounts.map(a=>a.id==='tasks'?{...a,...accountPatch}:a)).size,0);
});
test('raw-source contradiction and unsupported funding prevent using annotated cash debits',()=>{
 for(const change of[o=>o.paymentChannel='Other',o=>o.rawFields['\u6536/\u652f']='\u4e0d\u8ba1\u6536\u652f',o=>o.rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='Other',o=>o.rawFields['\u4ea4\u6613\u72b6\u6001']='Unknown',o=>o.paymentAccountHint='Card',o=>o.automaticFunding={method:'other'},o=>o.accountRelations=[{role:'funding',financialAccountId:'fund'}]]){
  const rows=fixture();change(rows[1]);assert.equal(run(rows).size,0);
 }
});
test('old source version vetoes and distinct links continue to protect owner decisions',()=>{
 const rows=fixture(),old={...rows[1],id:'task1-old',sourceVersionOrdinal:0};rows[1].sourceVersionOrdinal=1;rows.push(old);const opts=options();opts.annotatedIds.add('task1-old');opts.annotations.set('task1-old',{patch:{kind:'expense',category:'Earlier decision'}});assert.equal(run(rows,opts).size,0);
 for(const link of[{type:'distinct',observationIds:['draw','task1']},{type:'group_distinct',observationIds:['draw','missing']},{type:'duplicate',status:'deleted',observationIds:['draw','sweep']}]){const o=options();o.links=[link];assert.equal(run(fixture(),o).size,0);}
 const annotatedDraw=options();annotatedDraw.annotatedIds.add('draw');assert.equal(run(fixture(),annotatedDraw).size,0);
});
test('overnight scope excludes manual sweeps, late automatic sweeps, other dates and altered automatic raw labels',()=>{
 for(const change of[o=>{o.description=manual;o.rawFields['\u5546\u54c1\u8bf4\u660e']=manual;},o=>o.occurredAt='2016-04-07T06:00:00+08:00',o=>{o.date='2016-04-08';o.occurredAt='2016-04-08T03:07:15+08:00';},o=>o.rawFields['\u5546\u54c1\u8bf4\u660e']=manual,o=>o.rawFields['\u4ea4\u6613\u72b6\u6001']='Unknown']){const rows=fixture({overnight:true});change(rows[3]);rows[3].rawFields['\u4ea4\u6613\u65f6\u95f4']=rows[3].date+' '+rows[3].occurredAt.slice(11,19);assert.equal(run(rows).size,0);}
 const long=fixture({overnight:true});long[0].occurredAt='2016-04-06T01:00:00+08:00';long[0].rawFields['\u4ea4\u6613\u65f6\u95f4']='2016-04-06 01:00:00';assert.equal(run(long).size,0);
});
test('unclosed budgets, unexplained credits, missing actual loan proof or bank receipt conflict stay unresolved',()=>{
 for(const change of[rows=>rows[3].amountMinor='585901',rows=>rows.push({...rows[1],id:'extra',sourceIdentity:'extra',sourceTransactionId:'extra',occurredAt:'2016-04-06T18:00:00+08:00',kind:'income',direction:'credit',amountMinor:'1'}),rows=>rows.push({...rows[0],id:'bankCredit',sourceIdentity:'bankCredit',financialAccountId:'bank',provider:'bank',statementFlow:{schema:'bank-debit-v1'},kind:'income',direction:'credit'})]){const rows=fixture({overnight:true});change(rows);assert.equal(run(rows).size,0);}
 const missing=options();missing.actualLoanDrawEvidence=new Map();assert.equal(run(fixture({overnight:true}),missing).size,0);
});
function separateFixture(){
 const rows=fixture(),repay={...rows[1],id:'otherFundRepay',sourceIdentity:'otherFundRepay',sourceTransactionId:'otherFundRepay',occurredAt:'2016-04-07T17:12:00+08:00',kind:'debt_payment',direction:'neutral',description:'\u4fe1\u7528\u5361\u8fd8\u6b3e',paymentChannel:'\u4f59\u989d\u5b9d',rawFields:{'\u4ea4\u6613\u65f6\u95f4':'2016-04-07 17:12:00','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'\u4f59\u989d\u5b9d','\u4ea4\u6613\u72b6\u6001':'\u8fd8\u6b3e\u6210\u529f'}};
 const card={...rows[1],id:'cardTask',sourceIdentity:'cardTask',sourceTransactionId:'cardTask',occurredAt:'2016-04-07T17:13:00+08:00',paymentChannel:'\u4ea4\u901a\u94f6\u884c\u4fe1\u7528\u5361(6077)',paymentAccountHint:'6077'};card.rawFields={...rows[1].rawFields,'\u4ea4\u6613\u65f6\u95f4':'2016-04-07 17:13:00','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':card.paymentChannel};rows.push(repay,card);
 const opts=options();opts.annotations.set('cardTask',{observationId:'cardTask',revision:'1',patch:{kind:'transfer',category:'Owner-confirmed course purchase',settlementAccountId:'tasks'}});
 const acc=[...accounts,{id:'card',provider:'\u4ea4\u901a\u94f6\u884c',type:'credit_card',maskedIdentifier:'6077',currency:'CNY',status:'active'}];return{rows,opts,acc};
}
test('original neutral product repayment and annotated card purchase are excluded from wallet budget, preserved and cited',()=>{
 const {rows,opts,acc}=separateFixture(),before=JSON.stringify([rows,[...opts.annotations],acc]),receipt=run(rows,opts,acc).get('draw');assert(receipt);assert.equal(receipt.sessionOutflowMinor,'1000000');assert.deepEqual(receipt.excludedNonWalletObservationIds,['cardTask','otherFundRepay']);assert(receipt.evidenceObservationIds.includes('cardTask'));assert(receipt.evidenceObservationIds.includes('otherFundRepay'));assert.equal(receipt.separatePaymentSourcesUnchanged,true);assert.equal(JSON.stringify([rows,[...opts.annotations],acc]),before);
});
test('separate payments need unique real source accounts, original raw payer and unchanged annotations',()=>{
 for(const mutate of[f=>f.acc.push({...f.acc.at(-1),id:'card2'}),f=>f.acc.pop(),f=>f.rows.find(o=>o.id==='cardTask').rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='Other',f=>f.rows.find(o=>o.id==='cardTask').paymentAccountHint='9999',f=>f.opts.annotations.get('cardTask').patch.feeMinor='1',f=>f.rows.find(o=>o.id==='otherFundRepay').paymentChannel='Other',f=>f.acc.splice(2,1)]){const f=separateFixture();mutate(f);assert.equal(run(f.rows,f.opts,f.acc).size,0);}
 const f=separateFixture();f.opts.links=[{type:'distinct',observationIds:['draw','cardTask']}];assert.equal(run(f.rows,f.opts,f.acc).size,0);
});
