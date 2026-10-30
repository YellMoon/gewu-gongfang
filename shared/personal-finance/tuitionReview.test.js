'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildTuitionCandidates,sourceKey,moneyMinor}=require('./tuitionReview');
const raw={id:'o',financialAccountId:'wallet',sourceTransactionId:'trade',provider:'wechat',date:'2026-10-01',occurredAt:'2026-10-01T10:10:10+08:00',amountMinor:'300000',currency:'CNY',direction:'credit',kind:'income',status:'completed',counterparty:'\u9648\u53ef\u6db5\u5988\u5988 (\u5fae\u5fae)',description:'\u9648\u53ef\u6db54\u6b21\u5b66\u8d39'};
const tx=(patch={})=>({id:'t',kind:'income',currency:'CNY',incomeMinor:'300000',sources:[raw],...patch});
test('same names remain ambiguous and never imply approval; source records are immutable',()=>{
 const students=[{id:'s1',name:'\u9648\u53ef\u6db5'},{id:'s2',name:'\u9648\u53ef\u6db5'}],input={transactions:[tx()],students},before=JSON.stringify(input),rows=buildTuitionCandidates(input);
 assert.equal(rows.length,1);assert.equal(rows[0].matches.length,2);assert.equal(rows[0].suggestedStudentId,'');assert.equal(JSON.stringify(input),before);assert(!rows[0].confirmed);
});
test('single name is a disclosed suggestion and duplicated original evidence makes one candidate',()=>{
 const rows=buildTuitionCandidates({transactions:[tx(),tx({sources:[{...raw,id:'new-copy'}]})],students:[{id:'s',name:'\u9648\u53ef\u6db5'}]});
 assert.equal(rows.length,1);assert.equal(rows[0].suggestedStudentId,'s');assert(rows[0].reasons.length);assert.equal(rows[0].source.observationId,'o');
});
test('internal transfers, refunds, failed receipts, foreign currency and loan proceeds are not tuition candidates',()=>{
 for(const change of [{kind:'transfer',balanceEffects:{wallet:'300000',bank:'-300000'}},{kind:'refund'},{kind:'loan_drawdown'},{sources:[{...raw,amountMinor:'0'}]},{currency:'USD'},{sources:[{...raw,status:'failed'}]},{sources:[{...raw,kind:'refund'}]}])assert.equal(buildTuitionCandidates({transactions:[tx(change)],includeAll:true}).length,0);
});
test('completed parent tuition transfer is eligible even when personal income is zero',()=>{
 const rows=buildTuitionCandidates({transactions:[tx({kind:'transfer',incomeMinor:'0',balanceEffects:{wallet:'300000'},sources:[{...raw,kind:'transfer'}]})],students:[{id:'s',name:'\u9648\u53ef\u6db5'}]});assert.equal(rows.length,1);assert.equal(rows[0].amountMinor,'300000');assert.equal(rows[0].suggestedStudentId,'s');
});
test('ordinary income stays available under include-all; old links survive source row reimport',()=>{
 const o={...raw,counterparty:'Nick',description:'Transfer'},t=tx({sources:[o]});assert.equal(buildTuitionCandidates({transactions:[t]}).length,0);
 const row=buildTuitionCandidates({transactions:[t],includeAll:true})[0],link={source:row.source,allocations:[{studentId:'s',paymentId:'p'}]};
 const linked=buildTuitionCandidates({transactions:[tx({sources:[{...o,id:'new-id'}]})],links:[link]})[0];assert.deepEqual(linked.linked,link);assert.equal(sourceKey(link.source),sourceKey(linked.source));
});
test('existing payments use exact minor units, student ID and bounded date, not a nickname',()=>{
 assert.equal(moneyMinor('0.29'),'29');assert.equal(moneyMinor('1.001'),null);
 const rows=buildTuitionCandidates({transactions:[tx()],students:[{id:'s',name:'\u9648\u53ef\u6db5'}],payments:[{id:'p',student_id:'s',amount:'3000.00',payment_date:'2026-10-02'},{id:'other',student_id:'x',amount:3000,payment_date:'2026-10-01'}]});
 assert.deepEqual(rows[0].similarPayments.map(p=>p.id),['p']);
});
