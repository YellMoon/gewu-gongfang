'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{findWechatWithdrawalMatches}=require('./withdrawals');
const accounts=[{id:'wallet',type:'wallet',currency:'CNY',provider:'wechat',status:'active'},{id:'bank',type:'debit_card',currency:'CNY',provider:'\u534e\u590f\u94f6\u884c',label:'\u534e\u590f\u94f6\u884c\u50a8\u84c4\u5361\uff080900\uff09',maskedIdentifier:'0900',status:'active'}];
const wallet=(patch={})=>({id:'w',provider:'wechat',financialAccountId:'wallet',status:'completed',kind:'transfer',direction:'neutral',date:'2026-10-18',currency:'CNY',amountMinor:'2540026',paymentChannel:'\u534e\u590f\u94f6\u884c\u50a8\u84c4\u5361(0900)',rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u96f6\u94b1\u63d0\u73b0'},...patch});
const bank=(patch={})=>({id:'b',provider:'huaxia',financialAccountId:'bank',status:'completed',kind:'unknown',direction:'credit',date:'2026-10-18',currency:'CNY',amountMinor:'2537499',description:'\u94f6\u8054\u94f6\u8054\u5165\u8d26 \u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0',counterparty:'owner',statementFlow:{schema:'huaxia-debit-v1'},...patch});
test('a unique net receipt exposes the actual discounted fee and preserves both original amounts',()=>{
 const rows=[wallet(),bank()],before=JSON.stringify(rows),[m]=findWechatWithdrawalMatches(rows,accounts);
 assert.equal(m.grossMinor,'2540026');assert.equal(m.netMinor,'2537499');assert.equal(m.feeMinor,'2527');assert.equal(m.feeCapMinor,'2537');assert.equal(m.targetAccountId,'bank');assert.equal(m.confidence,'inferred');assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(findWechatWithdrawalMatches([wallet()],accounts),[],'a missing bank receipt must not synthesize a fee or net amount');
});
test('target card, bank channel, currency, date, directions, status, and fee cap all constrain a match',()=>{
 const pairs=[bank({financialAccountId:'other'}),bank({description:'transfer'}),bank({currency:'USD'}),bank({date:'2026-10-19'}),bank({direction:'debit'}),bank({status:'pending'}),bank({amountMinor:'2530000'}),bank({amountMinor:'2540027'}),bank({kind:'income'})];
 for(const b of pairs)assert.deepEqual(findWechatWithdrawalMatches([wallet(),b],accounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([wallet({kind:'expense'}),bank()],accounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([wallet(),bank()],[...accounts,{...accounts[1],id:'duplicate-card'}]),[]);
});
test('source roots enforce reciprocal uniqueness and honor user rejection and occupied or annotated receipts',()=>{
 const w=wallet(),b=bank();
 assert.deepEqual(findWechatWithdrawalMatches([w,bank({id:'b2'}),b],accounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,wallet({id:'w2'}),b],accounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,b],accounts,{isBlocked:()=>true}),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,b],accounts,{occupiedBankRoots:new Set(['b'])}),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,b],accounts,{annotatedIds:new Set(['b'])}),[]);
 const rows=[w,wallet({id:'w2',sourceVersionOrdinal:2}),b,bank({id:'b2',sourceVersionOrdinal:2})],rootOf=id=>id[0];
 const matches=findWechatWithdrawalMatches(rows,accounts,{rootOf});assert.equal(matches.length,1);assert.equal(matches[0].wallet.id,'w2');assert.equal(matches[0].bank.id,'b2');
 assert.deepEqual(findWechatWithdrawalMatches(rows,accounts,{rootOf,annotatedIds:new Set(['b'])}),[],'a new source version cannot bypass a manual classification');
 assert.deepEqual(findWechatWithdrawalMatches([w,wallet({id:'w2',sourceVersionOrdinal:2,status:'failed'}),b],accounts,{rootOf}),[],'a superseded successful version must not override the latest failed record');
 assert.deepEqual(findWechatWithdrawalMatches(rows,accounts,{rootOf,isBlocked:(a,b)=>rootOf(a)==='w'&&rootOf(b)==='b'}),[]);
});
const psbcAccounts=[accounts[0],{...accounts[1],provider:'\u90ae\u50a8\u94f6\u884c',label:'\u90ae\u50a8\u94f6\u884c\u50a8\u84c4\u5361(1641)',maskedIdentifier:'1641'}];
const timedWallet=(patch={})=>wallet({date:'2024-03-19',occurredAt:'2024-03-19T04:48:43+08:00',amountMinor:'320310',paymentChannel:'\u90ae\u50a8\u94f6\u884c\u50a8\u84c4\u5361(1641)',...patch});
const timedBank=(patch={})=>bank({provider:'psbc',date:'2024-03-19',occurredAt:'2024-03-19T04:48:44+08:00',amountMinor:'320000',description:'\u94f6\u8054\u5165\u8d26',counterparty:'',statementFlow:{schema:'psbc-debit-v1',timePrecision:'second'},...patch});
test('a real bank timestamp within two seconds can replace an omitted wallet channel',()=>{
 const rows=[timedWallet(),timedBank()],before=JSON.stringify(rows),[match]=findWechatWithdrawalMatches(rows,psbcAccounts);
 assert.equal(match.feeMinor,'310');assert.equal(match.matchBasis,'precise_bank_receipt_time');assert.equal(match.bankReceiptDelaySeconds,1);assert.equal(match.method,'wechat_withdrawal_net_receipt');assert.equal(JSON.stringify(rows),before);
 for(const second of ['43','45'])assert.equal(findWechatWithdrawalMatches([timedWallet(),timedBank({occurredAt:'2024-03-19T04:48:'+second+'+08:00'})],psbcAccounts).length,1);
 for(const patch of [{occurredAt:'2024-03-19T04:48:42+08:00'},{occurredAt:'2024-03-19T04:48:46+08:00'},{occurredAt:'2024-03-19T23:59:59+08:00'}, {occurredAt:undefined},{statementFlow:{schema:'psbc-debit-v1',timePrecision:'day'}},{statementFlow:{schema:'psbc-debit-v1'}},{description:'\u652f\u4ed8\u5b9d\u8f6c\u8d26'},{amountMinor:'319000'},{financialAccountId:'other'}])assert.deepEqual(findWechatWithdrawalMatches([timedWallet(),timedBank(patch)],psbcAccounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([timedWallet({occurredAt:undefined}),timedBank()],psbcAccounts),[]);
});
test('precise receipt inference still rejects competing receipts, duplicate wallet candidates and source-root vetoes',()=>{
 const w=timedWallet(),b=timedBank(),rootOf=id=>id[0];
 assert.deepEqual(findWechatWithdrawalMatches([w,b,timedBank({id:'other-bank'})],psbcAccounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,timedWallet({id:'other-wallet'}),b],psbcAccounts),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,b],psbcAccounts,{isBlocked:()=>true}),[]);
 assert.deepEqual(findWechatWithdrawalMatches([w,b],psbcAccounts,{occupiedBankRoots:new Set(['b'])}),[]);
 const rows=[w,timedWallet({id:'w2',sourceVersionOrdinal:2}),b,timedBank({id:'b2',sourceVersionOrdinal:2})];
 assert.equal(findWechatWithdrawalMatches(rows,psbcAccounts,{rootOf}).length,1);
 assert.deepEqual(findWechatWithdrawalMatches(rows,psbcAccounts,{rootOf,annotatedIds:new Set(['b'])}),[]);
 assert.deepEqual(findWechatWithdrawalMatches(rows,psbcAccounts,{rootOf,isBlocked:(a,b)=>rootOf(a)==='w'&&rootOf(b)==='b'}),[]);
});
test('the five PSBC receipt shapes retain the actual discounted fees instead of charging the standard cap',()=>{
 const examples=[['2024-03-19','04:48:43','04:48:44','320310','320000'],['2024-03-19','19:36:10','19:36:11','1961850','1960000'],['2024-05-19','07:59:05','07:59:06','312312','312000'],['2024-08-18','09:36:19','09:36:20','311812','311500'],['2024-09-19','17:25:28','17:25:29','300300','300000']];
 const rows=examples.flatMap(([date,wt,bt,gross,net],i)=>[timedWallet({id:'w'+i,date,occurredAt:date+'T'+wt+'+08:00',amountMinor:gross}),timedBank({id:'b'+i,date,occurredAt:date+'T'+bt+'+08:00',amountMinor:net})]);
 const matches=findWechatWithdrawalMatches(rows,psbcAccounts);assert.equal(matches.length,5);assert.equal(matches.reduce((sum,m)=>sum+BigInt(m.feeMinor),0n),3084n);assert.ok(matches.every(m=>m.bankReceiptDelaySeconds===1));
});
