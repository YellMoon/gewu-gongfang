'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{TUITION,PASS_THROUGH,UNKNOWN,integerGrossCandidates}=require('./posMerchantReceipts');
const person='\u6797\u6708\u9ec4',limiao='\u674e\u61cb';
function native(id,sequence,amount,direction,{date='2018-03-12',description='\u94f6\u8054\u5165\u8d26',counterparty='\uff08\u7279\u7ea6\uff09\u5e73\u5b89\u94f6\u884c\uff08\u8d44\u91d1\u7ed3\u7b97\uff09',tail='0045'}={}){
 return{id,sourceIdentity:id,sourceTransactionId:id,importId:'hz',sourceVersionOrdinal:1,financialAccountId:'bank',provider:'hangzhou',date,occurredAt:date+'T23:59:59+08:00',amountMinor:amount,currency:'CNY',kind:direction==='debit'?'transfer':'unknown',direction,status:'completed',description,counterparty,paymentChannel:'',paymentAccountHint:'',balanceMinor:direction==='credit'?amount:'0',balanceConvention:'signed',principalMinor:null,interestMinor:null,feeMinor:null,statementFlow:{schema:'hangzhou-debit-v1',sequence,incomeMinor:direction==='credit'?amount:'0',expenseMinor:direction==='debit'?amount:'0',periodStart:'2018-01-01',periodEnd:'2020-01-01'},rawFields:{sequence,description,counterparty,counterAccount:'****'+tail}};
}
function annotation(id,revision,kind,category,extra={}){return{id:'a'+revision,observationId:id,revision:String(revision),patch:{kind,category,...extra}};}
function fixture(category=TUITION,amount='686205'){
 const receipt=native('receipt',1,amount,'credit'),out=native('out',2,amount,'debit',{description:'\u6c47\u5151/\u5468\u90c5\u6052\u5b66\u8d39',counterparty:person,tail:'2110'}),anchor=native('anchor',100,'795600','credit',{date:'2019-09-16',description:'\u94f6\u8054\u5165\u8d26/0915\u6613\u751f\u652f\u4ed8pos\u624b\u7eed\u8d3944.00\u5143,\u5546\u6237\u8d44..',counterparty:'\u6613\u751f\u652f\u4ed8\u6709\u9650\u516c\u53f8'});
 return{accounts:[{id:'bank',label:'Bank',provider:'Bank',type:'debit_card',currency:'CNY',status:'active',openingBalanceMinor:'0',openingDate:'2018-01-01'},{id:'studio',label:'Studio2110',provider:'JSB',type:'debit_card',maskedIdentifier:'2110',fundsRole:'studio_public',currency:'CNY',status:'active',openingBalanceMinor:null},{id:'clearing',label:'Scoped POS clearing',type:'receivable',currency:'CNY',balanceConvention:'signed',status:'active',counterpartySettlement:{schema:'counterparty-settlement-v1',counterparty:limiao,scope:'annotation_only'},openingBalanceMinor:'0',openingDate:'2018-01-01'}],observations:[receipt,out,anchor],imports:[],links:[],balanceSnapshots:[],annotations:[annotation('receipt',1,category===TUITION?'income':category===PASS_THROUGH?'transfer':'unknown',category,category===PASS_THROUGH?{settlementAccountId:'clearing'}:{}),annotation('out',2,'transfer','\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff1aStudio2110')]};
}
const receipt=v=>v.transactions.find(t=>t.observationIds.includes('receipt'));
test('integer gross inference uses cents and documented rounding; no floor-only or fractional-yuan guesses',()=>{
 assert.equal(integerGrossCandidates('457470').find(c=>c.rateBasisPoints===55).grossMinor,'460000');
 assert.equal(integerGrossCandidates('422662').find(c=>c.rateBasisPoints===55).feeMinor,'2338');
 assert.equal(integerGrossCandidates('4475052').filter(c=>c.rateBasisPoints===55).length,0);
 assert.equal(integerGrossCandidates('6521968').length,0);assert.deepEqual(integerGrossCandidates('2'),[]);
 assert.deepEqual(integerGrossCandidates('686205',[0,10000,55.5]),[]);
});
test('tuition gross and estimated collection cost balance to native net; onward transfer adds no second income',()=>{
 const l=fixture(),before=JSON.stringify(l),v=buildFinanceView(l),t=receipt(v),out=v.transactions.find(t=>t.id==='out');
 assert.equal(t.kind,'income');assert.equal(t.incomeMinor,'690000');assert.equal(t.consumptionMinor,'3795');assert.equal(t.posMerchantReceipt.fee.status,'estimated');assert.equal(t.posMerchantReceipt.fee.reversible,true);assert.equal(t.posMerchantReceipt.fee.autoCorrectOnActualEvidence,true);
 assert.deepEqual(t.balanceEffects,{bank:'686205'});assert.deepEqual(t.cashEffects,{bank:'686205'});assert.equal(t.amountMinor,'686205');assert.equal(out.incomeMinor,'0');assert.equal(out.balanceEffects.studio,'686205');assert.equal(t.posMerchantReceipt.cardChargeIndependentlyVerified,false);assert.equal(JSON.stringify(l),before);
 assert(!v.review.groups.some(g=>g.transactionIds.includes(t.id)));
});
test('actual withheld fee supersedes estimate and never creates a second cash debit',()=>{
 const l=fixture(TUITION,'795600');l.observations[0]={...l.observations[2],id:'receipt',sourceIdentity:'receipt',sourceTransactionId:'receipt',statementFlow:{...l.observations[2].statementFlow,sequence:1}};l.observations[1].date='2019-09-16';l.observations[1].occurredAt='2019-09-16T23:59:59+08:00';l.observations.pop();const t=receipt(buildFinanceView(l));
 assert.equal(t.posMerchantReceipt.fee.status,'explicit');assert.equal(t.incomeMinor,'800000');assert.equal(t.consumptionMinor,'4400');assert.deepEqual(t.cashEffects,{bank:'795600'});assert(!t.posSettlementFee);
});
test('a closed third-party POS pass-through has no personal income, expense, or own credit-card debt',()=>{
 const l=fixture(PASS_THROUGH,'9188982');l.observations.splice(1,1,native('out',2,'5000000','debit',{counterparty:limiao,tail:'2615',description:'\u6c47\u5151'}),native('out2',3,'4188982','debit',{counterparty:limiao,tail:'2615',description:'\u6c47\u5151'}));
 l.annotations[1]=annotation('out',2,'transfer','POS pass-through paid',{settlementAccountId:'clearing'});l.annotations.push(annotation('out2',3,'transfer','POS pass-through paid',{settlementAccountId:'clearing'}));
 const v=buildFinanceView(l),t=receipt(v);assert.equal(t.kind,'transfer');assert.equal(t.posMerchantReceipt.purpose,'third_party_pos_pass_through');assert.deepEqual(t.posMerchantReceipt.onwardObservationIds,['out','out2']);assert.equal(t.balanceEffects.clearing,'-9188982');assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert.equal(v.accountStats.clearing.balanceMinor,'0');assert(!v.review.groups.some(g=>g.transactionIds.includes(t.id)));
});
test('unreconciled third-party fees are metadata only and never require an invented own payment card',()=>{
 const l=fixture(PASS_THROUGH,'976570');l.observations[1].counterparty=limiao;l.observations[1].rawFields.counterparty=limiao;l.annotations[1]=annotation('out',2,'transfer','POS pass-through paid',{settlementAccountId:'clearing'});const v=buildFinanceView(l),t=receipt(v);
 assert.equal(t.posMerchantReceipt.fee.status,'unknown');assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert.equal(v.accountStats.clearing.balanceMinor,'0');assert(!v.review.groups.some(g=>g.transactionIds.includes(t.id)));
});
test('tuition with no matching fee model remains pending with known net income',()=>{
 const v=buildFinanceView(fixture(TUITION,'2998000')),t=receipt(v);assert.equal(t.incomeMinor,'2998000');assert.equal(t.consumptionMinor,'0');assert.equal(t.posMerchantReceipt.fee.status,'unknown');assert(v.review.groups.some(g=>g.reason==='pos_settlement_fee_unknown'&&g.transactionIds.includes(t.id)));
});
test('own-account destinations stay unresolved; estimated fee cannot turn a purpose guess into an expense',()=>{
 const l=fixture(UNKNOWN);l.observations[1].rawFields.counterAccount='****6943';const v=buildFinanceView(l),t=receipt(v);assert.equal(t.kind,'unknown');assert.equal(t.posMerchantReceipt.purpose,'unresolved');assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert(v.review.groups.some(g=>g.reason==='unknown_kind'&&g.transactionIds.includes(t.id)));
});
test('source versions are counted once and ordinary settlements do not activate fee inference',()=>{
 const l=fixture();l.observations.push({...l.observations[0],id:'receipt-v2',sourceVersionOrdinal:2});l.annotations.push(annotation('receipt-v2',3,'income',TUITION));const v=buildFinanceView(l);assert.equal(v.transactions.filter(t=>t.posMerchantReceipt?.purpose==='studio_tuition').length,1);assert.equal(v.transactions.find(t=>t.posMerchantReceipt?.purpose==='studio_tuition').incomeMinor,'690000');
 const ordinary=fixture();ordinary.annotations=[];assert(!buildFinanceView(ordinary).transactions.some(t=>t.posMerchantReceipt));
});
test('wrong routes, missing raw evidence, missing fee anchor and conflicting native fees cannot silently reconcile',()=>{
 for(const mutate of [l=>{l.observations[1].rawFields.counterAccount='****9999';},l=>{delete l.observations[0].rawFields.description;},l=>{l.observations.pop();},l=>{l.observations[0].feeMinor='9000';}]){
  const l=fixture();mutate(l);const v=buildFinanceView(l),t=receipt(v);assert(v.review.groups.some(g=>g.transactionIds.includes(t.id)));assert.equal(t.incomeMinor,'686205');assert.equal(t.consumptionMinor,'0');
 }
});
test('tuition whole-balance sweep preserves a prior four-cent residual without calling it a POS fee',()=>{
 const l=fixture(TUITION,'457470');l.observations[0].balanceMinor='457474';l.observations[1].amountMinor='457474';l.observations[1].statementFlow.expenseMinor='457474';l.observations[1].balanceMinor='0';const t=receipt(buildFinanceView(l));assert.equal(t.posMerchantReceipt.routeBasis,'whole_balance_tuition_sweep_includes_prior_four_cents');assert.equal(t.posMerchantReceipt.onwardMinor,'457474');assert.equal(t.posMerchantReceipt.fee.feeMinor,'2530');assert.equal(t.incomeMinor,'460000');
});
test('a later owner decision supersedes the old own-credit annotation without deleting history',()=>{
 const l=fixture();l.annotations.unshift(annotation('receipt',0,'loan_drawdown','\u4fe1\u7528\u5361\u5468\u8f6c\u5230\u8d26\uff08\u7528\u6237\u786e\u8ba4\uff0c\u6263\u6b3e\u5361\u53ca\u624b\u7eed\u8d39\u5f85\u6838\u5bf9\uff09'));const before=JSON.stringify(l),v=buildFinanceView(l),t=receipt(v);assert.equal(t.kind,'income');assert(!v.review.groups.some(g=>g.reason==='unresolved_credit_cash_advance'&&g.transactionIds.includes(t.id)));assert.equal(JSON.stringify(l),before);
});
test('annotation-only counterparty scope never reclassifies unrelated LiMao history',()=>{
 const l=fixture(PASS_THROUGH);l.observations[1].counterparty=limiao;l.observations[1].rawFields.counterparty=limiao;l.annotations[1]=annotation('out',2,'transfer','POS pass-through paid',{settlementAccountId:'clearing'});
 l.observations.push({...native('unrelated',101,'10000','debit',{date:'2019-10-01',counterparty:limiao,tail:'2615'}),importId:'unrelated'});const v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='unrelated');assert.equal(t.balanceEffects.clearing,undefined);assert.equal(v.accountStats.clearing.balanceMinor,'0');
});
test('new explicit fee evidence automatically corrects an estimate while the cash source stays unchanged',()=>{
 const l=fixture(),before=receipt(buildFinanceView(l));assert.equal(before.posMerchantReceipt.fee.status,'estimated');
 const source=l.observations[0];source.description='\u94f6\u8054\u5165\u8d26/pos\u624b\u7eed\u8d3930.00\u5143';source.rawFields.description=source.description;const after=receipt(buildFinanceView(l));assert.equal(after.posMerchantReceipt.fee.status,'explicit');assert.equal(after.posMerchantReceipt.fee.feeMinor,'3000');assert.equal(after.incomeMinor,'689205');assert.deepEqual(after.cashEffects,before.cashEffects);
});
test('mixed credit and capped debit fees from the original tuition workbook preserve documentary provenance',()=>{
 const l=fixture(TUITION,'6521968'),{TUITION_DOCUMENTED}=require('./posMerchantReceipts');l.annotations[0].patch={kind:'income',category:TUITION_DOCUMENTED,feeMinor:'28032'};const t=receipt(buildFinanceView(l));assert.equal(t.posMerchantReceipt.fee.status,'documented_annotation');assert.equal(t.posMerchantReceipt.fee.annotationId,'a1');assert.equal(t.posMerchantReceipt.fee.grossMinor,'6550000');assert.equal(t.incomeMinor,'6550000');assert.equal(t.consumptionMinor,'28032');assert.deepEqual(t.cashEffects,{bank:'6521968'});
});
test('later native fee text overrides a prior documented fee annotation rather than being masked by it',()=>{
 const l=fixture(TUITION,'795600'),{TUITION_DOCUMENTED}=require('./posMerchantReceipts');l.annotations[0].patch={kind:'income',category:TUITION_DOCUMENTED,feeMinor:'4300'};
 const source=l.observations[0];source.description='\u94f6\u8054\u5165\u8d26/pos\u624b\u7eed\u8d3944.00\u5143';source.rawFields.description=source.description;const t=receipt(buildFinanceView(l));assert.equal(t.posMerchantReceipt.fee.status,'explicit');assert.equal(t.posMerchantReceipt.fee.feeMinor,'4400');assert.equal(t.incomeMinor,'800000');assert.deepEqual(t.cashEffects,{bank:'795600'});
});
test('a scoped POS decision preserves a separately authorized ordinary personal-cashflow policy',()=>{
 const l=fixture(PASS_THROUGH);l.observations[1].counterparty=limiao;l.observations[1].rawFields.counterparty=limiao;l.annotations[1]=annotation('out',2,'transfer','POS pass-through paid',{settlementAccountId:'clearing'});
 l.accounts.push({id:'wallet',label:'Wallet',type:'wallet',currency:'CNY',status:'active',openingBalanceMinor:null});
 for(const[id,day]of [['personal-rule','01'],['ordinary','02']])l.observations.push({...native(id,1,'10000','debit',{date:'2018-06-'+day,counterparty:limiao,description:'Transfer'}),financialAccountId:'wallet',provider:'wechat',importId:undefined,statementFlow:undefined,balanceMinor:null,paymentChannel:'\u96f6\u94b1',rawFields:{}});
 l.annotations.push(annotation('personal-rule',3,'expense','\u6682\u6309\u4e2a\u4eba\u652f\u51fa\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09'));const t=buildFinanceView(l).transactions.find(t=>t.id==='ordinary');assert.equal(t.kind,'expense');assert.equal(t.consumptionMinor,'10000');assert.equal(t.balanceEffects.clearing,undefined);
});
test('the actual PingAn-Yisheng T1 statement name retains its special-merchant prefix',()=>{
 const l=fixture(),source=l.observations[0];source.counterparty='\uff08\u7279\u7ea6\uff09\u5e73\u5b89\u6613\u751fT1\uff08\u8d44\u91d1\u7ed3\u7b97\uff09';source.rawFields.counterparty=source.counterparty;const v=buildFinanceView(l),t=receipt(v);assert.equal(t.posMerchantReceipt.purpose,'studio_tuition');assert.equal(t.incomeMinor,'690000');assert.equal(v.transactions.find(t=>t.id==='out').balanceEffects.studio,'686205');assert(!v.review.groups.some(g=>g.transactionIds.includes(t.id)));
});
