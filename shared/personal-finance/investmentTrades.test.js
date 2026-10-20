'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateInvestmentTrade}=require('./investmentTrades');
const {validateRecord,buildFinanceView}=require('./ledger');
const meta={schema:'ant-fund-confirmation-v1',orderId:'202610010000000000000001',fundCode:'000001',fundName:'Synthetic fund',combination:null,tradeType:'buy',sourceTradeType:'buy',appliedAmountMinor:'100000',appliedUnits:null,confirmedAmountMinor:'100000',confirmedUnits:'260.2300',feeMinor:'149',confirmedAt:'2026-10-03T00:00:00+08:00',sourcePages:[2,3]};
const base={id:'confirmation',financialAccountId:'wallet',provider:'alipay',sourceTransactionId:'fund-order',date:'2026-10-01',occurredAt:'2026-10-01T10:00:00+08:00',amountMinor:'100000',direction:'neutral',kind:'transfer',currency:'CNY',status:'completed',description:'Synthetic fund buy',counterparty:'Synthetic',category:'Investment',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:'149',rawFields:{},investmentTrade:meta,accountRelations:[{product:'alipay_funds',activity:'investment_confirmation',role:'target',financialAccountId:'funds'}]};
const accounts=[{id:'wallet',type:'wallet',currency:'CNY',openingBalanceMinor:'200000',openingDate:'2026-01-01'},{id:'funds',type:'investment',currency:'CNY',openingBalanceMinor:null,openingDate:null}];
test('confirmation fees do not create a second purchase cash movement or invent a holding value',()=>{
 validateRecord(base);const purchase={...base,id:'payment',sourceTransactionId:'payment-order',investmentTrade:undefined,feeMinor:null,paymentChannel:'\u4f59\u989d',accountRelations:[{product:'alipay_funds',activity:'investment_deposit',role:'target',financialAccountId:'funds'}]};
 const view=buildFinanceView({accounts,observations:[purchase,base]});
 assert.equal(view.currencyTotals.CNY.consumptionMinor,'149');assert.equal(view.accountStats.wallet.balanceMinor,'100000');assert.equal(view.accountStats.funds.balanceMinor,null);assert.equal(view.investmentTrades.length,1);assert.equal(view.investmentTrades[0].confirmedUnits,'260.2300');assert.equal(view.investmentTrades[0].feeMinor,'149');
});
test('repeated source versions and manually linked payment/confirmation keep exactly one fee',()=>{
 const old={...base,id:'old',sourceIdentity:'same',sourceVersionOrdinal:1};const latest={...base,id:'latest',sourceIdentity:'same',sourceVersionOrdinal:2};
 const view=buildFinanceView({accounts,observations:[old,latest],links:[]});assert.equal(view.transactions.length,1);assert.equal(view.currencyTotals.CNY.consumptionMinor,'149');assert.equal(view.investmentTrades.length,1);
 const payment={...base,id:'payment',investmentTrade:undefined,feeMinor:null,accountRelations:[],paymentChannel:'',direction:'debit'};
 const linked=buildFinanceView({accounts,observations:[payment,base],links:[{id:'confirmed',type:'duplicate',status:'active',observationIds:['payment','confirmation']}]});assert.equal(linked.currencyTotals.CNY.consumptionMinor,'149');assert.equal(linked.transactions.length,1);
});
test('unnamed conversion preserves missing confirmation fields and cannot fabricate fund shares',()=>{
 const investmentTrade={...meta,tradeType:'conversion',sourceTradeType:'conversion',fundCode:null,fundName:null,confirmedAmountMinor:null,confirmedUnits:null,appliedUnits:'12.345600',feeMinor:'0'};
 const r={...base,investmentTrade,feeMinor:'0'};validateRecord(r);const view=buildFinanceView({accounts,observations:[r]});assert.equal(view.investmentTrades[0].confirmedUnits,null);assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.accountStats.wallet.balanceMinor,'200000');assert(view.unresolvedAssociations.some(x=>x.reason==='unidentified_fund_conversion'));
});
test('exact decimal shares, fee amounts and known schema are validated before import',()=>{
 for(const patch of [{confirmedUnits:'1e3'},{confirmedUnits:'1.1234567890123'},{feeMinor:'1.49'},{fundCode:null},{sourcePages:[3,2]},{schema:'untrusted'}])assert.throws(()=>validateInvestmentTrade({...meta,...patch}),/INVESTMENT_INVALID/);
 assert.throws(()=>validateInvestmentTrade(meta,{...base,feeMinor:'0'}),/INVESTMENT_INVALID/);
});
test('cross-source conversion products remove only the obsolete product-identity gap',()=>{
 const investmentTrade={...meta,tradeType:'conversion',sourceTradeType:'conversion',fundCode:null,fundName:null,confirmedAmountMinor:null,confirmedUnits:null,appliedUnits:'12.345600',feeMinor:'0'};
 const conversion={...base,id:'conversion',investmentTrade,feeMinor:'0'};
 const from={...base,id:'from-fund',sourceTransactionId:'from-order',investmentTrade:{...meta,fundName:'From fund'}};
 const to={...base,id:'to-fund',sourceTransactionId:'to-order',investmentTrade:{...meta,fundCode:'000002',fundName:'To fund'}};
 const receipt={...base,id:'conversion-receipt',sourceTransactionId:meta.orderId,date:'2026-10-03',occurredAt:'2026-10-03T10:00:00+08:00',investmentTrade:undefined,feeMinor:null,description:'\u8682\u8681\u8d22\u5bcc-From fund-\u300c\u8f6c\u6362\u81f3\u300d-To fund-\u8f6c\u5165\u6210\u529f',accountRelations:[{product:'alipay_funds',role:'target',activity:'investment_exchange',financialAccountId:'funds'}]};
 const view=buildFinanceView({accounts,observations:[conversion,from,to,receipt]});
 assert(!view.unresolvedAssociations.some(x=>x.reason==='unidentified_fund_conversion'));
 assert.equal(view.investmentTrades.find(t=>t.tradeType==='conversion').confirmedUnits,null,'matched products do not invent confirmed incoming shares');
});
