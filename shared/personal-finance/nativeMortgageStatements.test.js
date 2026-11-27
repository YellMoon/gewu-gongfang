'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{buildNativeMortgageStatements:find}=require('./nativeMortgageStatements');
function fixture(){
 const rows=[['\u534e\u590f\u94f6\u884c\u4e2a\u4eba\u8d37\u6b3e\u8fd8\u6b3e\u8bb0\u5f55'],['\u4e1a\u52a1\u540d\u79f0:\u4e2a\u4eba\u4f4f\u623f\u6309\u63ed\u8d37\u6b3e(\u4e00\u624b)','\u5408\u540c\u53f7:TESTCONTRACT2026'],['\u8d37\u6b3e\u91d1\u989d:1000.00','\u8d37\u6b3e\u4f59\u989d:839.00'],['\u8d37\u6b3e\u671f\u9650:359\u6708','\u5e74\u5229\u7387:3.2000%'],['\u5f52\u8fd8\u603b\u989d','200.00'],['\u5df2\u5f52\u8fd8\u672c\u91d1','161.00'],['\u5df2\u5f52\u8fd8\u5229\u606f(\u542b\u7f5a\u606f\u3001\u606f\u5229)','39.00'],['\u67e5\u8be2\u5f00\u59cb\u65e5\u671f:2026-01-01','\u67e5\u8be2\u7ed3\u675f\u65e5\u671f:2026-02-28'],['1','2026-02-20','','6230000000009023','100.00','81.00','19.00','839.00','000001'],['2','2026-01-20','','6230000000009023','100.00','80.00','20.00','920.00','000002'],['\u6253\u5370\u65e5\u671f:2026-02-28']],parsed=require('../../cloud-business-api/src/huaxiaMortgageStatement').parseHuaxiaMortgageRows(rows);assert.deepEqual(parsed.errors,[]);
 const accounts=[{id:'bank',label:'Bank',provider:'\u534e\u590f\u94f6\u884c',type:'debit_card',currency:'CNY',maskedIdentifier:'9023',status:'active',openingBalanceMinor:null,openingDate:null},{id:'loan',label:'Loan',provider:'\u534e\u590f\u94f6\u884c',type:'loan',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null,mortgage:{schema:'mortgage-v1',loanType:'commercial',sourceAccountId:'bank',statementReference:'1234',annualRatePpm:'32000',minimumAnnualRatePpm:'32000',originalPrincipalMinor:'100000',termMonths:360,firstPaymentDate:'2026-01-20',recentSplit:null,prepayments:[]}}];
 const proofs=parsed.records.map((o,i)=>({...o,id:'proof-'+i,financialAccountId:'bank',provider:'huaxia',importId:'native',sourceIdentity:'proof-'+i,sourceVersionOrdinal:1}));
 const observations=['2026-01-20','2026-02-20'].map((date,i)=>({id:'bank-'+i,sourceTransactionId:'bank-'+i,sourceIdentity:'bank-'+i,sourceVersionOrdinal:1,financialAccountId:'bank',provider:'huaxia',date,occurredAt:date+'T23:59:59+08:00',amountMinor:'10000',currency:'CNY',kind:'debt_payment',direction:'debit',status:'completed',description:'\u8d37\u6b3e\u672c\u606f',counterparty:'\u4e2a\u4eba\u8d37\u6b3e\u6237',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:'',rawFields:{'\u5bf9\u65b9\u5361/\u8d26\u53f7':'****1234'}}));
 return{accounts,observations:[...observations,...proofs],imports:[],annotations:[],links:[],balanceSnapshots:[]};
}
const plans=l=>find(l.accounts,l.observations.filter(o=>!o.rawFields?.schema),l.observations.filter(o=>o.rawFields?.schema),{annotatedIds:new Set(l.annotations.filter(a=>!a.reset).map(a=>a.observationId)),links:l.links});
test('actual bank columns replace inference, retain source cash once and independently verify the loan balance path',()=>{
 const l=fixture(),before=JSON.stringify(l),p=plans(l),v=buildFinanceView(l);assert.equal(p.models.length,1);assert.equal(p.additions.length,0);assert.equal(v.transactions.length,2);assert.equal(v.review.transactionCount,0);assert.equal(v.currencyTotals.CNY.cashOutMinor,'20000');assert.equal(v.currencyTotals.CNY.consumptionMinor,'3900');assert.equal(v.accountStats.loan.balanceMinor,'-83900');assert.equal(v.accountStats.loan.estimatedBalanceMinor,null);assert.equal(v.mortgages[0].status,'actual_bank_statement');assert.equal(v.mortgages[0].periods.length,2);assert.equal(v.mortgages[0].bankStatementTermMonths,359);assert.equal(v.mortgages[0].contractTermMonths,360);assert.equal(v.mortgages[0].interestStatisticsIncomplete,false);assert(v.transactions.every(t=>t.actualMortgageStatementEvidence.proofObservationIds.length===1));assert.equal(v.balanceReconciliation.accounts.find(a=>a.financialAccountId==='loan').balancedIntervalCount,1);assert.equal(v.balanceReconciliation.accounts.find(a=>a.financialAccountId==='loan').differenceIntervalCount,0);assert(v.transactions.every(t=>t.sources[0].principalMinor===null));assert.equal(JSON.stringify(l),before);
});
test('the asset register exposes the same actual signed loan balance and preserves both source evidence sets',()=>{
 const l=fixture(),r=require('./assetRegister').buildAssetRegister(l).accounts.find(a=>a.id==='loan');assert.equal(r.verifiedBalance.balanceMinor,'-83900');assert.equal(r.verifiedBalance.evidenceBasis,'actual_bank_mortgage_principal_balance');assert.equal(r.evidenceCount,4);assert.equal(r.verifiedBalance.sourceObservationId,'proof-0');
});
test('one new payment missing from the savings-card statement is booked once from the actual loan PDF',()=>{
 const l=fixture();l.observations=l.observations.filter(o=>o.id!=='bank-1');const p=plans(l),v=buildFinanceView(l);assert.equal(p.additions.length,1);assert.equal(v.transactions.length,2);assert.equal(v.currencyTotals.CNY.cashOutMinor,'20000');assert.equal(v.currencyTotals.CNY.consumptionMinor,'3900');assert.equal(v.accountStats.loan.balanceMinor,'-83900');assert.equal(v.transactions.find(t=>t.id==='proof-0').actualMortgageStatementEvidence.method,'actual_mortgage_statement_cash_payment');
});
test('owner rate disagreement stays visible while actual principal, interest and balance retain bank evidence',()=>{
 const l=fixture();l.accounts[1].mortgage.annualRatePpm=l.accounts[1].mortgage.minimumAnnualRatePpm='33000';const v=buildFinanceView(l);assert.equal(v.mortgages[0].status,'actual_bank_statement');assert.equal(v.mortgages[0].calibrationVerification.rateConflict,true);assert.equal(v.review.pendingAccountIssueCount,1);assert.equal(v.accountStats.loan.balanceMinor,'-83900');assert.equal(v.currencyTotals.CNY.consumptionMinor,'3900');assert.equal(l.accounts[1].mortgage.annualRatePpm,'33000');
});
test('changed originals, ambiguous bank cash, source versions, owner edits and revoked associations fail closed without duplicating cash',()=>{
 const changes=[l=>l.observations[2].rawFields.principalBalanceMinor='83901',l=>l.observations[2].rawFields.reportedRemainingPrincipalMinor='bad',l=>l.observations[2].principalMinor='8101',l=>l.observations[2].status='failed',l=>l.observations.push({...l.observations[0],id:'other',sourceIdentity:'other'}),l=>l.observations.push({...l.observations[2],id:'tie'}),l=>l.observations.push({...l.observations[2],id:'new',sourceVersionOrdinal:2,status:'failed'}),l=>l.annotations.push({observationId:'bank-0',revision:'1',patch:{category:'Owner choice'}}),l=>l.links.push({type:'distinct',observationIds:['bank-0','proof-1']}),l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['bank-0','proof-1']})];
 for(const[i,change]of changes.entries()){const l=fixture();change(l);const p=plans(l);assert.equal(p.models.length,0,'case '+i);assert.equal(p.additions.length,0,'case '+i);assert.equal(p.issues.length,1,'case '+i);}
 const l=fixture();l.annotations.push({observationId:'bank-0',revision:'1',patch:{kind:'debt_payment'}});assert.equal(buildFinanceView(l).transactions.length,2);assert.equal(buildFinanceView(l).currencyTotals.CNY.cashOutMinor,'20000');l.annotations.push({observationId:'bank-0',revision:'2',patch:{},reset:true});assert.equal(buildFinanceView(l).mortgages[0].status,'actual_bank_statement');
});
test('wrong or ambiguous loan identity is a visible account issue rather than a discarded proof document',()=>{
 for(const change of[l=>l.accounts[0].maskedIdentifier='9999',l=>l.accounts.push({...l.accounts[1],id:'other-loan'}),l=>l.accounts[1].mortgage.originalPrincipalMinor='200000']){const l=fixture();change(l);const p=plans(l);assert.equal(p.models.length,0);assert.equal(p.additions.length,0);assert.equal(p.issues[0].reason,'mortgage_native_statement_account_unresolved');const v=buildFinanceView(l);assert(v.unresolvedAssociations.some(i=>i.reason==='mortgage_native_statement_account_unresolved'));assert.equal(v.transactions.length,2);}
});
test('revoking one inferred receipt association cannot erase a separate actual payment from the same document',()=>{
 const l=fixture();l.observations=l.observations.filter(o=>o.id!=='bank-1');l.links.push({type:'distinct',observationIds:['bank-0','proof-1']});const v=buildFinanceView(l);assert.equal(v.currencyTotals.CNY.cashOutMinor,'20000');assert.equal(v.transactions.length,2);assert(v.transactions.some(t=>t.id==='proof-0'));assert(v.unresolvedAssociations.some(i=>i.reason==='mortgage_native_statement_conflict'));
});
test('a native balance after the first known repayment is never back-projected into an unobserved pre-loan date',()=>{
 const l=fixture(),v=buildFinanceView(l,{endDate:'2025-12-31'});assert.equal(v.accountStats.loan.balanceMinor,null);assert.equal(v.accountStats.loan.estimatedBalanceMinor,null);assert.equal(v.currencyTotals.CNY?.cashOutMinor||'0','0');
});
test('a first native import creates a loan and books bank balances before loan parameters are entered',()=>{
 const l=fixture();l.accounts.pop();
 const {mortgageAccountDiscovery:discover}=require('./mortgageAccountDiscovery');
 const initial={...l,observations:l.observations.filter(o=>o.rawFields.schema)};
 const plan=discover(initial);
 assert.equal(plan.accounts.length,1);
 const {key,...spec}=plan.accounts[0];
 assert.match(key,/^mortgage:contract:/);
 assert.equal(spec.mortgageEvidence.originalPrincipalMinor,'100000');
 assert.equal(spec.mortgageEvidence.reportedTermMonths,359);
 assert.equal(spec.mortgageEvidence.statementReference,undefined);
 assert.equal(spec.mortgage,undefined);
 const account={...spec,id:'auto-loan',status:'active'};
 const initialView=buildFinanceView({...initial,accounts:[...l.accounts,account]});
 assert.equal(initialView.mortgages[0].status,'actual_bank_statement');
 assert.equal(initialView.mortgages[0].bankStatementTermMonths,359);
 assert.equal(initialView.mortgages[0].contractTermMonths,null);
 assert.equal(initialView.accountStats['auto-loan'].balanceMinor,'-83900');

 l.accounts.push(account);
 const combined=discover(l);
 assert.equal(combined.accounts.length,0);
 assert.equal(combined.updates.length,1);
 assert.equal(combined.updates[0].after.id,'auto-loan');
 assert.equal(combined.updates[0].after.mortgageEvidence.statementReference,'1234');
 l.accounts[1]=combined.updates[0].after;
 const view=buildFinanceView(l);
 assert.equal(view.currencyTotals.CNY.cashOutMinor,'20000');
 assert.equal(view.transactions.length,2);
 assert.deepEqual(discover(l),{accounts:[],updates:[]});
});
test('an earlier card-only account can receive later contract evidence without changing its ID',()=>{
 const l=fixture();l.accounts.pop();
 const {mortgageAccountDiscovery:discover}=require('./mortgageAccountDiscovery');
 const cash=l.observations.filter(o=>!o.rawFields.schema);
 const plan=discover({...l,observations:cash});
 assert.equal(plan.accounts.length,1);
 const {key,...spec}=plan.accounts[0];
 assert.match(key,/^mortgage:payment:/);
 assert.equal(spec.mortgageEvidence.originalPrincipalMinor,undefined);
 l.accounts.push({...spec,id:'pending-loan',status:'active'});
 const combined=discover(l);
 assert.equal(combined.accounts.length,0);
 assert.equal(combined.updates[0].after.id,'pending-loan');
 assert.equal(combined.updates[0].after.mortgageEvidence.originalPrincipalMinor,'100000');
});
test('different bank contract identities on the same card and principal get separate accounts',()=>{
 const l=fixture();l.accounts.pop();
 const proofs=l.observations.filter(o=>o.rawFields.schema),secondHash='9'.repeat(64);
 const second=proofs.map(o=>({...o,id:o.id+'-second',sourceIdentity:o.sourceIdentity+'-second',
  sourceTransactionId:o.sourceTransactionId.replace(o.rawFields.contractHash,secondHash),rawFields:{...o.rawFields,contractHash:secondHash}}));
 l.observations=[...proofs,...second];
 const {mortgageAccountDiscovery:discover}=require('./mortgageAccountDiscovery');
 const plan=discover(l);
 assert.equal(plan.accounts.length,2);
 l.accounts.push(...plan.accounts.map((spec,i)=>({...spec,id:'loan-'+i,status:'active'})));
 assert.equal(plans(l).models.length,2);
 assert.deepEqual(discover(l),{accounts:[],updates:[]});
});
test('a payment that overlaps different contracts cannot bind their loan references or duplicate the booked card payment',()=>{
 const l=fixture();l.accounts.pop();
 const proofs=l.observations.filter(o=>o.rawFields.schema),secondHash='1'.repeat(64);
 const second=proofs.map(o=>({...o,id:o.id+'-second',sourceIdentity:o.sourceIdentity+'-second',
  sourceTransactionId:o.sourceTransactionId.replace(o.rawFields.contractHash,secondHash),rawFields:{...o.rawFields,contractHash:secondHash}}));
 l.observations.push(...second);
 const {mortgageAccountDiscovery:discover}=require('./mortgageAccountDiscovery');
 const plan=discover(l);
 assert.equal(plan.accounts.length,2);
 assert.ok(plan.accounts.every(spec=>!spec.mortgageEvidence.statementReference));
 l.accounts.push(...plan.accounts.map((spec,i)=>({...spec,id:'loan-'+i,status:'active'})));
 const view=buildFinanceView(l);
 assert.equal(view.mortgages.length,0);
 assert.equal(view.transactions.length,2);
 assert.equal(view.currencyTotals.CNY.cashOutMinor,'20000');
});
