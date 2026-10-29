'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView}=require('./ledger');
const {validateTermDeposit,termDepositBindingValid}=require('./bankTermDeposits');
function fixture(){
 const bank={id:'bank',label:'CCB0586',provider:'\u5efa\u8bbe\u94f6\u884c',type:'debit_card',maskedIdentifier:'0586',currency:'CNY',status:'active',openingBalanceMinor:'0',openingDate:'2012-11-12'},term={id:'term',label:'CCB0586 term savings',provider:bank.provider,type:'savings',maskedIdentifier:'',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null};
 const cash=[['2012-11-12','credit','103565','103565'],['2012-11-12','debit','103565','0'],['2013-03-01','credit','104320','104320'],['2013-03-01','debit','104320','0'],['2013-09-07','credit','105917','105917']];
 const observations=cash.map(([date,direction,amountMinor,balanceMinor],i)=>{const summary=direction==='credit'?'\u8f6c\u8d26\u5b58\u5165':'\u8f6c\u8d26\u652f\u53d6';return{id:'source'+i,sourceIdentity:'source'+i,sourceVersionOrdinal:1,sourceTransactionId:'ccb-debit:term'+i,financialAccountId:'bank',importId:'statement',provider:'ccb',date,occurredAt:date+'T23:59:59+08:00',amountMinor,currency:'CNY',direction,kind:'unknown',status:'completed',description:summary+' \u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d',counterparty:'\u6797\u6708\u9ec4',category:'Review',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361(0586)',paymentAccountHint:'',relatedReference:'',balanceMinor,principalMinor:null,interestMinor:null,feeMinor:null,statementFlow:{schema:'ccb-debit-v1',sequence:i+1,periodStart:'2011-10-25',periodEnd:'2026-10-25',incomeMinor:direction==='credit'?amountMinor:'0',expenseMinor:direction==='debit'?amountMinor:'0',balanceKind:'total',timePrecision:'day',openingBeforeFirstMinor:i===0?'0':null},rawFields:{dateBasis:'transaction_date','\u4ea4\u6613\u65e5\u671f':date.replace(/-/g,''),'\u6458\u8981':summary,'\u4ea4\u6613\u5730\u70b9/\u9644\u8a00':'\u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d','\u5bf9\u65b9\u8d26\u53f7':'****0586'}};});
 term.termDeposit={schema:'bank-term-deposit-v1',bankAccountId:'bank',bankCardTail:'0586',ownerName:'\u6797\u6708\u9ec4',knownFrom:'2012-11-12',confirmedAt:'2026-10-26T00:00:00Z',movements:observations.map(o=>({transactionId:o.sourceTransactionId,date:o.date,direction:o.direction,amountMinor:o.amountMinor})),closedAt:'2013-09-07',rolloverCycle:{firstReinvestmentTransactionId:observations[1].sourceTransactionId,finalWithdrawalTransactionId:observations[4].sourceTransactionId,recognition:'final_liquidation'}};
 return{accounts:[bank,term],observations,annotations:observations.map((o,i)=>({id:'annotation'+i,observationId:o.id,revision:String(i+1),patch:{kind:'transfer',category:'\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff08\u7528\u6237\u56de\u5fc6\uff0c\u53ef\u4fee\u6539\uff09\uff1a'+term.label}})),links:[],imports:[{id:'statement',provider:'ccb',financialAccountId:'bank',fileHash:'a'.repeat(64),observationIds:observations.map(o=>o.id),statementOwner:{schema:'bank-statement-owner-v1',fullName:'\u6797\u6708\u9ec4'}}],balanceSnapshots:[{id:'closed',financialAccountId:'term',currency:'CNY',asOf:'2013-09-07T23:59:59.999+08:00',balanceMinor:'0',source:'owner_confirmation',createdAt:'2026-10-26T00:00:00Z'}]};
}

test('same-card term renewals retain every bank cash leg and recognize only the known reinvestment cycle gain at final withdrawal',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l);assert.equal(JSON.stringify(l),raw);assert.equal(v.review.transactionCount,0);assert.equal(v.currencyTotals.CNY.incomeMinor,'2352');assert.equal(v.accountStats.bank.incomeMinor,'0');assert.equal(v.accountStats.term.incomeMinor,'2352');assert.equal(v.accountStats.term.balanceMinor,'0');assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);
 for(const o of l.observations){const t=v.transactions.find(t=>t.id===o.id),delta=BigInt(o.amountMinor)*(o.direction==='credit'?1n:-1n);assert.equal(t.cashEffects.bank,String(delta));assert.equal(t.balanceEffects.bank,String(delta));assert.deepEqual(t.sources,[o]);assert(t.termDepositPosting.originalBankCashPreserved);}
 const renewal=v.transactions.find(t=>t.id==='source2'),last=v.transactions.find(t=>t.id==='source4');assert.equal(renewal.termDepositPosting.capitalizedKnownGainMinor,'755');assert.equal(renewal.cashEffects.term,'-103565');assert.equal(renewal.incomeMinor,'0');assert.equal(last.termDepositPosting.capitalizedKnownGainMinor,'1597');assert.equal(last.cashEffects.term,'-104320');assert.equal(last.incomeMinor,'2352');assert.equal(v.termDeposits[0].initialPrincipalBeforeFirstObservedRedemptionKnown,false);
});

