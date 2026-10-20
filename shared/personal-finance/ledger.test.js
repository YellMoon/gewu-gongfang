'use strict';
const assert = require('node:assert/strict');
let buildFinanceView;
try { ({buildFinanceView}=require('./ledger')); } catch (error) { if(error.code!=='MODULE_NOT_FOUND') throw error; }
assert.equal(typeof buildFinanceView,'function','finance engine must exist');
const account=(id,type='bank',extra={})=>({id,label:id,provider:id,type,maskedIdentifier:id,currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active',...extra});
const observation=(id,financialAccountId,extra={})=>({id,financialAccountId,provider:financialAccountId,sourceTransactionId:id,occurredAt:'2026-10-08T10:00:00+08:00',date:'2026-10-08',amountMinor:'100',currency:'CNY',direction:'debit',kind:'expense',description:'Books',counterparty:'Shop',category:'Books',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{},...extra});
const ledger=(accounts,observations,extra={})=>({accounts,observations,links:[],balanceSnapshots:[],imports:[],legacyRecords:[],revision:0,...extra});
let view=buildFinanceView(ledger([account('bank')],[observation('a','bank'),observation('b','bank')]));
assert.equal(view.transactions.length,2,'same date and amount are independent');
assert.equal(view.currencyTotals.CNY.consumptionMinor,'200');
assert.equal(view.accountStats.bank.balanceMinor,null,'flow difference is not balance');
view=buildFinanceView(ledger([account('bank','bank',{maskedIdentifier:'1234',openingBalanceMinor:'1000',openingDate:'2026-10-01'}),account('ali','wallet')],[observation('b','bank',{relatedReference:'ref1'}),observation('w','ali',{relatedReference:'ref1',paymentAccountHint:'1234',paymentChannel:'alipay'})]));
assert.equal(view.transactions.length,1,'one-to-one reference and funding evidence link sources');
assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');
assert.equal(view.accountStats.bank.balanceMinor,'900');
assert.equal(view.accountStats.ali.cashOutMinor,'0','card financed wallet does not invent wallet debit');
assert.equal(view.accountStats.ali.consumptionMinor,'0','a payment channel is not the actual spending account');
assert.equal(view.fundingTotals.bank.CNY,'100');
view=buildFinanceView(ledger([account('bank'),account('ali','wallet')],[observation('b','bank',{relatedReference:'r'}),observation('c','bank',{relatedReference:'r'}),observation('w','ali',{relatedReference:'r',paymentAccountHint:'bank'})]));
assert.equal(view.transactions.length,3,'ambiguous candidates never silently merge');
assert.ok(view.unresolvedAssociations.some(x=>x.reason==='ambiguous_reference'));
view=buildFinanceView(ledger([account('bank'),account('card','credit_card'),account('usd','bank',{currency:'USD'})],[observation('buy','card',{amountMinor:'500'}),observation('repay','bank',{kind:'debt_payment',amountMinor:'530',principalMinor:'500',interestMinor:'20',feeMinor:'10'}),observation('loan','bank',{kind:'loan_drawdown',direction:'credit',amountMinor:'10000'}),observation('transfer','bank',{kind:'transfer',amountMinor:'700'}),observation('refund','card',{kind:'refund',direction:'credit',amountMinor:'100',relatedReference:'buy'}),observation('us','usd',{currency:'USD',amountMinor:'9007199254740993'})]));
assert.equal(view.currencyTotals.CNY.consumptionMinor,'430');
assert.equal(view.currencyTotals.CNY.incomeMinor,'0');
assert.equal(view.currencyTotals.USD.consumptionMinor,'9007199254740993');
assert.equal(view.currencyTotals.CNY.cashOutMinor,'1230','credit consumption is not current cash out');
assert.equal(view.currencyTotals.CNY.cashInMinor,'10000');
assert.equal(view.transactions.find(x=>x.observationIds.includes('refund')).relatedTransactionId,'buy');
view=buildFinanceView(ledger([account('bank')],[observation('pending','bank',{status:'pending'}),observation('unknown','bank',{kind:'debt_payment'})]));
assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');
assert.ok(view.unresolvedAssociations.some(x=>x.reason==='unresolved_debt_account'));
view=buildFinanceView(ledger([account('bank')],[observation('before','bank',{date:'2026-10-01',occurredAt:'2026-10-01T10:00:00Z'}),observation('after','bank')],{balanceSnapshots:[{id:'snap',financialAccountId:'bank',asOf:'2026-10-02T00:00:00Z',balanceMinor:'1000',currency:'CNY',source:'statement'}]}),{accountIds:['bank'],startDate:'2026-10-08',endDate:'2026-10-08'});
assert.equal(view.accountStats.bank.balanceMinor,'900');
assert.equal(view.accountStats.bank.balanceAnchor.id,'snap');
assert.equal(view.comparison.previous.currencyTotals.CNY.consumptionMinor,'0');
assert.equal(view.categoryTotals.CNY.Books,'100');
const transferSources=[observation('out','bank'),observation('in','cash',{direction:'credit',kind:'income'})];
view=buildFinanceView(ledger([account('bank'),account('cash','cash')],transferSources,{links:[{id:'transfer-link',type:'transfer',status:'active',observationIds:['out','in']}]}));
assert.equal(view.currencyTotals.CNY.consumptionMinor,'0','manual transfer evidence reclassifies both legs');
assert.equal(view.currencyTotals.CNY.incomeMinor,'0');
assert.equal(view.currencyTotals.CNY.netCashFlowMinor,'0');
view=buildFinanceView(ledger([account('bank'),account('ali','wallet')],[observation('b','bank',{relatedReference:'r'}),observation('w','ali',{relatedReference:'r',paymentAccountHint:'bank'})],{links:[{id:'unlinked',type:'duplicate',status:'deleted',observationIds:['b','w']}]}));
assert.equal(view.transactions.length,2,'unlink persists manual decision instead of silently relinking');
view=buildFinanceView(ledger([account('property','property',{openingBalanceMinor:'50000000',openingDate:'2026-01-01'})],[observation('maintenance','property',{amountMinor:'5000'})]));
assert.equal(view.accountStats.property.balanceMinor,'50000000','non-cash asset calibration never projects market value from expenses');
assert.equal(view.accountStats.property.balanceStatus,'calibrated');
view=buildFinanceView(ledger([account('bank','bank',{maskedIdentifier:'1234'}),account('ali','wallet')],[observation('b','bank',{relatedReference:'x',occurredAt:'2026-10-08T12:00:00Z'}),observation('w','ali',{relatedReference:'x',paymentAccountHint:'1234',occurredAt:'2026-10-08T10:00:00Z'})],{balanceSnapshots:[{id:'snap2',financialAccountId:'bank',asOf:'2026-10-08T11:00:00Z',balanceMinor:'1000',currency:'CNY',source:'manual'}]}));
assert.equal(view.accountStats.bank.balanceMinor,'900','bank movement uses bank source booking time');
view=buildFinanceView(ledger([account('bank'),account('card','credit_card')],[observation('cardbuy','card',{amountMinor:'500'}),observation('repayment','bank',{kind:'debt_payment',amountMinor:'530',principalMinor:'500',interestMinor:'20',feeMinor:'10'})]));
assert.equal(view.fundingBreakdown.CNY.creditFundedConsumptionMinor,'500');
assert.equal(view.fundingBreakdown.CNY.loanPrincipalPaidMinor,'500');
assert.equal(view.fundingBreakdown.CNY.interestPaidMinor,'20');
assert.equal(view.fundingBreakdown.CNY.feesPaidMinor,'10');
view=buildFinanceView(ledger([account('bank')],[observation('buy','bank',{category:'Food'}),observation('return','bank',{kind:'refund',direction:'credit',category:'Refunds',amountMinor:'20',relatedReference:'buy'})]));
assert.equal(view.categoryTotals.CNY.Food,'80','linked refunds reduce original purchase category');
view=buildFinanceView(ledger([account('bank'),account('ali','wallet')],[observation('b','bank',{relatedReference:'r'}),observation('w','ali',{relatedReference:'r',paymentAccountHint:'bank'})]),{accountIds:['ali']});
assert.equal(view.fundingTotals.bank,undefined,'channel selection does not include an unselected funding account in statistics');
assert.equal(view.currencyTotals.CNY.cashOutMinor,'0','unselected funding account cash flow is excluded');
view=buildFinanceView(ledger([account('__proto__')],[observation('safe','__proto__',{category:'constructor'})]));
assert.equal(view.accountStats['__proto__'].cashOutMinor,'100');
assert.equal(view.categoryTotals.CNY.constructor,'100','untrusted names cannot collide with object prototypes');
view=buildFinanceView(ledger([account('bank','bank',{openingBalanceMinor:'1000',openingDate:'2026-10-01'}),account('wallet','wallet')],[observation('bank-debit','bank'),observation('channel','wallet',{paymentAccountHint:'bank'})]));
assert.equal(view.transactions.length,2,'funding hint without a shared reference requires review');
assert.equal(view.accountStats.bank.balanceMinor,'900','ambiguous channel source cannot invent a second bank debit');
assert.ok(view.unresolvedAssociations.some(a=>a.reason==='insufficient_reference'&&a.candidateObservationIds.includes('bank-debit')));
view=buildFinanceView(ledger([account('bank')],[],{balanceSnapshots:[{id:'older',financialAccountId:'bank',currency:'CNY',asOf:'2026-10-08T00:00:00Z',balanceMinor:'1000',source:'manual',createdAt:'2026-10-08T01:00:00Z'},{id:'newer',financialAccountId:'bank',currency:'CNY',asOf:'2026-10-08T00:00:00Z',balanceMinor:'2000',source:'manual',createdAt:'2026-10-08T02:00:00Z'}]}));
assert.equal(view.accountStats.bank.balanceMinor,'2000','latest explicit calibration wins equal asOf');
view=buildFinanceView(ledger([account('bank')],[observation('same-time1','bank',{balanceMinor:'1000'}),observation('same-time2','bank',{balanceMinor:'900'})]));
assert.equal(view.accountStats.bank.balanceMinor,null,'conflicting same-time statement balances have no inferred ordering');
assert.ok(view.unresolvedAssociations.some(a=>a.reason==='ambiguous_balance_anchor'));
view=buildFinanceView(ledger([account('bank','bank',{openingBalanceMinor:'1000',openingDate:'2026-10-08'})],[observation('early','bank',{occurredAt:'2026-10-08T01:00:00+08:00'})]));
assert.equal(view.accountStats.bank.balanceMinor,'900','opening dates use statement calendar dates across timezones');
const original=observation('annotated','bank',{kind:'unknown',category:'',amountMinor:'530'});
const annotatedLedger=ledger([account('bank')],[original],{annotations:[{id:'a1',observationId:'annotated',revision:'1',patch:{kind:'expense',category:'Food'}},{id:'a2',observationId:'annotated',revision:'2',patch:{kind:'debt_payment',category:'Mortgage',principalMinor:'500',interestMinor:'20',feeMinor:'10'}}]});
view=buildFinanceView(annotatedLedger);
assert.equal(view.categoryTotals.CNY.Mortgage,'30','latest account-owned annotation corrects purpose and monthly split');
assert.equal(view.transactions[0].sources[0].kind,'unknown','original observation is retained verbatim');
assert.equal(original.kind,'unknown');assert.equal(view.transactions[0].appliedAnnotations[0].id,'a2');
view=buildFinanceView(ledger([account('bank','bank',{maskedIdentifier:'尾号1234'}),account('wallet','wallet')],[observation('decorated-bank','bank',{relatedReference:'shared'}),observation('decorated-wallet','wallet',{relatedReference:'shared',paymentAccountHint:'1234'})]));assert.equal(view.transactions.length,1,'decorated masked identifiers support exact tail evidence');
view=buildFinanceView(ledger([account('usd','bank',{currency:'USD',maskedIdentifier:'1234',openingBalanceMinor:'1000',openingDate:'2026-10-01'}),account('wallet','wallet')],[observation('cny-wallet','wallet',{paymentAccountHint:'1234'})]));assert.equal(view.accountStats.usd.balanceMinor,'1000','foreign currency hint cannot modify another currency balance');assert.ok(view.unresolvedAssociations.some(a=>a.reason==='unresolved_funding_account'));
view=buildFinanceView(ledger([account('loan','loan',{openingBalanceMinor:'10000',openingDate:'2026-10-01'})],[observation('loan-repay','loan',{kind:'debt_payment',direction:'credit',amountMinor:'10230',principalMinor:'10000',interestMinor:'200',feeMinor:'30'})]));assert.equal(view.accountStats.loan.balanceMinor,'0','loan outstanding balance decreases by principal only');
view=buildFinanceView(ledger([account('card','credit_card'),account('wallet','wallet')],[observation('orig','card',{sourceTransactionId:'original',category:'Food'}),observation('refund-other','wallet',{kind:'refund',direction:'credit',relatedReference:'original',category:'Refunds',amountMinor:'20'})]),{accountIds:['wallet']});assert.equal(view.categoryTotals.CNY.Food,'-20');assert.equal(view.transactions[0].relatedTransactionId,'orig','refund links are resolved before account selection');
const payment={kind:'debt_payment',amountMinor:'10230',principalMinor:'10000',interestMinor:'200',feeMinor:'30'};
view=buildFinanceView(ledger([account('bank'),account('loan','loan',{openingBalanceMinor:'10000',openingDate:'2026-10-01'})],[observation('payment-bank','bank',{...payment,relatedReference:'repayment-reference'}),observation('payment-loan','loan',{...payment,direction:'credit',relatedReference:'repayment-reference'})]));assert.equal(view.currencyTotals.CNY.consumptionMinor,'230','one reference-backed repayment has one interest and fee cost');assert.equal(view.fundingBreakdown.CNY.loanPrincipalPaidMinor,'10000');assert.equal(view.accountStats.loan.balanceMinor,'0');assert.equal(view.currencyTotals.CNY.cashOutMinor,'10230');
view=buildFinanceView(ledger([account('bank'),account('loan','loan')],[observation('payment-bank','bank',payment),observation('payment-loan','loan',{...payment,direction:'credit'})],{links:[{id:'payment-link',type:'transfer',observationIds:['payment-bank','payment-loan'],status:'active'}]}));assert.equal(view.currencyTotals.CNY.consumptionMinor,'230','confirmed repayment legs retain one financing cost');assert.equal(view.fundingBreakdown.CNY.loanPrincipalPaidMinor,'10000');
view=buildFinanceView(ledger([account('bank'),account('wallet','wallet')],[observation('manual-bank','bank'),observation('manual-wallet','wallet')],{links:[{id:'manual-duplicate',type:'duplicate',observationIds:['manual-bank','manual-wallet'],status:'active'}]}));assert.equal(view.currencyTotals.CNY.cashOutMinor,'100','manual duplicate supplies evidence that wallet is a payment channel');assert.equal(view.accountStats.wallet.cashOutMinor,'0');
view=buildFinanceView(ledger([account('bank'),account('wallet','wallet')],[observation('purchase','bank',{category:'Food'}),observation('return-wallet','wallet',{kind:'refund',direction:'credit',category:'Refunds',amountMinor:'20'}),observation('return-bank','bank',{kind:'refund',direction:'credit',category:'Refunds',amountMinor:'20'})],{links:[{id:'refund-duplicate',type:'duplicate',observationIds:['return-wallet','return-bank'],status:'active'},{id:'refund-reference',type:'refund',observationIds:['return-bank','purchase'],status:'active'}]}));assert.equal(view.categoryTotals.CNY.Food,'80','manual refund relation can address any group source');
view=buildFinanceView(ledger([account('loan','loan',{openingBalanceMinor:'10000',openingDate:'2026-10-01'})],[observation('unsplit-loan','loan',{kind:'debt_payment',direction:'credit',amountMinor:'1000'})]));assert.equal(view.accountStats.loan.balanceMinor,null,'unsplit loan payment makes projected principal unknown');
view=buildFinanceView(ledger([account('bank'),account('loan','loan')],[observation('loan-first','loan',{...payment,direction:'credit',relatedReference:'reference'}),observation('bank-second','bank',{...payment,relatedReference:'reference'})]));assert.equal(view.fundingTotals.bank.CNY,'230','repayment funding comes from cash source independent of observation ordering');
const many=Array.from({length:6000},(_,i)=>observation('many-'+i,'bank',{amountMinor:String(i+1)}));
const started=performance.now();view=buildFinanceView(ledger([account('bank')],many));
assert.equal(view.transactions.length,6000);assert.equal(view.currencyTotals.CNY.consumptionMinor,'18003000');
assert.ok(performance.now()-started<2000,'6000 independent transactions must not block the UI with a full pair scan');
console.log('6000-row finance view completed in '+Math.round(performance.now()-started)+' ms');
console.log('personal finance ledger accounting and evidence tests passed');
// Credit repayments are transfers. Only a proven loan requires a missing split.
const cardLedger=ledger([account('bank','bank',{openingBalanceMinor:'100000',openingDate:'2026-10-01'}),account('card','credit_card',{openingBalanceMinor:'-100000',openingDate:'2026-10-01'})],[observation('repay-out','bank',{kind:'debt_payment',amountMinor:'50000',relatedReference:'card-payment'}),observation('repay-in','card',{kind:'debt_payment',amountMinor:'50000',direction:'credit',relatedReference:'card-payment'}),observation('card-fee','card',{kind:'fee',amountMinor:'100'})]);
cardLedger.accounts[1].balanceConvention='signed';
const before=JSON.stringify(cardLedger);view=buildFinanceView(cardLedger);
assert.equal(JSON.stringify(cardLedger),before,'projection never mutates original receipts');
assert.equal(view.transactions.length,2);assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.accountStats.card.balanceMinor,'-50100');assert.equal(view.accountStats.bank.balanceMinor,'50000');assert.equal(view.fundingBreakdown.CNY.unsplitDebtPaymentMinor,'0');assert.equal(view.unresolvedAssociations.length,0);
view=buildFinanceView(ledger([account('bank')],[observation('loan-payment','bank',{kind:'debt_payment',description:'\u67dc\u53f0\u6263\u6536\u8d37\u6b3e\u672c\u606f'})]));assert.ok(view.unresolvedAssociations.some(x=>x.reason==='unsplit_debt_payment'));assert.equal(view.fundingBreakdown.CNY.unsplitDebtPaymentMinor,'100');
view=buildFinanceView(ledger([account('card','credit_card')],[observation('principal','card',{kind:'unknown',direction:'neutral',bankStatement:{nonCash:true}}),observation('failed','card',{kind:'unknown',direction:'neutral',amountMinor:'0',bankStatement:{nonCash:true}}),observation('real-unknown','card',{kind:'unknown'})]));assert.deepEqual(view.unresolvedAssociations.map(x=>x.observationId),['real-unknown']);assert.equal(view.review.softwareTransactionCount,1);
view=buildFinanceView(ledger([account('bank')],[observation('old-refund','bank',{kind:'refund',direction:'credit'})]));assert.equal(view.currencyTotals.CNY.consumptionMinor,'-100');assert.equal(view.unresolvedAssociations.length,0);assert.equal(view.information[0].reason,'refund_original_unavailable');
view=buildFinanceView(ledger([account('bank')],[observation('buy1','bank',{sourceTransactionId:'same-order'}),observation('buy2','bank',{sourceTransactionId:'same-order',amountMinor:'200'}),observation('ambiguous-refund','bank',{kind:'refund',direction:'credit',relatedReference:'same-order'})]));assert.ok(view.unresolvedAssociations.some(x=>x.reason==='unresolved_refund'));
const review=require('./reviewSummary').buildReviewSummary([{reason:'insufficient_reference',observationId:'a'},{reason:'card_statement_overlap_requires_review',observationId:'b'},{reason:'unknown_kind',observationId:'a'},{reason:'unknown_kind',observationId:'c'},{reason:'unknown_kind',observationId:'outside'}],[{id:'t',financialAccountId:'bank',observationIds:['a','b'],date:'2026-10-01'},{id:'t2',financialAccountId:'bank',observationIds:['c'],date:'2026-10-02'}],[account('bank')]);
assert.equal(review.transactionCount,2);assert.equal(review.evidenceGroupCount,0);assert.equal(review.softwareTransactionCount,2);assert.equal(review.groups.find(g=>g.reason==='unknown_kind').transactionCount,2);
const responsibility=require('./reviewSummary').buildReviewSummary([{reason:'unknown_kind',observationId:'unknown-purpose'},{reason:'unresolved_funding_account',observationId:'unknown-purpose'},{reason:'unresolved_account_movement',observationId:'missing-direction'}],[{id:'unknown-transaction',financialAccountId:'bank',observationIds:['unknown-purpose'],date:'2026-10-01'},{id:'direction-transaction',financialAccountId:'bank',observationIds:['missing-direction'],date:'2026-10-01'}],[account('bank')]);
assert.equal(responsibility.transactionCount,2,'assigning responsibility keeps every genuinely unresolved transaction');
assert.equal(responsibility.softwareTransactionCount,1);assert.equal(responsibility.evidenceTransactionCount,2);
assert.equal(responsibility.groups.find(g=>g.reason==='unknown_kind').owner,'software','unrecognized purpose is a software classification gap');
assert.equal(responsibility.groups.find(g=>g.reason==='unresolved_funding_account').owner,'evidence','independent missing account evidence stays visible on the same transaction');
console.log('repayment classification, non-cash evidence and grouped review regressions passed');
const repaymentAccounts=[account('cash','bank',{openingBalanceMinor:'1000',openingDate:'2026-10-01'}),account('wallet','wallet'),account('card','credit_card',{label:'\u6d4b\u8bd5\u94f6\u884c\u4fe1\u7528\u5361(5678)',openingBalanceMinor:'-1000',openingDate:'2026-10-01',balanceConvention:'signed'})];
const receipt=observation('wallet-repay','wallet',{provider:'alipay',kind:'debt_payment',direction:'neutral',description:'\u4fe1\u7528\u5361\u8fd8\u6b3e',counterparty:'\u6d4b\u8bd5\u94f6\u884c',paymentAccountHint:'cash'});
const bankReceipt=observation('card-repay','card',{kind:'debt_payment',direction:'credit',description:'\u652f\u4ed8\u5b9d\u8fd8\u6b3e',bankStatement:{postedDate:'2026-10-08'}});
view=buildFinanceView(ledger(repaymentAccounts,[receipt,bankReceipt]));assert.equal(view.transactions.length,1,'unique named bank and payer channel link opposite repayment legs');assert.equal(view.accountStats.cash.balanceMinor,'900');assert.equal(view.accountStats.card.balanceMinor,'-900');assert.equal(view.unresolvedAssociations.length,0);
view=buildFinanceView(ledger(repaymentAccounts,[receipt,bankReceipt,{...bankReceipt,id:'another-repay',sourceTransactionId:'another-repay'}]));assert.equal(view.transactions.length,3,'several same-day same-amount bank receipts stay distinct');
view=buildFinanceView(ledger(repaymentAccounts,[receipt,{...bankReceipt,description:'\u94f6\u8054\u8f6c\u5165',counterparty:''}]));assert.equal(view.transactions.length,2,'date amount and bank alone cannot prove the payer');
view=buildFinanceView(ledger(repaymentAccounts,[receipt,bankReceipt],{links:[{id:'decision',type:'distinct',status:'active',observationIds:[receipt.id,bankReceipt.id]}]}));assert.equal(view.transactions.length,2,'a manual distinct decision blocks automatic repayment matching');
const provident=observation('provident','bank',{provider:'huaxia',kind:'unknown',description:'\u5176\u4ed6\u516c\u79ef\u91d1\u6263\u6b3e ****4932',counterparty:'\u676d\u5dde\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3'});
view=buildFinanceView(ledger([account('bank')],[provident]));assert.equal(view.transactions[0].kind,'debt_payment');assert.equal(view.transactions[0].sources[0].kind,'unknown');assert.equal(view.transactions[0].repaymentType,'loan');assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.unresolvedAssociations[0].reason,'unsplit_debt_payment');
view=buildFinanceView(ledger([account('bank')],[provident],{annotations:[{observationId:'provident',revision:'1',patch:{kind:'expense'}}]}));assert.equal(view.transactions[0].kind,'expense','explicit owner classification always wins');
console.log('repayment one-to-one bank evidence, conflicts and mortgage identification passed');
view=buildFinanceView(ledger([account('card','credit_card')],[observation('bank-transfer-in','card',{kind:'refund',direction:'credit',description:'\u672c\u884c\u81ea\u52a9\u8f6c\u5165(****1234)',bankStatement:{nonCash:false}}),observation('real-card-refund','card',{kind:'refund',direction:'credit',description:'\u9000\u6b3e \u672c\u884c\u81ea\u52a9\u8f6c\u5165',bankStatement:{nonCash:false}})]));assert.equal(view.transactions[0].kind,'debt_payment');assert.equal(view.transactions[1].kind,'refund');assert.equal(view.currencyTotals.CNY.consumptionMinor,'-100','an explicit card funding credit is not a second expense refund');
// The bank's transaction/channel envelope is separate from the merchant name.
const merchantAccounts=[account('merchant-card','credit_card',{maskedIdentifier:'1234',balanceConvention:'signed',openingBalanceMinor:'-1000',openingDate:'2026-10-01'}),account('merchant-wallet','wallet')];
const platformPurchase=(id,extra={})=>observation(id,'merchant-wallet',{provider:'alipay',counterparty:'Example Store',paymentChannel:'card',paymentAccountHint:'1234',...extra});
const statementPurchase=(id,extra={})=>observation(id,'merchant-card',{counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Example Store',bankStatement:{nonCash:false},...extra});
const prefixFixture=ledger(merchantAccounts,[platformPurchase('merchant-platform'),statementPurchase('merchant-bank')]);
const prefixOriginal=JSON.stringify(prefixFixture);view=buildFinanceView(prefixFixture);
assert.equal(view.transactions.length,1,'a controlled bank channel envelope with an exact merchant identifies one purchase');
assert.deepEqual(view.transactions[0].automaticAssociations,[],'an exact merchant match is not labeled as inferred');
assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.accountStats['merchant-card'].balanceMinor,'-1100');
assert.equal(view.unresolvedAssociations.length,0);assert.equal(JSON.stringify(prefixFixture),prefixOriginal,'matching never rewrites imported records');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('wechat-platform',{provider:'wechat'}),statementPurchase('wechat-bank',{counterparty:'\u6d88\u8d39 \u5fae\u4fe1\u652f\u4ed8\uff08\u8d22\u4ed8\u901a\uff09-Example Store'})]));
assert.equal(view.transactions.length,1,'a full-width parenthetical WeChat channel is normalized before comparison');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('fallback-platform'),statementPurchase('fallback-bank',{counterparty:'',description:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Example Store'})]));
assert.equal(view.transactions.length,1,'bank description can supply the explicit merchant envelope');
for(const [label,bankPatch,platformPatch] of [
  ['different platform',{counterparty:'\u6d88\u8d39 \u5fae\u4fe1\u652f\u4ed8(\u8d22\u4ed8\u901a)-Example Store'},{}],
  ['different platform without operation prefix',{counterparty:'\u5fae\u4fe1\u652f\u4ed8-Example Store'},{}],
  ['reverse different platform without operation prefix',{counterparty:'\u652f\u4ed8\u5b9d-Example Store'},{provider:'wechat'}],
  ['merchant containing operation word',{counterparty:'\u6d88\u8d39\u6587\u5316\u5e97 \u652f\u4ed8\u5b9d-Example Store'},{}],
  ['different date',{date:'2026-10-07'},{}],
  ['different amount',{amountMinor:'101'},{}],
  ['different direction',{direction:'credit'},{}],
  ['different currency',{currency:'USD'},{}],
  ['unproven funding account',{}, {paymentAccountHint:'9999'}]
]){
  view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('negative-platform',platformPatch),statementPurchase('negative-bank',bankPatch)]));
  assert.equal(view.transactions.length,2,label+' must not identify the same purchase');
}
const versionedPurchases=[platformPurchase('platform-v1',{sourceIdentity:'platform-order',sourceVersionOrdinal:1}),platformPurchase('platform-v2',{sourceIdentity:'platform-order',sourceVersionOrdinal:2}),statementPurchase('bank-v1',{sourceIdentity:'bank-line',sourceVersionOrdinal:1}),statementPurchase('bank-v2',{sourceIdentity:'bank-line',sourceVersionOrdinal:2})];
view=buildFinanceView(ledger(merchantAccounts,versionedPurchases));
assert.equal(view.transactions.length,1,'candidate uniqueness counts source roots rather than repeated versions');
assert.equal(view.transactions[0].observationIds.length,4);assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');
for(const [type,status] of [['distinct','active'],['duplicate','deleted']]){
  view=buildFinanceView(ledger(merchantAccounts,versionedPurchases,{links:[{id:'merchant-veto',type,status,observationIds:['platform-v1','bank-v1']}]}));
  assert.equal(view.transactions.length,2,type+' decision applies to every imported version of the two sources');
  assert.ok(view.transactions.every(t=>!(t.observationIds.includes('platform-v2')&&t.observationIds.includes('bank-v2'))));
}
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('one-platform'),statementPurchase('first-bank'),statementPurchase('second-bank')]));
assert.equal(view.transactions.length,3,'two independent bank transactions are not source versions');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('first-platform'),platformPurchase('second-platform'),statementPurchase('one-bank')]));
assert.equal(view.transactions.length,3,'two independent platform transactions cannot share one bank receipt');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('ambiguous-platform',{counterparty:'Example'}),platformPurchase('specific-platform',{counterparty:'Example Store'}),statementPurchase('candidate-one',{counterparty:'Example Store'}),statementPurchase('candidate-two',{counterparty:'Example Market'})]));
assert.equal(view.transactions.length,4,'an ambiguous forward candidate must still count in the reverse candidate graph');
console.log('controlled bank merchant envelope, source versions and reciprocal uniqueness tests passed');
const purposeRecords=[
  observation('explicit-withdrawal','purpose-bank',{provider:'huaxia',kind:'unknown',direction:'credit',description:'\u94f6\u8054 \u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0',counterparty:'\u8d22\u4ed8\u901a',statementFlow:{schema:'huaxia-debit-v1'}}),
  observation('explicit-redemption','purpose-bank',{provider:'mybank',kind:'unknown',direction:'credit',description:'\u5176\u5b83\u4ea4\u6613',counterparty:'\u57fa\u91d1\u8d4e\u56de',statementFlow:{schema:'mybank-current-v1'}}),
  observation('explicit-subscription','purpose-bank',{provider:'huaxia',kind:'unknown',description:'\u65e5\u65e5\u76c8\u8d2d\u4e70\u7406\u8d22\u7533\u8d2d',statementFlow:{schema:'huaxia-debit-v1'}}),
  observation('explicit-credit-repayment','purpose-bank',{provider:'huaxia',kind:'unknown',description:'\u94f6\u8054',counterparty:'\u4fe1\u7528\u5361\u8fd8\u6b3e',statementFlow:{schema:'huaxia-debit-v1'}}),
  observation('bare-transfer','purpose-bank',{provider:'huaxia',kind:'unknown',description:'\u94f6\u8054\u8f6c\u8d26',statementFlow:{schema:'huaxia-debit-v1'}}),
  observation('untrusted-merchant-purpose','purpose-bank',{provider:'other',kind:'unknown',description:'\u65e5\u65e5\u76c8\u8d2d\u4e70\u7406\u8d22\u7533\u8d2d'})
];
const purposeLedger=ledger([account('purpose-bank')],purposeRecords),purposeOriginal=JSON.stringify(purposeLedger);
view=buildFinanceView(purposeLedger);
assert.deepEqual(view.transactions.map(t=>t.kind),['transfer','transfer','transfer','debt_payment','unknown','unknown']);
assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.currencyTotals.CNY.incomeMinor,'0');
assert.deepEqual(view.unresolvedAssociations.map(i=>i.observationId),['bare-transfer','untrusted-merchant-purpose']);
assert.equal(view.transactions[0].automaticClassification.confidence,'explicit_statement_purpose');
assert.equal(view.transactions[0].sources[0].kind,'unknown');assert.equal(JSON.stringify(purposeLedger),purposeOriginal);
view=buildFinanceView({...purposeLedger,annotations:[{id:'purpose-annotation',observationId:'explicit-redemption',revision:'1',patch:{kind:'expense'}}]});
assert.equal(view.transactions.find(t=>t.id==='explicit-redemption').kind,'expense','an owner annotation overrides automatic purpose recognition');
view=buildFinanceView(ledger([account('authorization-wallet','wallet')],[observation('frozen','authorization-wallet',{provider:'alipay',kind:'unknown',direction:'neutral',rawFields:{'\u4ea4\u6613\u72b6\u6001':'\u51bb\u7ed3\u6210\u529f'}}),observation('unproven-authorization','authorization-wallet',{provider:'alipay',kind:'unknown',direction:'neutral',description:'\u9884\u6388\u6743'})]));
assert.deepEqual(view.unresolvedAssociations.map(i=>i.observationId),['unproven-authorization'],'only an explicit successful noncash status identifies an authorization');
assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.currencyTotals.CNY.incomeMinor,'0');
console.log('explicit bank purposes and noncash authorizations retain original evidence and unresolved gaps');
for(const bankMerchant of ['Different Store','Example Store Two','Example Corporate Holdings']){
  view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('inferred-platform'),statementPurchase('inferred-bank',{counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-'+bankMerchant})]));
  assert.equal(view.transactions.length,1,'approved channel/funding evidence can infer a pair despite merchant naming differences');
  assert.equal(view.transactions[0].counterparty,'Example Store','platform order details remain the displayed merchant');
  const association=view.transactions[0].automaticAssociations[0];
  assert.equal(association.method,'unique_channel_funding');assert.equal(association.confidence,'inferred');
  assert.deepEqual(association.observationIds,['inferred-platform','inferred-bank']);assert.equal(association.evidence.reciprocalUnique,true);
  assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.accountStats['merchant-card'].balanceMinor,'-1100');
}
const inferredVersions=versionedPurchases.map(o=>o.financialAccountId==='merchant-card'?{...o,counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Receiving Company'}:o);
view=buildFinanceView(ledger(merchantAccounts,inferredVersions));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].automaticAssociations.length,1);
for(const [type,status] of [['distinct','active'],['duplicate','deleted']]){
  view=buildFinanceView(ledger(merchantAccounts,inferredVersions,{links:[{id:'inference-veto',type,status,observationIds:['platform-v1','bank-v1']}]}));
  assert.equal(view.transactions.length,2,'inference cannot bypass a decision through a newer source version');
  assert.ok(view.transactions.every(t=>t.automaticAssociations.length===0));
}
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('unique-order'),statementPurchase('candidate-company-one',{counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Company One'}),statementPurchase('candidate-company-two',{counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Company Two'})]));
assert.equal(view.transactions.length,3,'two channel candidates remain unresolved regardless of their different merchants');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('order-one'),platformPurchase('order-two',{counterparty:'Another Store'}),statementPurchase('company-one',{counterparty:'\u6d88\u8d39 \u652f\u4ed8\u5b9d-Company One'})]));
assert.equal(view.transactions.length,3,'reciprocal uniqueness covers every platform order');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('matched-order'),platformPurchase('unmatched-order',{counterparty:'Another Store'}),statementPurchase('matched-bank')]));
assert.equal(view.transactions.length,2,'an already merchant-matched bank record cannot fund a second inferred order');
assert.ok(view.transactions.every(t=>t.automaticAssociations.length===0));
console.log('approved reversible channel inference retains explicit evidence, uniqueness and user vetoes');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('proven-platform'),statementPurchase('proven-bank'),statementPurchase('separate-wechat-bank',{counterparty:'\u6d88\u8d39 \u5fae\u4fe1\u652f\u4ed8-Other Store'})]));
assert.equal(view.transactions.length,2);assert.equal(view.currencyTotals.CNY.consumptionMinor,'200');
assert.equal(view.unresolvedAssociations.length,0,'an already proven funding-bank receipt does not require another association to an unrelated same-amount transaction');
const fundOrderId='202610080000000000000001';
const fundPurchase=platformPurchase('fund-cash',{kind:'transfer',direction:'neutral',amountMinor:'100000',sourceTransactionId:fundOrderId,accountRelations:[{product:'alipay_funds',activity:'investment_deposit',role:'target',financialAccountId:'fund-holding'}]});
const fundConfirmation=observation('fund-confirmation','merchant-wallet',{provider:'alipay',kind:'transfer',direction:'neutral',amountMinor:'100500',investmentTrade:{schema:'ant-fund-confirmation-v1',orderId:fundOrderId,tradeType:'buy',fundCode:'000001',feeMinor:'149',appliedAmountMinor:'100500',confirmedAt:'2026-10-10T00:00:00+08:00'},accountRelations:[{product:'alipay_funds',activity:'investment_confirmation',role:'target',financialAccountId:'fund-holding'}]});
const fundAccounts=[...merchantAccounts,account('fund-holding','investment')];
for(const rows of [[fundPurchase,fundConfirmation],[fundConfirmation,fundPurchase]]){
  view=buildFinanceView(ledger(fundAccounts,rows));assert.equal(view.transactions.length,1,'the exact fund order links cash payment and confirmation despite a documented gross/cash difference');
  assert.equal(view.transactions[0].amountMinor,'100000');assert.equal(view.transactions[0].investmentConfirmations[0].appliedAmountMinor,'100500');
  assert.equal(view.currencyTotals.CNY.consumptionMinor,'149');assert.equal(view.accountStats['merchant-card'].consumptionMinor,'149');
  assert.equal(view.accountStats['fund-holding'].cashInMinor,'100000','a zero-movement confirmation never overwrites the actual subscription movement');
  assert.equal(view.accountStats['merchant-card'].balanceMinor,'-101000');assert.equal(view.unresolvedAssociations.length,0);
}
view=buildFinanceView(ledger(fundAccounts,[fundPurchase,{...fundConfirmation,investmentTrade:{...fundConfirmation.investmentTrade,orderId:'202610080000000000000002'}}]));assert.equal(view.transactions.length,2,'same fund/date/amount without the exact order is not confirmation evidence');
view=buildFinanceView(ledger(fundAccounts,[fundPurchase,fundConfirmation],{links:[{id:'fund-veto',type:'distinct',status:'active',observationIds:['fund-cash','fund-confirmation']}]}));assert.equal(view.transactions.length,2,'an explicit fund receipt decision is preserved');
const debitBank=statementPurchase('debit-source',{provider:'mybank',kind:'unknown',bankStatement:undefined,statementFlow:{schema:'mybank-current-v1'},counterparty:'\u652f\u4ed8\u5b9d',description:'\u5176\u5b83\u4ea4\u6613',paymentChannel:'own bank channel'});
view=buildFinanceView(ledger(merchantAccounts,[debitBank,platformPurchase('debit-platform')]));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].kind,'expense');assert.equal(view.transactions[0].counterparty,'Example Store');assert.equal(view.transactions[0].sources.find(s=>s.id==='debit-source').kind,'unknown');assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');
view=buildFinanceView(ledger(merchantAccounts,[debitBank,platformPurchase('debit-platform')],{annotations:[{id:'keep-unknown',observationId:'debit-source',revision:'1',patch:{kind:'unknown'}}]}));assert.equal(view.transactions.length,2,'a user classification decision is not borrowed from platform inference');
console.log('fund order receipts and bank-flow purpose inference preserve cash, fees, owners and original amounts');
for(const service of [
  {provider:'alipay',category:'\u5145\u503c\u7f34\u8d39',description:'\u624b\u673a\u8bdd\u8d39'},
  {provider:'alipay',category:'\u6587\u5316\u4f11\u95f2',description:'\u6e38\u620f\u5145\u503c'},
  {provider:'wechat',category:'',description:'\u4f1a\u5458\u5361\u5145\u503c',rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u5546\u6237\u6d88\u8d39'}}
]){
  const input=ledger(merchantAccounts,[platformPurchase('service',{...service,kind:'transfer'})]);const before=JSON.stringify(input);
  view=buildFinanceView(input);assert.equal(view.transactions[0].kind,'expense');assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.transactions[0].sources[0].kind,'transfer');assert.equal(JSON.stringify(input),before);
  view=buildFinanceView({...input,observations:[...input.observations,statementPurchase('service-bank',{counterparty:(service.provider==='wechat'?'\u5fae\u4fe1\u652f\u4ed8-':'\u652f\u4ed8\u5b9d-')+'Service Provider'})]});assert.equal(view.transactions.length,1);assert.equal(view.currencyTotals.CNY.consumptionMinor,'100','the statement-covered service is counted once');
}
for(const purpose of [
  {category:'\u5145\u503c\u7f34\u8d39',description:'\u652f\u4ed8\u5b9d\u4f59\u989d\u5145\u503c'},
  {category:'\u5145\u503c\u7f34\u8d39',description:'\u5fae\u4fe1\u96f6\u94b1\u5145\u503c'},
  {category:'\u6295\u8d44\u7406\u8d22',description:'\u8f6c\u5165'},
  {category:'\u8f6c\u8d26\u7ea2\u5305',description:'\u8f6c\u8d26'}
]){view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('wallet-funding',{...purpose,kind:'transfer'})]));assert.equal(view.transactions[0].kind,'transfer');assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');}
console.log('explicit merchant and utility payments are expenses; actual wallet topups remain transfers');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('institution-platform',{provider:'wechat'}),{...debitBank,counterparty:'Receiving merchant',rawFields:{'\u5bf9\u65b9\u5f00\u6237\u884c':'\u8d22\u4ed8\u901a\u652f\u4ed8\u79d1\u6280\u6709\u9650\u516c\u53f8'}}]));assert.equal(view.transactions.length,1,'the statement explicitly identifies its payment institution');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('institution-conflict'),statementPurchase('conflicting-bank',{rawFields:{'\u5bf9\u65b9\u5f00\u6237\u884c':'\u8d22\u4ed8\u901a\u652f\u4ed8\u79d1\u6280\u6709\u9650\u516c\u53f8'}})]));assert.equal(view.transactions.length,2,'a bank institution conflict cannot be bypassed by matching merchant names');
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('neutral-repayment',{kind:'debt_payment',direction:'neutral',description:'\u4fe1\u7528\u5361\u8fd8\u6b3e',counterparty:'Receiving Bank'}),debitBank]));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].repaymentType,'credit');assert.equal(view.unresolvedAssociations.length,0,'the explicit repayment purpose and actual funding debit resolve direction without inventing a loan split');assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.transactions[0].sources.find(s=>s.id==='neutral-repayment').direction,'neutral');
const withdrawalAccounts=[account('withdraw-wallet','wallet'),{...account('withdraw-bank','debit_card'),provider:'\u534e\u590f\u94f6\u884c',maskedIdentifier:'1234'}];
const withdrawalRows=[observation('withdraw-wallet-source','withdraw-wallet',{provider:'wechat',kind:'transfer',direction:'neutral',amountMinor:'100100',paymentChannel:'\u534e\u590f\u94f6\u884c\u50a8\u84c4\u5361(1234)',rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u96f6\u94b1\u63d0\u73b0'}}),observation('withdraw-bank-source','withdraw-bank',{provider:'huaxia',kind:'unknown',direction:'credit',amountMinor:'100000',description:'\u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0',statementFlow:{schema:'huaxia-debit-v1'}})];
const withdrawalInput=ledger(withdrawalAccounts,withdrawalRows),withdrawalOriginal=JSON.stringify(withdrawalInput);view=buildFinanceView(withdrawalInput);
assert.equal(view.transactions.length,1);assert.equal(view.unresolvedAssociations.length,0);assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.currencyTotals.CNY.cashOutMinor,'100100');assert.equal(view.currencyTotals.CNY.cashInMinor,'100000');assert.equal(view.currencyTotals.CNY.netCashFlowMinor,'-100');assert.equal(view.accountStats['withdraw-wallet'].consumptionMinor,'100');assert.equal(view.accountStats['withdraw-bank'].consumptionMinor,'0');assert.equal(view.transactions[0].automaticAssociations[0].evidence.feeMinor,'100');assert.equal(JSON.stringify(withdrawalInput),withdrawalOriginal);
view=buildFinanceView(ledger(withdrawalAccounts,[withdrawalRows[0]]));assert.ok(view.unresolvedAssociations.some(i=>i.reason==='withdrawal_net_fee_unknown'));assert.equal(view.currencyTotals.CNY.consumptionMinor,'0','no bank net receipt means no invented fee');assert.equal(view.currencyTotals.CNY.cashOutMinor,'100100','the completed withdrawal still proves its gross wallet debit');assert.equal(view.currencyTotals.CNY.cashInMinor,'0','no synthetic bank net receipt');
view=buildFinanceView(ledger(withdrawalAccounts,withdrawalRows,{links:[{id:'withdraw-veto',type:'distinct',status:'active',observationIds:withdrawalRows.map(r=>r.id)}]}));assert.equal(view.transactions.length,2);assert.ok(view.unresolvedAssociations.length>0);assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');
console.log('withdrawal gross debit, actual bank net and fee reconcile without fabricating missing receipt amounts');
const productAccounts=[account('product-wallet','wallet'),{...account('product-fund','investment'),sourceProduct:'alipay_yulibao'},...withdrawalAccounts.slice(1)];
const productPlatform=observation('product-platform','product-wallet',{provider:'alipay',direction:'neutral',kind:'transfer',occurredAt:'2026-10-08T10:00:00+08:00',accountRelations:[{role:'target',product:'alipay_yulibao',activity:'investment_deposit',financialAccountId:'product-fund'}]});
const productReceipt=observation('product-receipt','product-fund',{provider:'mybank',direction:'credit',kind:'transfer',occurredAt:'2026-10-08T10:00:02+08:00',statementFlow:{schema:'mybank-yulibao-v1'},rawFields:{'\u5bf9\u65b9\u8d26\u53f7':'****1234','\u5bf9\u65b9\u673a\u6784\u540d\u79f0':'\u534e\u590f\u94f6\u884c'}});
view=buildFinanceView(ledger(productAccounts,[productPlatform,productReceipt]));assert.equal(view.transactions.length,1);assert.equal(view.unresolvedAssociations.length,0);assert.equal(view.transactions[0].automaticAssociations[0].method,'product_statement_time');assert.equal(view.transactions[0].balanceEffects['withdraw-bank'],'-100');assert.equal(view.transactions[0].balanceEffects['product-fund'],'100');assert.equal(view.currencyTotals.CNY.netCashFlowMinor,'0');
view=buildFinanceView(ledger(productAccounts,[productPlatform,{...productReceipt,occurredAt:'2026-10-08T10:01:00+08:00'}]));assert.equal(view.transactions.length,2,'date and amount alone cannot match product cash movements');assert.ok(view.unresolvedAssociations.some(i=>i.reason==='unresolved_funding_account'));
view=buildFinanceView(ledger(productAccounts,[productPlatform,productReceipt],{links:[{id:'product-veto',type:'distinct',status:'active',observationIds:['product-platform','product-receipt']}]}));assert.equal(view.transactions.length,2);
view=buildFinanceView(ledger(productAccounts,[productPlatform,{...productReceipt,rawFields:{'\u5bf9\u65b9\u8d26\u53f7':'****1234'}}]));assert.ok(view.unresolvedAssociations.some(i=>i.reason==='unresolved_funding_account'),'a card tail without its institution does not identify funding ownership');
console.log('product statement timing and named counter-account evidence resolve funding without bare amount matching');
const payerAccounts=[...withdrawalAccounts,{...account('payer-credit','credit_card'),maskedIdentifier:'9876'}];
const payerDebit=observation('payer-debit','withdraw-bank',{provider:'huaxia',kind:'unknown',statementFlow:{schema:'huaxia-debit-v1'},description:'\u94f6\u8054',counterparty:'\u94f6\u8054\u8f6c\u8d26'});
const payerCredit=observation('payer-credit-source','payer-credit',{provider:'ccb',kind:'debt_payment',direction:'credit',bankStatement:{schema:'bank-credit-v1'},description:'\u94f6\u8054\u5165\u8d26 Example 1234'});
view=buildFinanceView(ledger(payerAccounts,[payerDebit,payerCredit]));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].repaymentType,'credit');assert.equal(view.unresolvedAssociations.length,0);assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.transactions[0].automaticAssociations[0].method,'statement_payer_card');
view=buildFinanceView(ledger(payerAccounts,[payerDebit,{...payerCredit,description:'Merchant reference 1234'}]));assert.equal(view.transactions.length,2,'arbitrary trailing digits are not payer-card evidence');
view=buildFinanceView(ledger(payerAccounts,[payerDebit,{...payerDebit,id:'another-payer-debit',sourceTransactionId:'another-source-debit'},payerCredit]));assert.equal(view.transactions.length,3,'two independent same-card debits remain ambiguous');
view=buildFinanceView(ledger(payerAccounts,[payerDebit,payerCredit],{links:[{id:'payer-veto',type:'distinct',status:'active',observationIds:['payer-debit','payer-credit-source']}]}));assert.equal(view.transactions.length,2);
console.log('credit statement payer-card evidence resolves only a reciprocal unique debit');
for(const counterparty of ['(\u6d88\u8d39)\u652f\u4ed8\u5b9d-Receiving Company','\uff08\u6d88\u8d39\uff09\u652f\u4ed8\u5b9d-Receiving Company','\u6d88\u8d39 Example Store']){
 view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('operation-platform'),statementPurchase('operation-bank',{counterparty})]));assert.equal(view.transactions.length,1);
}
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('operation-conflict'),statementPurchase('operation-bank',{counterparty:'(\u6d88\u8d39)\u5fae\u4fe1\u652f\u4ed8-Example Store'})]));assert.equal(view.transactions.length,2);
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('operation-specific'),statementPurchase('operation-bank',{counterparty:'\u6d88\u8d39 Example Store Outlet'})]));assert.equal(view.transactions.length,2,'removing a bank operation label does not permit merchant prefix aliases');
console.log('parenthesized bank operation labels preserve exact merchant and explicit channel boundaries');
const installmentOriginal=statementPurchase('installment-original',{provider:'bocom',counterparty:'\u6d88\u8d39 \u5546\u6237\u5206\u671f-\u652f\u4ed8\u5b9d-Receiving Company-\u52063\u671f',rawFields:{excludedFromBilledTotal:true}});
const installmentPrincipal=statementPurchase('installment-principal',{provider:'bocom',kind:'unknown',direction:'neutral',amountMinor:'33',counterparty:'\u5206\u671f\u6263\u6b3e1/3',bankStatement:{schema:'bank-credit-v1',nonCash:true}});
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('installment-platform'),installmentOriginal,installmentPrincipal]));assert.equal(view.transactions.length,2);assert.equal(view.currencyTotals.CNY.consumptionMinor,'100');assert.equal(view.transactions.find(t=>t.observationIds.includes(installmentPrincipal.id)).consumptionMinor,'0');assert.equal(view.unresolvedAssociations.length,0);
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('installment-platform',{provider:'wechat'}),installmentOriginal]));assert.equal(view.transactions.length,2,'a merchant installment envelope still explicitly identifies its platform');
console.log('installment original purchases reconcile once while noncash principal remains excluded');
for(const [rows,accountSet] of [[inferredVersions,merchantAccounts],[[{...productPlatform,sourceIdentity:'annotated-product',sourceVersionOrdinal:1},{...productPlatform,id:'annotated-product-v2',sourceIdentity:'annotated-product',sourceVersionOrdinal:2},productReceipt],productAccounts],[[{...payerDebit,sourceIdentity:'annotated-payer',sourceVersionOrdinal:1},{...payerDebit,id:'annotated-payer-v2',sourceIdentity:'annotated-payer',sourceVersionOrdinal:2},payerCredit],payerAccounts]]){
 const input=ledger(accountSet,rows,{annotations:[{observationId:rows[0].id,revision:'1',patch:{category:'User classification'}}]});view=buildFinanceView(input);assert.ok(view.transactions.every(t=>t.automaticAssociations.length===0),'an annotation on an old source version blocks inferred association of that source root');
}
console.log('inferred channel, product and payer associations preserve source-root user annotations');
for(const [provider,prefix] of [['alipay','\u652f\u4ed8\u5b9d\u5feb\u6377--'],['wechat','\u8d22\u4ed8\u901a\u5feb\u6377--']]){
 view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('quick-platform',{provider}),statementPurchase('quick-bank',{provider:'cib',counterparty:prefix+'Example Store'})]));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].automaticAssociations.length,0);
 view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('quick-platform',{provider}),statementPurchase('quick-bank',{provider:'cib',counterparty:prefix+'Receiving Company'})]));assert.equal(view.transactions.length,1);assert.equal(view.transactions[0].automaticAssociations[0].method,'unique_channel_funding');
 view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('quick-platform',{provider:provider==='alipay'?'wechat':'alipay'}),statementPurchase('quick-bank',{provider:'cib',counterparty:prefix+'Example Store'})]));assert.equal(view.transactions.length,2,'explicit quick-payment channel conflicts cannot be bypassed by merchant names');
}
view=buildFinanceView(ledger(merchantAccounts,[platformPurchase('quick-platform'),statementPurchase('quick-bank',{provider:'cib',counterparty:'\u652f\u4ed8\u5b9d\u5feb\u6377\u5546\u6237 Receiving Company'})]));assert.equal(view.transactions.length,2,'a merchant containing a channel word is not the controlled quick-payment envelope');
console.log('explicit bank quick-payment envelopes preserve merchant identity and channel conflicts');
const versionedRepayment=[{...receipt,sourceIdentity:'repayment-version',sourceVersionOrdinal:1},{...receipt,id:'wallet-repay-v2',sourceIdentity:'repayment-version',sourceVersionOrdinal:2},bankReceipt];
for(const decision of [{type:'distinct',status:'active'},{type:'duplicate',status:'deleted'}]){
 view=buildFinanceView(ledger(repaymentAccounts,versionedRepayment,{links:[{id:'versioned-repayment-veto',...decision,observationIds:[receipt.id,bankReceipt.id]}]}));assert.equal(view.transactions.length,2,'a source version cannot bypass rejected repayment association');
}
view=buildFinanceView(ledger(repaymentAccounts,[receipt,{...receipt,id:'competing-repayment',sourceTransactionId:'competing-repayment',provider:'wechat'},{...bankReceipt,description:'\u652f\u4ed8\u5b9d \u5fae\u4fe1\u8fd8\u6b3e'},{...bankReceipt,id:'other-credit',sourceTransactionId:'other-credit',description:'\u5fae\u4fe1\u8fd8\u6b3e'}]));assert.equal(view.transactions.length,4,'a reverse repayment candidate remains ambiguous even when its other platform has multiple choices');
console.log('repayment associations preserve cross-version rejections and the complete reverse candidate graph');
