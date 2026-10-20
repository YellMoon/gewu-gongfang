'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {accountProposals,buildAssetRegister}=require('./assetRegister');
const {buildFinanceView}=require('./ledger');
const wallet={id:'a',provider:'alipay',type:'wallet',currency:'CNY',status:'active',label:'Alipay',openingBalanceMinor:null};
const record=(patch={})=>({id:'o',financialAccountId:'a',provider:'alipay',status:'completed',sourceTransactionId:'order',date:'2026-10-01',occurredAt:'2026-10-01T10:00:00+08:00',amountMinor:'100',currency:'CNY',direction:'debit',kind:'expense',paymentAccountHint:'',paymentChannel:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,description:'',counterparty:'',category:'',relatedReference:'',...patch});
test('an owner-confirmed bank account supplies the missing type in a bare bank-channel label',()=>{
 const cmb={id:'cmb',provider:'\u62db\u5546\u94f6\u884c',type:'debit_card',maskedIdentifier:'7128',currency:'CNY',status:'active',label:'\u62db\u5546\u94f6\u884c\u50a8\u84c4\u5361\uff087128\uff09'},observations=[record({paymentChannel:'\u4e91\u95ea\u4ed8-\u62db\u5546\u94f6\u884c(7128)'})];
 const p=accountProposals({accounts:[wallet,cmb],observations});assert.equal(p.accounts.length,0);assert.equal(p.unresolved.length,0);
 const ambiguous=accountProposals({accounts:[wallet,cmb,{...cmb,id:'credit',type:'credit_card'}],observations});assert.equal(ambiguous.unresolved.length,1);
});
test('bank aliases and card types remain distinct across payment platforms',()=>{
 const observations=[record({paymentChannel:'\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361(1234)'}),record({id:'w',provider:'wechat',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361\uff081234\uff09'}),record({id:'c',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u4fe1\u7528\u5361(1234)'}),record({id:'n',paymentChannel:'\u62db\u5546\u94f6\u884c\u4fe1\u7528\u5361(1234)&\u7ea2\u5305'}),record({id:'unknown',paymentChannel:'\u4e91\u95ea\u4ed8-\u62db\u5546\u94f6\u884c(7128)'})];
 const proposals=accountProposals({accounts:[wallet],observations});assert.equal(proposals.accounts.length,3);assert.equal(proposals.unresolved.length,1);
 const accounts=proposals.accounts.map((a,i)=>({...a,id:'card'+i}));
 assert.equal(accountProposals({accounts,observations}).accounts.length,0);
 const view=buildFinanceView({accounts:[wallet,...accounts],observations:[observations[3]]});
 assert.equal(view.transactions[0].balanceEffects[accounts.find(a=>a.provider==='\u62db\u5546\u94f6\u884c').id],'-100');
 assert.equal(view.transactions[0].balanceEffects.a,undefined);
});
test('balance evidence is not a cash transaction; same-second proof order is respected',()=>{
 const evidence=[0,1].map(i=>record({id:'p'+i,importId:'proof',amountMinor:'0',direction:'neutral',kind:'transfer',balanceMinor:i?'0':'100',balanceEvidence:{schema:'alipay-balance-proof-v1',sequence:i+1}}));
 const ledger={accounts:[wallet],observations:evidence};
 assert.equal(buildFinanceView(ledger).transactions.length,0);
 assert.equal(buildFinanceView(ledger).accountStats.a.balanceMinor,'0');
 assert.equal(buildAssetRegister(ledger).accounts[0].verifiedBalance.balanceMinor,'0');
 const conflicted={...ledger,observations:[...evidence,{...evidence[0],id:'other',importId:'other'}]};
 assert.equal(buildFinanceView(conflicted).accountStats.a.balanceMinor,null);
 assert.equal(buildAssetRegister(conflicted).accounts[0].verifiedBalance,null);
});
test('available and distributor amounts never calibrate total assets or source wallet',()=>{
 const product={...wallet,id:'y',type:'investment',sourceProduct:'alipay_yuebao'};
 const proof=record({amountMinor:'0',direction:'neutral',kind:'transfer',balanceMinor:'0',accountRelations:[{product:'alipay_yuebao',financialAccountId:'y'}],balanceEvidence:{product:'alipay_yuebao',balanceKind:'available',sequence:1}});
 const ledger={accounts:[wallet,product],observations:[proof]};
 assert.equal(buildFinanceView(ledger).accountStats.y.balanceMinor,null);assert.equal(buildFinanceView(ledger).accountStats.a.balanceMinor,null);
 const rows=buildAssetRegister(ledger).accounts;assert.equal(rows[0].verifiedBalance,null);assert.equal(rows[1].verifiedBalance.balanceKind,'available');
});
test('credit snapshots preserve signed amounts, incomplete later versions do not erase confirmed evidence',()=>{
 const credit={...wallet,id:'credit',type:'credit_card'};
 const rows=buildAssetRegister({accounts:[credit],observations:[],balanceSnapshots:[{financialAccountId:'credit',asOf:'2026-10-01',balanceMinor:'500',source:'manual'}]}).accounts;
 assert.equal(rows[0].verifiedBalance.balanceMinor,'-500');
 const confirmations=[record({sourceIdentity:'same',sourceVersionOrdinal:1}),record({id:'failed',sourceIdentity:'same',sourceVersionOrdinal:2,status:'failed'})];
 assert.equal(buildAssetRegister({accounts:[wallet],observations:confirmations}).accounts[0].evidenceCount,1);
});
test('negative investment income reduces income, rather than inventing a positive return',()=>{
 const view=buildFinanceView({accounts:[wallet],observations:[record({kind:'income',direction:'debit',amountMinor:'1'})]});
 assert.equal(view.currencyTotals.CNY.incomeMinor,'-1');
});

test('bank detail coverage stays separate from platform funding evidence and source versions',()=>{
 const credit={...wallet,id:'credit',provider:'\u5efa\u8bbe\u94f6\u884c',type:'credit_card',maskedIdentifier:'1234',label:'\u5efa\u8bbe\u94f6\u884c\u4fe1\u7528\u5361(1234)'};
 const platform=record({id:'platform',date:'2023-01-01',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u4fe1\u7528\u5361(1234)'}),bank=record({id:'bank1',provider:'ccb',financialAccountId:'credit',date:'2024-09-15',sourceIdentity:'bank-order',sourceVersionOrdinal:1,bankStatement:{statementDate:'2024-09-18'}}),updated={...bank,id:'bank2',sourceVersionOrdinal:2};
 const input={accounts:[wallet,credit],observations:[platform,bank,updated]},before=JSON.stringify(input),r=buildAssetRegister(input).accounts.find(a=>a.id==='credit');
 assert.equal(r.firstDate,'2023-01-01');assert.deepEqual(r.bankStatementCoverage,{recordCount:1,firstTransactionDate:'2024-09-15',lastTransactionDate:'2024-09-15',statementMonths:['2024-09']});assert.equal(JSON.stringify(input),before);
 const platformOnly=buildAssetRegister({...input,observations:[platform]}).accounts.find(a=>a.id==='credit');assert.equal(platformOnly.evidenceCount,1);assert.equal(platformOnly.bankStatementCoverage.recordCount,0);assert.equal(platformOnly.bankStatementCoverage.firstTransactionDate,null);
});