test('term-only and bank-only filters keep income ownership stable and historical balances follow rollover capital, without inventing earlier principal',()=>{
 const l=fixture(),term=buildFinanceView(l,{accountIds:['term']}),bank=buildFinanceView(l,{accountIds:['bank']}),nov=buildFinanceView(l,{endDate:'2012-11-12'}),march=buildFinanceView(l,{endDate:'2013-03-01'}),before=buildFinanceView(l,{endDate:'2012-11-01'});
 assert.equal(term.currencyTotals.CNY.incomeMinor,'2352');assert.equal(bank.currencyTotals.CNY.incomeMinor,'0');assert.equal(term.transactions.length,5);assert.equal(nov.accountStats.term.balanceMinor,'103565');assert.equal(march.accountStats.term.balanceMinor,'104320');assert.equal(march.currencyTotals.CNY.incomeMinor,'0');assert.equal(before.accountStats.term.balanceMinor,null);
});

test('missing owner evidence, wrong self-card fields, changed policy amounts and annotation undo never create a term counterpart',()=>{
 for(const change of[
  l=>l.imports[0].statementOwner.fullName='Other owner',
  l=>l.observations[2].rawFields['\u5bf9\u65b9\u8d26\u53f7']='****6943',
  l=>l.accounts[1].termDeposit.movements[2].amountMinor='104321',
  l=>l.annotations.push({id:'undo',observationId:'source2',revision:'20',reset:true,patch:{}}),
  l=>l.accounts[0].maskedIdentifier='6943',
 ]){const l=fixture();change(l);const v=buildFinanceView(l);assert(v.review.groups.some(g=>g.reason==='term_deposit_evidence_unresolved'));assert(v.transactions.every(t=>!t.termDepositPosting));assert.equal(v.transactions.find(t=>t.id==='source4').cashEffects.bank,'105917');}
});

test('one bank cash source cannot be claimed by two term accounts and unknown initial cost does not become income',()=>{
 const l=fixture();l.accounts.push({...l.accounts[1],id:'other-term',label:'Other term',termDeposit:structuredClone(l.accounts[1].termDeposit)});const v=buildFinanceView(l);assert.equal(v.termDeposits,undefined);assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert(v.transactions.every(t=>!t.termDepositPosting));
 const partial=fixture();delete partial.accounts[1].termDeposit.rolloverCycle;delete partial.accounts[1].termDeposit.closedAt;partial.balanceSnapshots=[];const p=buildFinanceView(partial);assert.equal(p.currencyTotals.CNY.incomeMinor,'0');assert.equal(p.accountStats.term.balanceMinor,null);assert.equal(p.termDeposits[0].recognizedHistoricalGainMinor,null);
});

test('term policy rejects malformed identities, duplicate source claims, unsupported income timing and incompatible linked cards',()=>{
 const l=fixture(),p=l.accounts[1].termDeposit;assert.equal(validateTermDeposit(p),p);assert(termDepositBindingValid(l.accounts[1],l.accounts[0]));
 for(const change of [p=>p.movements.push({...p.movements[0]}),p=>p.rolloverCycle.recognition='daily',p=>p.rolloverCycle=0,p=>p.rolloverCycle=null,p=>p.rolloverCycle=false,p=>p.closedAt='2012-01-01',p=>p.bankCardTail='058',p=>p.extra='untrusted']){const x=structuredClone(p);change(x);assert.throws(()=>validateTermDeposit(x),/TERM_DEPOSIT_INVALID/);}
 assert.equal(termDepositBindingValid({...l.accounts[1],type:'investment'},l.accounts[0]),false);assert.equal(termDepositBindingValid(l.accounts[1],{...l.accounts[0],provider:'Other bank'}),false);
});
