'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView}=require('./ledger');
const {findProductCreditRepayments,findFamilyProductPaymentGroups,findProductWalletTopUps}=require('./productPaymentBatches');
function fixture(wallet=false,family=false) {
  const accounts=[{id:'wallet',label:'Wallet',provider:'alipay',type:'wallet',currency:'CNY',status:'active'},{id:'bank',label:'Mybank',provider:'\u7f51\u5546\u94f6\u884c',maskedIdentifier:'6342',type:'debit_card',currency:'CNY',status:'active'},{id:'product',label:'Yulibao',provider:'alipay',sourceProduct:'alipay_yulibao',type:'investment',currency:'CNY',status:'active'},{id:'debt',label:'Huabei',provider:'alipay',sourceProduct:'alipay_huabei',type:'credit_card',currency:'CNY',status:'active'}];
  const row=(id,sec,patch)=>({id,sourceTransactionId:id,date:'2022-04-10',occurredAt:'2022-04-10T08:38:'+sec+'+08:00',currency:'CNY',amountMinor:'600',status:'completed',kind:'transfer',direction:'debit',provider:'mybank',financialAccountId:'bank',description:'',counterparty:'',paymentChannel:'',paymentAccountHint:'',category:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,sourceVersionOrdinal:1,...patch,rawFields:{'\u4ea4\u6613\u65f6\u95f4':'2022-04-10 08:38:'+sec,...patch.rawFields}});
  const channel='\u7f51\u5546\u94f6\u884c\u50a8\u84c4\u5361(6342)',productPurpose='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-'+(family?'**\u5546\u8d38\u6709\u9650\u516c\u53f8':'*\u6b3e');
  const p=row('p',family?'05':'10',{provider:'alipay',financialAccountId:'wallet',amountMinor:family?'200':'1000',kind:family?'expense':'debt_payment',direction:family?'debit':'neutral',description:family?'\u4eb2\u60c5\u5361':'\u81ea\u52a8\u8fd8\u6b3e-\u82b1\u5457|\u4fe1\u7528\u8d2d2022\u5e7404\u6708\u8d26\u5355',counterparty:family?'Family':'\u82b1\u5457|\u4fe1\u7528\u8d2d',paymentChannel:channel+(wallet?'&\u4f59\u989d':''),paymentAccountHint:'6342',accountRelations:family?[]:[{product:'alipay_huabei',role:'target',activity:'repayment',financialAccountId:'debt'}],rawFields:{'\u4ea4\u6613\u72b6\u6001':family?'\u4ea4\u6613\u6210\u529f':'\u8fd8\u6b3e\u6210\u529f','\u6536/\u652f':family?'\u652f\u51fa':'\u4e0d\u8ba1\u6536\u652f','\u4ea4\u6613\u5206\u7c7b':family?'\u4eb2\u53cb\u4ee3\u4ed8':'\u4fe1\u7528\u501f\u8fd8'}});p.rawFields['\u5546\u54c1\u8bf4\u660e']=p.description;
  const observations=[p,row('product','09',{provider:'yulibao',financialAccountId:'product',description:productPurpose,statementFlow:{schema:'mybank-yulibao-v1'},rawFields:{'\u4ea4\u6613\u7c7b\u578b':'\u6b63\u5e38\u8d4e\u56de','\u5907\u6ce8':productPurpose,'\u5bf9\u65b9\u673a\u6784\u540d\u79f0':'\u6d59\u6c5f\u7f51\u5546\u94f6\u884c','\u5bf9\u65b9\u8d26\u53f7':'********6342'}}),row('credit','09',{direction:'credit',description:'\u8f6c\u51fa-\u4f59\u5229\u5b9d',counterparty:'*\u5229\u5b9d\u4ee3\u9500\u8d4e\u56de\u5e94\u6536-GD16MP',statementFlow:{schema:'mybank-current-v1'},rawFields:{'\u5bf9\u65b9\u6237\u540d':'*\u5229\u5b9d\u4ee3\u9500\u8d4e\u56de\u5e94\u6536-GD16MP'}}),row('debit','09',{kind:'unknown',description:'\u5feb\u6377\u652f\u4ed8',counterparty:'\u652f\u4ed8\u5b9d',statementFlow:{schema:'mybank-current-v1'},rawFields:{'\u5bf9\u65b9\u673a\u6784\u540d\u79f0':'\u652f\u4ed8\u5b9d'}})];
  if(family)observations.push({...p,id:'p2',sourceTransactionId:'p2',amountMinor:'400'});
  else if(!wallet)observations.push(row('direct','09',{amountMinor:'400',kind:'unknown',description:'\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-*\u6b3e',statementFlow:{schema:'mybank-current-v1'},rawFields:{'\u5bf9\u65b9\u673a\u6784\u540d\u79f0':'\u652f\u4ed8\u5b9d'}}));
  return {accounts,observations,annotations:[],links:[],imports:[],balanceSnapshots:[]};
}
const options=l=>({rootOf:id=>id,annotatedIds:new Set(l.annotations.map(a=>a.observationId)),links:l.links});
test('monthly credit repayment uses actual product clearing plus the proved bank or explicitly named wallet remainder',()=>{
  for(const wallet of [false,true]) {
    const l=fixture(wallet),before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.observationIds.includes('p'));
    assert.equal(v.review.transactionCount,0);assert.equal(v.transactions.length,1);assert.equal(t.balanceEffects.debt,'1000');assert.equal(t.balanceEffects.product,'-600');assert.equal(t.balanceEffects.bank,wallet?'0':'-400');assert.equal(t.balanceEffects.wallet,wallet?'-400':undefined);
    assert.equal(t.repaymentType,'credit');assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');assert.equal(Object.values(t.balanceEffects).reduce((s,v)=>s+BigInt(v),0n),0n);assert.equal(t.sources.find(s=>s.id==='p').occurredAt,'2022-04-10T08:38:10+08:00');assert.equal(t.sources.find(s=>s.id==='debit').occurredAt,'2022-04-10T08:38:09+08:00');assert.equal(JSON.stringify(l),before);
  }
});
test('unsupported debts, incomplete cash, inconsistent identity, fees and competing orders cannot close a repayment',()=>{
  for(const change of [l=>l.observations.splice(2,1),l=>l.observations.at(-1).amountMinor='401',l=>l.observations[1].rawFields['\u5bf9\u65b9\u8d26\u53f7']='********1111',l=>l.observations[0].paymentAccountHint='1111',l=>l.observations[0].feeMinor='1',l=>l.observations[0].accountRelations[0].product='alipay_jiebei',l=>l.observations[0].description='Generic repayment',l=>l.observations[0].rawFields={},l=>l.observations.push({...l.observations[0],id:'p3',sourceTransactionId:'p3'}),l=>l.observations.push({...l.observations[2],id:'credit2',sourceTransactionId:'credit2'}),l=>{l.observations[0].occurredAt='2022-04-10T08:38:11+08:00';l.observations[0].rawFields['\u4ea4\u6613\u65f6\u95f4']='2022-04-10 08:38:11';},l=>l.accounts[2].currency='USD']) {
    const l=fixture();change(l);assert.equal(findProductCreditRepayments(l.observations,l.accounts,options(l)).length,0);
  }
});
test('owner choices on any clearing or split leg and deleted matching links veto inference',()=>{
  for(const id of ['p','product','credit','debit','direct'])for(const type of ['annotation','distinct','group_distinct','deleted']) {
    const l=fixture();if(type==='annotation')l.annotations.push({observationId:id,revision:'1',patch:{category:'Owner choice'}});else l.links.push({type:type==='deleted'?'duplicate':type,status:type==='deleted'?'deleted':'active',observationIds:[id,id==='p'?'product':'p']});
    assert.equal(findProductCreditRepayments(l.observations,l.accounts,options(l)).length,0,id+' '+type);
  }
});
test('family order batch keeps every order, posts product spending once and retains both original bank movements',()=>{
  const l=fixture(false,true),before=JSON.stringify(l),v=buildFinanceView(l),group=v.reconciliationGroups.find(g=>g.method==='family_product_payment_group');assert(group);assert.equal(group.evidence.count,2);assert.equal(group.evidence.totalMinor,'600');assert.equal(v.transactions.length,5);assert.equal(v.review.transactionCount,0);assert.equal(v.currencyTotals.CNY.consumptionMinor,'600');assert.equal(v.accountStats.bank.cashInMinor,'600');assert.equal(v.accountStats.bank.cashOutMinor,'600');
  const orders=v.transactions.filter(t=>['p','p2'].includes(t.id));for(const t of orders){assert.deepEqual(t.balanceEffects,{});assert.deepEqual(t.reportingAccountIds,['product']);assert.equal(t.incomeExpenseAllocations.product.consumptionMinor,t.amountMinor);}
  assert.equal(v.transactions.reduce((s,t)=>s+BigInt(t.balanceEffects.product||'0'),0n),-600n);assert.equal(JSON.stringify(l),before);
});
test('family batch rejects unequal totals, different order clocks, masks without a merchant, extra candidates and owner vetoes',()=>{
  for(const change of [l=>l.observations.at(-1).amountMinor='401',l=>{l.observations.at(-1).occurredAt='2022-04-10T08:38:04+08:00';l.observations.at(-1).rawFields={...l.observations.at(-1).rawFields,'\u4ea4\u6613\u65f6\u95f4':'2022-04-10 08:38:04'};},l=>l.observations[1].description='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-*\u6b3e',l=>l.observations.push({...l.observations[0],id:'extra',sourceTransactionId:'extra'}),l=>l.annotations.push({observationId:'debit',revision:'1',patch:{category:'Owner choice'}}),l=>l.annotations.push({observationId:'p',revision:'1',patch:{category:'Owner choice'}}),l=>l.links.push({type:'distinct',observationIds:['p','debit']}),l=>l.links.push({type:'group_distinct',observationIds:['product','p2']})]) {
    const l=fixture(false,true);change(l);assert.equal(findFamilyProductPaymentGroups(l.observations,l.accounts,options(l)).length,0);
  }
});
function topupFixture(split=true) {
  const l=fixture(),p=l.observations[0],b=l.observations[1],direct=l.observations.at(-1);
  p.kind='transfer';p.direction='neutral';p.description='\u5145\u503c-\u666e\u901a\u5145\u503c';p.paymentChannel='\u4f59\u989d';p.paymentAccountHint='';p.accountRelations=[];p.rawFields['\u5546\u54c1\u8bf4\u660e']=p.description;p.rawFields['\u4ea4\u6613\u72b6\u6001']='\u4ea4\u6613\u6210\u529f';p.occurredAt='2022-04-10T08:38:05+08:00';p.rawFields['\u4ea4\u6613\u65f6\u95f4']='2022-04-10 08:38:05';
  b.description='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8';b.rawFields['\u5907\u6ce8']=b.description;
  direct.description='\u5feb\u6377\u652f\u4ed8';direct.statementFlow.periodStart='2022-04-01';direct.statementFlow.periodEnd='2022-05-01';l.observations=[p,b,direct];
  if(!split){p.amountMinor=b.amountMinor;direct.id='coverage';direct.sourceTransactionId='coverage';direct.date='2022-04-09';direct.occurredAt='2022-04-09T08:38:09+08:00';direct.rawFields['\u4ea4\u6613\u65f6\u95f4']='2022-04-09 08:38:09';direct.kind='expense';}
  return l;
}
test('a top-up credits the wallet once using the actual product and optional cash portions',()=>{
  for(const split of [false,true]){const l=topupFixture(split),before=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.observationIds.includes('p'));assert.equal(v.review.transactionCount,0);assert.equal(t.balanceEffects.wallet,split?'1000':'600');assert.equal(t.balanceEffects.product,'-600');assert.equal(t.balanceEffects.bank,split?'-400':undefined);assert.equal(t.consumptionMinor,'0');assert.equal(t.incomeMinor,'0');assert.equal(Object.values(t.balanceEffects).reduce((s,x)=>s+BigInt(x),0n),0n);assert.equal(t.automaticAssociations[0].method,'product_funded_wallet_top_up');assert.equal(JSON.stringify(l),before);}
});
test('three equal top-ups retain their chronological source evidence rather than being pooled',()=>{
  const l=topupFixture(),p=l.observations[0],b=l.observations[1],d=l.observations[2];
  const at=(o,sec)=>{o.occurredAt='2022-04-10T08:38:'+sec+'+08:00';o.rawFields['\u4ea4\u6613\u65f6\u95f4']='2022-04-10 08:38:'+sec;};at(b,'19');at(d,'19');
  for(const [id,ps,bs]of [['2','30','38'],['3','50','56']]){const cp=structuredClone(p),cb=structuredClone(b);cp.id='p'+id;cp.sourceTransactionId=cp.id;cb.id='product'+id;cb.sourceTransactionId=cb.id;cb.amountMinor='1000';at(cp,ps);at(cb,bs);l.observations.push(cp,cb);}
  const v=buildFinanceView(l);assert.equal(v.review.transactionCount,0);assert.equal(v.transactions.length,3);assert.deepEqual(v.transactions.map(t=>[t.observationIds.find(id=>id.startsWith('p')&&!id.startsWith('product')),t.cashEffects.wallet]).sort(),[['p','1000'],['p2','1000'],['p3','1000']]);assert.equal(v.transactions.reduce((s,t)=>s+BigInt(t.cashEffects.product),0n),-2600n);
});
test('top-ups reject unmatched cash, incomplete coverage, competing orders, owner decisions and contradictory source identity',()=>{
  for(const change of [l=>l.observations[2].amountMinor='401',l=>delete l.observations[2].statementFlow.periodEnd,l=>l.observations[0].automaticFunding={financialAccountId:'another-owner-confirmed-card'},l=>l.observations[1].rawFields['\u5bf9\u65b9\u8d26\u53f7']='********1111',l=>l.observations[1].description='Unknown transaction',l=>l.observations.push({...structuredClone(l.observations[0]),id:'p2',sourceTransactionId:'p2'}),l=>l.annotations.push({observationId:'direct',revision:'1',patch:{category:'Owner choice'}}),l=>l.links.push({type:'distinct',observationIds:['p','product']}),l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['p','direct']})]){const l=topupFixture();change(l);assert.equal(findProductWalletTopUps(l.observations,l.accounts,options(l)).length,0);}
});
test('an old source annotation vetoes the current version and family spending follows the actual product selection',()=>{
  const l=topupFixture(),old={...structuredClone(l.observations[1]),id:'old',sourceIdentity:'same',sourceVersionOrdinal:1};l.observations[1].sourceIdentity='same';l.observations[1].sourceVersionOrdinal=2;l.observations.push(old);l.annotations.push({observationId:'old',revision:'1',patch:{category:'Owner choice'}});const opts=options(l);opts.rootOf=id=>id==='old'?'product':id;assert.equal(findProductWalletTopUps(l.observations,l.accounts,opts).length,0);
  const family=fixture(false,true);assert.equal(buildFinanceView(family,{accountIds:['product']}).currencyTotals.CNY.consumptionMinor,'600');assert.equal(buildFinanceView(family,{accountIds:['bank']}).currencyTotals.CNY.consumptionMinor,'0');
});
