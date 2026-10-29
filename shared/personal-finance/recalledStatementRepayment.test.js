'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{validateHistoricalCardBindings}=require('./historicalCardBindings'),{createPersonalFinanceRepository}=require('../../cloud-business-api/src/personalFinanceRepository');
function fixture(receipt=false){
 const rule={channel:'\u62db\u5546\u94f6\u884c',institution:'\u62db\u5546\u94f6\u884c',type:'credit_card',maskedIdentifier:'8718',financialAccountId:'credit',periodStart:'2021-02-07',periodEnd:'2021-02-07',confirmedAt:'2026-10-24T00:00:00Z',confidence:'owner_recalled',usage:'repayment_target',identityBasis:'owner_recalled_repayment_target',sourceTransactionIds:['palm-10518']},bank={id:'bank',label:'CCB6943',provider:'\u5efa\u8bbe\u94f6\u884c',type:'debit_card',maskedIdentifier:'6943',currency:'CNY',status:'active',openingDate:null,openingBalanceMinor:null,historicalCardBindings:{schema:'historical-card-bindings-v1',rules:[rule]}},credit={id:'credit',label:'CMB8718',provider:rule.institution,type:'credit_card',maskedIdentifier:'8718',currency:'CNY',status:'active',openingDate:null,openingBalanceMinor:null},date=rule.periodStart;
 const debit={id:'debit',financialAccountId:'bank',sourceIdentity:'debit',sourceTransactionId:'palm-10518',sourceVersionOrdinal:1,provider:'ccb',date,occurredAt:date+'T23:59:59+08:00',amountMinor:'10518',currency:'CNY',direction:'debit',kind:'unknown',status:'completed',description:'\u8de8\u884c\u4ee3\u6536 (\u7279\u7ea6)\u638c\u4e0a\u751f\u6d3b\u4ed6\u884c\u4fe1\u7528\u5361\u8fd8\u6b3e',counterparty:'***\u8fd8\u6b3e',category:'',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361(6943)',paymentAccountHint:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:'',statementFlow:{schema:'ccb-debit-v1'},rawFields:{'\u6458\u8981':'\u8de8\u884c\u4ee3\u6536','\u5bf9\u65b9\u8d26\u53f7':'9498','\u4ea4\u6613\u5730\u70b9/\u9644\u8a00':'(\u7279\u7ea6)\u638c\u4e0a\u751f\u6d3b\u4ed6\u884c\u4fe1\u7528\u5361\u8fd8\u6b3e'}};
 const incoming={...debit,id:'receipt',sourceIdentity:'receipt',sourceTransactionId:'receipt',financialAccountId:'credit',provider:'cmb',direction:'credit',kind:'debt_payment',paymentChannel:'',description:'\u9884\u7ea6\u8fd8\u6b3e',counterparty:'\u9884\u7ea6\u8fd8\u6b3e',statementFlow:undefined,bankStatement:{schema:'bank-credit-v1',provider:'cmb',nonCash:false,cardTail:'8718',postedDate:date},rawFields:{dateBasis:'transaction_date',tradeDate:date,statementCredit:true,statementAmountMinor:'-10518'}};
 return{accounts:[bank,credit],observations:[debit,...(receipt?[incoming]:[])],annotations:[],links:[],imports:[],balanceSnapshots:[]};
}

test('a one-order one-day recalled receiving card posts a liability credit with explicit recalled and reversible metadata',()=>{
 const l=fixture(),before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions[0];assert.equal(v.review.transactionCount,0);assert.equal(t.kind,'debt_payment');assert.deepEqual(t.cashEffects,{bank:'-10518'});assert.deepEqual(t.balanceEffects,{bank:'-10518',credit:'10518'});assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert.equal(t.automaticRepaymentTarget.confidence,'owner_recalled');assert.equal(t.automaticRepaymentTarget.identityBasis,'owner_recalled_repayment_target');assert.equal(t.automaticRepaymentTarget.bankReceipt,'identity_recalled_receipt_separately_checked');assert.equal(t.automaticRepaymentTarget.reversible,true);assert.equal(v.accountStats.credit.balanceMinor,null);assert.equal(t.sources[0].rawFields['\u5bf9\u65b9\u8d26\u53f7'],'9498');assert.equal(JSON.stringify(l),before);
 delete l.accounts[0].historicalCardBindings;const rolledBack=buildFinanceView(l);assert.equal(rolledBack.transactions[0].balanceEffects.credit,undefined);assert(rolledBack.review.transactionCount>0);
});

test('ordinary unscoped recollection cannot activate a statement target and cannot expand to other orders or dates',()=>{
 for(const change of[l=>delete l.accounts[0].historicalCardBindings.rules[0].identityBasis,l=>l.observations[0].sourceTransactionId='another',l=>l.observations[0].date='2021-02-08',l=>l.accounts[1].status='archived',l=>l.accounts[1].currency='USD',l=>l.accounts[1].maskedIdentifier='9999']){const l=fixture();change(l);assert.equal(buildFinanceView(l).transactions[0].automaticRepaymentTarget,undefined);}
});

test('recalled target policy is strictly limited to one source order and one day',()=>{
 const p=fixture().accounts[0].historicalCardBindings;assert.deepEqual(validateHistoricalCardBindings(p),p);
 for(const change of[r=>r.sourceTransactionIds=['palm-10518','another'],r=>r.sourceTransactionIds=undefined,r=>r.periodEnd='2021-02-08',r=>r.confidence='owner_confirmed',r=>r.usage='both',r=>r.type='debit_card']){const copy=structuredClone(p);change(copy.rules[0]);assert.throws(()=>validateHistoricalCardBindings(copy),/BINDINGS_INVALID/);}
});

test('current or older-version owner annotations take precedence over recalled target policies',()=>{
 for(const old of[false,true]){const l=fixture();if(old)l.observations.push({...structuredClone(l.observations[0]),id:'old',sourceVersionOrdinal:0});l.annotations.push({observationId:old?'old':'debit',revision:'1',patch:{kind:'expense',category:'Owner decision'}});const v=buildFinanceView(l);assert(v.transactions.every(t=>!t.automaticRepaymentTarget));}
});

test('actual receiving statements replace the derived credit once and explicit rejection keeps the order unresolved',()=>{
 const l=fixture(true),before=JSON.stringify(l),v=buildFinanceView(l);assert.equal(v.transactions.length,1);assert.equal(v.review.transactionCount,0);assert.deepEqual(v.transactions[0].balanceEffects,{bank:'-10518',credit:'10518'});assert.deepEqual(v.transactions[0].cashEffects,{bank:'-10518'});assert.equal(JSON.stringify(l),before);
 l.links.push({type:'distinct',observationIds:['debit','receipt']});const rejected=buildFinanceView(l);assert.equal(rejected.transactions.length,2);assert(rejected.review.transactionCount>0);assert.equal(rejected.transactions.find(t=>t.id==='debit').balanceEffects.credit,undefined);
});

test('a contradictory explicit institution and tail cannot be overwritten by recalled identity',()=>{
 const l=fixture();l.observations[0].rawFields['\u5bf9\u65b9\u5f00\u6237\u884c']='\u62db\u5546\u94f6\u884c';l.observations[0].rawFields['\u5bf9\u65b9\u8d26\u53f7']='9999';const t=buildFinanceView(l).transactions[0];assert.equal(t.automaticRepaymentTarget,undefined);assert.equal(t.balanceEffects.credit,undefined);
});

test('cloud persists the scoped recalled policy under the owner revision fence and rejects unscoped or cross-owner targets',async()=>{
 const l=fixture();let saved,missing=false;const q=async(sql,args)=>{if(sql.startsWith('SELECT revision'))return{rows:[{revision:'3'}]};if(sql.startsWith('UPDATE business.personal_finance_owners'))return{rows:[{revision:'4'}]};if(sql.startsWith('SELECT data FROM business.personal_finance_accounts')){assert.deepEqual(args,['tenant','owner','credit']);return{rows:missing?[]:[{data:l.accounts[1]}]};}if(sql.startsWith('INSERT INTO business.personal_finance_accounts'))saved=JSON.parse(args[3]);return{rows:[]};},repo=createPersonalFinanceRepository({query:q,transaction:async f=>f(q),parseBillFile:()=>({})}),input={tenantId:'tenant',actor:{accountId:'owner',roles:['teacher']},expectedRevision:'3',account:l.accounts[0]};
 await repo.createAccount(input);assert.equal(saved.historicalCardBindings.rules[0].confidence,'owner_recalled');assert.equal(saved.historicalCardBindings.rules[0].identityBasis,'owner_recalled_repayment_target');const unscoped=structuredClone(input);delete unscoped.account.historicalCardBindings.rules[0].identityBasis;await assert.rejects(repo.createAccount(unscoped),/INPUT_INVALID/);missing=true;await assert.rejects(repo.createAccount(input),/ACCOUNT_NOT_FOUND/);
});
