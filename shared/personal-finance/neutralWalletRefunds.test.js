'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{refreshNeutralWalletRefund:refresh}=require('./neutralWalletRefunds'),{buildFinanceView}=require('./ledger');
function fixture(){
 const a={id:'wallet',provider:'alipay',type:'wallet',currency:'CNY',status:'active',label:'Wallet'},description='\u9000\u6b3e-\u54c8\u7f57\u5355\u8f66\u62bc\u91d1',counterparty='\u4e0a\u6d77\u94a7\u6b63\u7f51\u7edc\u79d1\u6280\u6709\u9650\u516c\u53f8',channel='\u4f59\u989d';
 const record={id:'r',financialAccountId:'wallet',provider:'alipay',sourceTransactionId:'2018022321001004250589953274_refund',sourceIdentity:'refund',sourceVersionOrdinal:1,relatedReference:'merchant-order',date:'2018-11-26',occurredAt:'2018-11-26T19:38:13+08:00',amountMinor:'19900',currency:'CNY',direction:'neutral',kind:'refund',status:'completed',description,counterparty,category:'Transport',paymentChannel:channel,paymentAccountHint:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u4ea4\u6613\u65f6\u95f4':'2018-11-26 19:38:13','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u91d1\u989d':'199.00','\u4ea4\u6613\u72b6\u6001':'\u9000\u6b3e\u6210\u529f','\u5546\u54c1\u8bf4\u660e':description,'\u4ea4\u6613\u5bf9\u65b9':counterparty,'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':channel,'\u4ea4\u6613\u8ba2\u5355\u53f7':'2018022321001004250589953274_refund','\u5546\u5bb6\u8ba2\u5355\u53f7':'merchant-order'}};
 return{accounts:[a],observations:[record],annotations:[],links:[],imports:[],balanceSnapshots:[]};
}
test('a successful neutral refund explicitly returned to the wallet credits cash without becoming income or changing the original',()=>{
 const l=fixture(),before=JSON.stringify(l),s=l.observations[0],r=refresh(s,l.accounts);assert.equal(r.direction,'credit');assert.equal(r.kind,'refund');assert.equal(r.automaticClassification.sourceDirection,'neutral');
 const v=buildFinanceView(l),t=v.transactions[0];assert.equal(t.balanceEffects.wallet,'19900');assert.equal(t.cashEffects.wallet,'19900');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(t.consumptionMinor,'-19900');assert.equal(JSON.stringify(l),before);
});
test('independent balances catch the old missing cash and verify the actual refund posting',()=>{
 const l=fixture(),anchor={financialAccountId:'wallet',currency:'CNY',source:'owner_confirmation',balanceMinor:'0'};l.balanceSnapshots=[{...anchor,id:'before',asOf:'2018-11-26T19:38:12+08:00'},{...anchor,id:'after',asOf:'2018-11-26T19:38:13+08:00',balanceMinor:'19900'}];
 const v=buildFinanceView(l);assert.equal(v.balanceReconciliation.summary.balancedIntervalCount,1);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(v.review.transactionCount,0);
});
test('noncash rewards, other banks, failed or malformed originals and explicit product routing do not turn into wallet money',()=>{
 const changes=[s=>s.kind='transfer',s=>s.status='failed',s=>s.direction='debit',s=>s.paymentChannel='\u7ea2\u5305',s=>s.paymentAccountHint='1234',s=>s.accountRelations=[{role:'funding',product:'alipay_yuebao'}],s=>s.rawFields['\u4ea4\u6613\u72b6\u6001']='\u4ea4\u6613\u5173\u95ed',s=>s.rawFields['\u91d1\u989d']='199.01',s=>s.rawFields['\u91d1\u989d']='199.000',s=>s.rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']='other',s=>s.rawFields['\u4ea4\u6613\u65f6\u95f4']='2018-11-26',s=>s.rawFields['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']='\u4f59\u989d\u5b9d'];
 for(const change of changes){const l=fixture(),s=l.observations[0];change(s);assert.strictEqual(refresh(s,l.accounts),s);}
 const l=fixture();l.accounts[0].provider='wechat';assert.strictEqual(refresh(l.observations[0],l.accounts),l.observations[0]);
});
test('owner decisions and newer conflicting source versions remain authoritative',()=>{
 const l=fixture();l.annotations=[{observationId:'r',revision:'1',patch:{kind:'transfer',category:'Owner choice'}}];assert.notEqual(buildFinanceView(l).transactions[0].automaticClassification?.method,'explicit_neutral_wallet_refund_cash');
 const f=fixture(),old=f.observations[0];f.observations.unshift({...old,id:'new-r',sourceVersionOrdinal:2,status:'failed',rawFields:{...old.rawFields,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u5173\u95ed'}});assert(!buildFinanceView(f).transactions.some(t=>t.balanceEffects.wallet==='19900'));
});
