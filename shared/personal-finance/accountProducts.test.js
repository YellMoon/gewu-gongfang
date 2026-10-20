'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inferAccountRelations}=require('./accountProducts');
const {buildFinanceView}=require('./ledger');
const account=(id,type,balance='0')=>({id,type,label:id,provider:'alipay',currency:'CNY',status:'active',balanceConvention:'signed',openingBalanceMinor:balance,openingDate:'2026-01-01',maskedIdentifier:''});
const record=(id,extra={})=>({id,financialAccountId:'wallet',provider:'alipay',sourceTransactionId:id,date:'2026-10-01',occurredAt:'2026-10-01T12:00:00+08:00',direction:'neutral',kind:'transfer',amountMinor:'50000',currency:'CNY',status:'completed',description:'',category:'',counterparty:'',paymentChannel:'',paymentAccountHint:'',relatedReference:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{},...extra});
const ledger=(accounts,observations,extra={})=>({accounts,observations,links:[],annotations:[],balanceSnapshots:[],...extra});
test('owner-confirmed counter-account annotations associate evidence without inventing a receiving balance or cash leg',()=>{
 const source=record('bank-transfer',{financialAccountId:'bank',provider:'ccb',kind:'unknown',direction:'debit'}),bank=account('bank','debit_card'),broker={...account('broker','investment'),label:'Brokerage 8253',openingBalanceMinor:null,openingDate:null},annotation={id:'binding',observationId:source.id,revision:'1',patch:{kind:'transfer',category:'\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff1a'+broker.label}},input=ledger([bank,broker],[source],{annotations:[annotation]}),original=JSON.stringify(input),v=buildFinanceView(input);
 assert.equal(v.review.transactionCount,0);assert(v.transactions[0].financialAccountIds.includes(broker.id));assert.equal(v.transactions[0].balanceEffects.broker,undefined);assert.equal(v.accountStats.broker.balanceMinor,null);assert.equal(v.currencyTotals.CNY.cashOutMinor,'50000');assert.equal(require('./assetRegister').buildAssetRegister(input).accounts.find(a=>a.id===broker.id).evidenceCount,1);assert.equal(JSON.stringify(input),original);
 const {annotatedCounterAccount}=require('./statementAccounts');assert.equal(annotatedCounterAccount(source,annotation,[bank,broker,{...broker,id:'ambiguous'}]),null);assert.equal(annotatedCounterAccount(source,annotation,[bank,{...broker,currency:'USD'}]),null);assert.equal(annotatedCounterAccount(source,{...annotation,patch:{...annotation.patch,kind:'expense'}},[bank,broker]),null);
});
test('historical Licaitong purchases discover an actual product account and preserve unconfirmed units',()=>{
 const {accountProposals}=require('./assetRegister'),wallet={...account('wallet','wallet'),provider:'wechat'},r=record('licaitong',{provider:'wechat',description:'Example fund (000719)',counterparty:'\u7406\u8d22\u901a',paymentChannel:'\u96f6\u94b1',rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u8d2d\u4e70\u7406\u8d22\u901a'}});
 const proposed=accountProposals(ledger([wallet],[r])).accounts;assert.equal(proposed.length,1);assert.equal(proposed[0].sourceProduct,'wechat_licaitong');assert.equal(proposed[0].openingBalanceMinor,null);
 const product={...proposed[0],id:'licaitong'},v=buildFinanceView(ledger([wallet,product],[r]));assert.equal(v.review.transactionCount,0);assert.equal(v.transactions[0].balanceEffects.licaitong,'50000');assert.equal(v.transactions[0].balanceEffects.wallet,'-50000');assert.equal(v.accountStats.licaitong.balanceMinor,null);assert.equal(require('./assetRegister').buildAssetRegister(ledger([wallet,product],[r])).products.length,0);assert.equal(r.accountRelations,undefined);
 const missing=buildFinanceView(ledger([wallet],[r]));assert(missing.unresolvedAssociations.some(x=>x.reason==='unresolved_product_account'));
});
test('credit purchase -1000 and repayment +500 leave -500 debt and do not charge consumption twice',()=>{
 const accounts=[account('wallet','wallet','100000'),account('credit','credit_card')];
 const buy=record('buy',{amountMinor:'100000',direction:'debit',kind:'expense',accountRelations:[{product:'alipay_huabei',activity:'credit_charge',role:'funding',financialAccountId:'credit'}]});
 const repay=record('repay',{kind:'debt_payment',paymentChannel:'\u4f59\u989d',accountRelations:[{product:'alipay_huabei',activity:'repayment',role:'target',financialAccountId:'credit'}]});
 const v=buildFinanceView(ledger(accounts,[buy,repay]));
 assert.equal(v.accountStats.credit.balanceMinor,'-50000');assert.equal(v.accountStats.wallet.balanceMinor,'50000');assert.equal(v.currencyTotals.CNY.consumptionMinor,'100000');assert.equal(v.transactions.length,2);assert.equal(v.transactions[1].balanceEffects.credit,'50000');
 assert.equal(v.currencyTotals.CNY.cashOutMinor,'50000');
});
test('unknown repayment funding is retained without a fabricated wallet debit; explicit fees remain consumption',()=>{
 const repay=record('repay',{kind:'debt_payment',amountMinor:'53000',principalMinor:'50000',interestMinor:'2000',feeMinor:'1000',accountRelations:[{product:'alipay_huabei',activity:'repayment',role:'target',financialAccountId:'credit'}]});
 const v=buildFinanceView(ledger([account('wallet','wallet','100000'),account('credit','credit_card','-100000')],[repay]));
 assert.equal(v.accountStats.credit.balanceMinor,'-50000');assert.equal(v.accountStats.wallet.balanceMinor,'100000');assert.equal(v.currencyTotals.CNY.consumptionMinor,'3000');assert(v.unresolvedAssociations.some(x=>x.reason==='unresolved_funding_account'));
});
test('investment movements associate the original source and preserve valuation calibration boundary',()=>{
 const r=record('investment',{paymentChannel:'\u4f59\u989d',accountRelations:[{product:'alipay_yulibao',activity:'investment_deposit',role:'target',financialAccountId:'investment'}]});
 const v=buildFinanceView(ledger([account('wallet','wallet','100000'),{...account('investment','investment'),openingBalanceMinor:null,openingDate:null}],[r]));
 assert.equal(v.transactions.length,1);assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert.equal(v.currencyTotals.CNY.netCashFlowMinor,'0');assert.equal(v.accountStats.wallet.balanceMinor,'50000');assert.equal(v.accountStats.investment.balanceMinor,null);assert.deepEqual(v.transactions[0].financialAccountIds,['wallet','investment']);
});
test('legacy positive debt anchors normalize once; explicitly signed manual snapshots stay negative',()=>{
 const legacy={...account('credit','credit_card','100000')};delete legacy.balanceConvention;
 let v=buildFinanceView(ledger([legacy],[]));assert.equal(v.accountStats.credit.balanceMinor,'-100000');
 v=buildFinanceView(ledger([legacy],[],{balanceSnapshots:[{id:'signed',financialAccountId:'credit',currency:'CNY',asOf:'2026-10-01T00:00:00Z',balanceMinor:'-50000',balanceConvention:'signed',source:'manual'}]}));assert.equal(v.accountStats.credit.balanceMinor,'-50000');
});
test('product funding hint cannot debit a bank twice without a shared transaction reference',()=>{
 const accounts=[account('wallet','wallet'),account('bank','bank','100000'),account('credit','credit_card','-100000')];
 const bank=record('bank-source',{financialAccountId:'bank',direction:'debit',kind:'debt_payment'});
 const repayment=record('repayment',{kind:'debt_payment',paymentAccountHint:'bank',accountRelations:[{product:'alipay_huabei',activity:'repayment',role:'target',financialAccountId:'credit'}]});
 const v=buildFinanceView(ledger(accounts,[bank,repayment]));assert.equal(v.accountStats.bank.balanceMinor,'50000');assert(v.unresolvedAssociations.some(x=>x.reason==='insufficient_reference'));
});
test('products are inferred from actual source product names and payment channels only',()=>{
 assert.deepEqual(inferAccountRelations(record('unidentified',{kind:'debt_payment',description:'repayment'}),'alipay'),[]);
 assert.deepEqual(inferAccountRelations(record('charge',{kind:'expense',direction:'debit',paymentChannel:'\u82b1\u5457'}),'alipay'),[{product:'alipay_huabei',activity:'credit_charge',role:'funding'}]);
 assert.deepEqual(inferAccountRelations(record('charge',{kind:'expense',direction:'debit',paymentChannel:'\u82b1\u5457'}),'bank'),[]);
});

test('actual fund purchase and conversion patterns retain one investment account without inventing conversion inflow',()=>{
 const buy=record('fund-buy',{description:'蚂蚁财富-测试混合A-买入',counterparty:'蚂蚁（杭州）基金销售有限公司',category:'投资理财'});
 const exchange=record('fund-exchange',{description:'蚂蚁财富-测试混合A-「转换至」-测试混合B-转入成功',counterparty:'蚂蚁（杭州）基金销售有限公司',category:'投资理财'});
 assert.deepEqual(inferAccountRelations(buy,'alipay'),[{product:'alipay_funds',activity:'investment_deposit',role:'target'}]);
 const relations=inferAccountRelations(exchange,'alipay');assert.deepEqual(relations,[{product:'alipay_funds',activity:'investment_exchange',role:'target'}]);
 exchange.accountRelations=relations.map(r=>({...r,financialAccountId:'funds'}));const v=buildFinanceView(ledger([account('wallet','wallet','100000'),account('funds','investment','100000')],[exchange]));assert.equal(v.accountStats.wallet.balanceMinor,'100000');assert.equal(v.transactions[0].balanceEffects.funds,'0');assert.equal(v.currencyTotals.CNY.netCashFlowMinor,'0');
});
