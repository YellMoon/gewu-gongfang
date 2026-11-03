'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {externalWechatReceipt}=require('./externalWechatReceipts'),{buildFinanceView}=require('./ledger');
const receipt=(patch={})=>({id:'receipt',financialAccountId:'wallet',provider:'wechat',sourceTransactionId:'receipt',date:'2026-05-27',occurredAt:'2026-05-27T22:53:52+08:00',amountMinor:'130000',currency:'CNY',direction:'credit',kind:'transfer',status:'completed',description:'\u8f6c\u8d26\u5907\u6ce8:\u52a0\u8bfe',counterparty:'Parent',category:'\u8f6c\u8d26',paymentChannel:'/',paymentAccountHint:'',balanceMinor:null,relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u8f6c\u8d26','\u6536/\u652f':'\u6536\u5165','\u4ea4\u6613\u5bf9\u65b9':'Parent','\u5f53\u524d\u72b6\u6001':'\u5df2\u5b58\u5165\u96f6\u94b1'},...patch});
test('source-confirmed external WeChat receipts count as income without a size threshold or changing originals',()=>{
 for(const amountMinor of ['1','130000','236000','12000000']){const source=receipt({amountMinor}),before=JSON.stringify(source),result=externalWechatReceipt(source);assert.equal(result.kind,'income');assert.equal(result.automaticClassification.method,'explicit_wechat_teaching_receipt');assert.equal(JSON.stringify(source),before);}
 const plain=externalWechatReceipt(receipt({description:'\u8f6c\u8d26\u5907\u6ce8:5.27'}));assert.equal(plain.kind,'income');assert.equal(plain.automaticClassification.provisionalPurpose,true);
});
test('self movements, source mismatches, loans, refunds, unfinished records and explicit owner decisions remain protected',()=>{
 for(const patch of [{direction:'debit'},{status:'pending'},{status:'failed'},{amountMinor:'0'},{provider:'alipay'},{kind:'refund'},{kind:'loan_drawdown'},{accountRelations:[{role:'funding'}]},{rawFields:{}}]){const source=receipt(patch);assert.strictEqual(externalWechatReceipt(source),source);}
 const self=receipt();assert.strictEqual(externalWechatReceipt(self,{excludedCounterparties:['Parent']}),self);
 for(const description of ['\u501f\u6b3e','\u8fd8\u94b1','\u9000\u6b3e','\u62a5\u9500','\u62bc\u91d1'])assert.equal(externalWechatReceipt(receipt({description})).kind,'unknown');
 const account={id:'wallet',provider:'wechat',type:'wallet',currency:'CNY',status:'active'},source=receipt(),ledger={accounts:[account],observations:[source],imports:[],links:[],annotations:[],balanceSnapshots:[]};
 const raw=JSON.stringify(ledger),view=buildFinanceView(ledger);assert.equal(view.currencyTotals.CNY.incomeMinor,'130000');assert.equal(JSON.stringify(ledger),raw);
 ledger.annotations=[{id:'owner',observationId:source.id,revision:'1',patch:{kind:'transfer',category:'Owner decision'}}];assert.equal(buildFinanceView(ledger).currencyTotals.CNY.incomeMinor,'0');
});
