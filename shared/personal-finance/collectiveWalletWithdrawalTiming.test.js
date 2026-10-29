'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCollectiveWalletWithdrawalTiming:plan,balancePostings}=require('./collectiveWalletWithdrawalTiming');
const {parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
const {reconcileIndependentBalances:reconcile}=require('./balanceReconciliation');
function fixture(){
 const date='2016-04-28',at=s=>date+'T'+s+'+08:00',accounts=[{id:'wallet',provider:'alipay',type:'wallet',status:'active',currency:'CNY'},{id:'bank',provider:'\u676d\u5dde\u94f6\u884c',type:'debit_card',status:'active',currency:'CNY',maskedIdentifier:'2683'}],amountMinor='500000';
 const sources=['17:19:28','17:19:41'].map((time,i)=>({id:'w'+i,sourceIdentity:'w'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',date,occurredAt:at(time),amountMinor,currency:'CNY',kind:'transfer',direction:'neutral',status:'completed',paymentChannel:'',counterparty:'\u676d\u5dde\u94f6\u884c',description:'\u63d0\u73b0-\u5feb\u901f\u63d0\u73b0',sourceTransactionId:'request'+i,rawFields:{'\u4ea4\u6613\u8ba2\u5355\u53f7':'request'+i,'\u4ea4\u6613\u65f6\u95f4':date+' '+time,'\u5546\u54c1\u8bf4\u660e':'\u63d0\u73b0-\u5feb\u901f\u63d0\u73b0','\u4ea4\u6613\u5bf9\u65b9':'\u676d\u5dde\u94f6\u884c','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':'5000.00'}}));
 const banks=[0,1].map(i=>({id:'b'+i,sourceIdentity:'b'+i,sourceVersionOrdinal:1,financialAccountId:'bank',provider:'hangzhou',date,occurredAt:at('23:59:59'),amountMinor,currency:'CNY',kind:'unknown',direction:'credit',status:'completed',statementFlow:{schema:'hangzhou-debit-v1',incomeMinor:amountMinor,expenseMinor:'0'}}));
 const parsed=parseAlipayWalletBalanceRows([['native-ref-1',date+' 17:21:01','\u63d0\u73b0\u672c\u4eba\u652f\u4ed8\u5b9d\u8f6c\u8d26','','-5000.00','10000.00','\u676d\u5dde\u94f6\u884c',''],['native-ref-0',date+' 17:20:42','\u63d0\u73b0\u672c\u4eba\u652f\u4ed8\u5b9d\u8f6c\u8d26','','-5000.00','15000.00','\u676d\u5dde\u94f6\u884c','']]);assert.deepEqual(parsed.errors,[]);
 const native=parsed.records.map((o,i)=>({...o,id:'n'+i,sourceIdentity:'n'+i,sourceVersionOrdinal:1,provider:'alipay',importId:'native',financialAccountId:'wallet'}));
 const group={id:'group',method:'balanced_wallet_withdrawal_group',platformRootIds:sources.map(s=>s.id),bankRootIds:banks.map(s=>s.id),observationIds:[...sources,...banks].map(s=>s.id),evidence:{financialAccountId:'bank',walletAccountId:'wallet',currency:'CNY',platform:'alipay',count:2,totalMinor:'1000000',amountMinor,date,individualIdentity:'undetermined',ownerProvenByOriginalStatement:true,netReceiptEqualsGross:true}};
 const transactions=[...sources,...banks].map(o=>{const wallet=o.financialAccountId==='wallet',delta=wallet?'-500000':'500000';return{id:o.id,kind:o.kind,currency:'CNY',status:'completed',date,occurredAt:o.occurredAt,observationIds:[o.id],sources:[o],balanceEffects:{[o.financialAccountId]:delta},cashEffects:{[o.financialAccountId]:delta},balanceEffectTimes:{[o.financialAccountId]:o.occurredAt},consumptionMinor:'0',incomeMinor:'0',reconciliationGroup:{id:'group',role:wallet?'platform_order':'bank_evidence',individualIdentity:'undetermined'}};});
 return{ledger:{accounts,observations:[...sources,...banks,...native],annotations:[],links:[],balanceSnapshots:[{id:'opening',source:'owner_confirmation',financialAccountId:'wallet',currency:'CNY',balanceMinor:'2000000',asOf:at('17:19:07')}],imports:[{id:'native',financialAccountId:'wallet',provider:'alipay',templateId:'alipay-wallet-balance-table-v1',recordCount:2,observationIds:native.map(o=>o.id),fileHash:'a'.repeat(64),sourceEvidence:{kind:'owner_authenticated_browser_table',sourceRows:2,sourcePages:1,periodStart:date,periodEnd:date}}]},transactions,groups:[group]};
}
test('two delayed wallet debits are projected once as a collective batch without row identity guesses',()=>{
 const f=fixture(),raw=JSON.stringify(f),groups=plan(f.ledger,f.transactions,f.groups);assert.equal(groups.length,1);assert.equal(JSON.stringify(f),raw);
 const g=groups[0];assert.equal(g.individualIdentity,'undetermined');assert.equal(g.sourceOrderReferencesMatched,false);assert(g.reversible);assert.equal(g.totalMinor,'-1000000');assert.equal(g.events.length,2);assert(g.events.every(e=>e.transactionId===undefined));
 assert.equal(reconcile(f.ledger,f.transactions).summary.differenceIntervalCount,2);
 assert.equal(reconcile(f.ledger,f.transactions,{balanceTimingGroups:groups}).summary.differenceIntervalCount,0);
 const projected=[...balancePostings(f.transactions,groups)],wallet=projected.filter(e=>e.financialAccountId==='wallet');assert.equal(wallet.length,2);assert(wallet.every(e=>e.transactionId===g.id&&e.sourceTransactionIds.length===2));assert.deepEqual(wallet.map(e=>e.occurredAt),['2016-04-28T17:20:42+08:00','2016-04-28T17:21:01+08:00']);
 assert.deepEqual(projected.filter(e=>e.financialAccountId==='bank').map(e=>[e.transactionId,e.occurredAt,e.deltaMinor]),f.transactions.slice(2).map(t=>[t.id,t.occurredAt,'500000']));
 assert.equal(wallet.reduce((n,e)=>n+BigInt(e.deltaMinor),0n),-1000000n);assert.equal(f.transactions.length,4);
 // Permuting requests cannot silently introduce an individual cash pairing.
 f.groups[0].platformRootIds.reverse();const permuted=plan(f.ledger,f.transactions,f.groups)[0];assert.deepEqual(permuted.events,g.events);
});
test('edits, incomplete documents, competing or claimed evidence and bank discrepancies veto collective timing',()=>{
 const changes=[
  f=>f.ledger.annotations.push({observationId:'w0'}),
  f=>f.ledger.annotations.push({observationId:'n0'}),
  f=>f.ledger.links.push({type:'group_distinct',status:'active',observationIds:['w0','n0']}),
  f=>f.ledger.links.push({type:'duplicate',status:'deleted',observationIds:['w0','n0']}),
  f=>f.transactions[2].cashPostingEvidence=[{proofObservationId:'n0'}],
  f=>f.transactions[0].balanceEffects.wallet='-499999',
  f=>f.transactions[2].balanceEffects.bank='499999',
  f=>f.transactions[2].sources[0].statementFlow.incomeMinor='499999',
  f=>f.groups[0].evidence.ownerProvenByOriginalStatement=false,
  f=>f.groups[0].evidence.netReceiptEqualsGross=false,
  f=>f.groups[0].platformRootIds[1]='w0',
  f=>f.groups.push(structuredClone(f.groups[0])),
  f=>f.ledger.imports[0].recordCount=3,
  f=>f.ledger.imports[0].sourceEvidence.sourceRows=3,
  f=>f.ledger.imports[0].sourceEvidence.periodEnd='2016-04-27',
  f=>{f.ledger.observations.push({...f.ledger.observations.find(o=>o.id==='n0'),id:'invalid-rival',sourceIdentity:'invalid-rival',importId:'other',status:'failed'});},
  f=>f.ledger.observations.find(o=>o.id==='n0').balanceMinor='1',
  f=>f.ledger.observations.find(o=>o.id==='n0').balanceEvidence.sequence=7,
  f=>f.ledger.observations.find(o=>o.id==='n0').rawFields['\u8d44\u91d1\u6e20\u9053']='\u5176\u4ed6\u94f6\u884c',
  f=>f.ledger.observations.push({...f.ledger.observations.find(o=>o.id==='n0'),id:'native-tie'}),
  f=>f.ledger.observations.push({...f.ledger.observations.find(o=>o.id==='w0'),id:'source-tie'}),
  f=>f.ledger.observations.push({...f.ledger.observations.find(o=>o.id==='w0'),id:'rival',sourceIdentity:'rival'}),
  f=>{f.transactions[0].sources[0].paymentChannel='\u4f59\u989d\u5b9d';},
  f=>{f.transactions[0].sources[0].rawFields['\u91d1\u989d']='4999.99';},
  f=>{f.transactions[0].balanceEffectEvents={wallet:[]};},
  f=>{f.transactions[0].kind='expense';},
  f=>{f.transactions[0].consumptionMinor='500000';},
  f=>{f.transactions[0].collectiveBalanceTiming={groupId:'previous'};},
  f=>{f.transactions[0].sources[0].feeMinor='1';},
  f=>{f.ledger.accounts[1].maskedIdentifier='';}
 ];
 for(const change of changes){const f=fixture();change(f);assert.equal(plan(f.ledger,f.transactions,f.groups).length,0,change.toString());}
});
test('cash before all requests and processing beyond five minutes remain unresolved',()=>{
 for(const time of ['17:20:50','17:00:00']){const f=fixture(),s=f.transactions[0].sources[0];s.occurredAt='2016-04-28T'+time+'+08:00';s.rawFields['\u4ea4\u6613\u65f6\u95f4']='2016-04-28 '+time;f.transactions[0].occurredAt=s.occurredAt;f.transactions[0].balanceEffectTimes.wallet=s.occurredAt;assert.equal(plan(f.ledger,f.transactions,f.groups).length,0);}
});
