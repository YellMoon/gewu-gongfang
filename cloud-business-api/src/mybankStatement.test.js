'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseMybankRows}=require('./mybankStatement');
const {parseYuebaoCertificate}=require('./yuebaoCertificate');
const {resolveBillAccount}=require('./billAccountResolution');
const {validateRecord}=require('../../shared/personal-finance/ledger');
const headers=['\u4ea4\u6613\u65f6\u95f4','\u4ea4\u6613\u91d1\u989d','\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u673a\u6784\u540d\u79f0','\u4ea4\u6613\u6d41\u6c34\u53f7','\u4ea4\u6613\u540d\u79f0'];
const rows=[['\u7f51\u5546\u94f6\u884c\u8d26\u6237\u6536\u652f\u660e\u7ec6'],['\u660e\u7ec6\u533a\u95f4\uff1a2026-01-01 00:00:00-2026-10-19 00:00:00'],['\u5361\u53f7\uff1a6666660000001234'],headers,
 ['2026-10-01 10:00:00','-10.00','0.00','synthetic','****5678','bank','1234567890123452','\u8f6c\u51fa\u5230\u4ed6\u884c'],
 ['2026-10-01 10:00:00','+10.00','10.00','synthetic','****5678','bank','1234567890123451','\u8f6c\u5165']];
test('bank balances reconcile exactly and resolve the bank identity rather than a wallet',()=>{
 const result=parseMybankRows(rows);assert.deepEqual(result.errors,[]);result.records.forEach(validateRecord);
 assert.deepEqual(result.records.map(r=>r.balanceMinor),['1000','0']);assert.equal(result.records[0].statementFlow.openingBeforeFirstMinor,'0');
 const account=resolveBillAccount({preview:result,accounts:[],owner:['t','a']}).account;assert.equal(account.type,'debit_card');assert.equal(account.maskedIdentifier,'1234');
 const existing={...account,id:'existing',label:'renamed'};assert.equal(resolveBillAccount({preview:result,accounts:[existing],owner:['t','a']}).account.id,'existing');
 assert(!JSON.stringify(result).includes('6666660000001234'));
});
test('broken chain refuses the entire import, including already parsed rows',()=>{
 const broken=structuredClone(rows);broken[4][2]='0.01';const result=parseMybankRows(broken);
 assert.equal(result.records.length,0);assert.equal(result.errors[0].code,'BILL_BANK_RECONCILIATION_FAILED');
});
test('investment balance is estimated; negative income retains its actual sign',()=>{
 const result=parseMybankRows([['\u4f59\u5229\u5b9d\u8d44\u91d1\u660e\u7ec6'],['\u660e\u7ec6\u533a\u95f4\uff1a2026-01-01 00:00:00-2026-10-19 00:00:00'],['\u4ea4\u6613\u8d26\u53f7\uff1a6666660000001234'],['\u4ea4\u6613\u65f6\u95f4','\u4ea4\u6613\u7c7b\u578b','\u4ea4\u6613\u91d1\u989d','\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u673a\u6784\u540d\u79f0','\u5907\u6ce8'],['2026-10-01 10:00:00','\u6b63\u5e38\u6536\u76ca','-0.01','99.99','','','','\u6536\u76ca\u8c03\u6574']]);
 assert.deepEqual(result.errors,[]);assert.equal(result.records[0].kind,'income');assert.equal(result.records[0].direction,'debit');assert.equal(result.records[0].statementFlow.balanceKind,'estimated');
 const resolved=resolveBillAccount({preview:result,accounts:[],owner:['t','a']});assert.equal(resolved.account.sourceProduct,'alipay_yulibao');
});
test('certificate retains distributor scope, as-of time and zero without cash movement',()=>{
 const result=parseYuebaoCertificate([{items:[{str:'\u4f59\u989d\u5b9d\u8d44\u4ea7\u67e5\u8be2\u60c5\u51b5\u544a\u77e5\u4e66 \u622a\u81f32026\u5e7410\u670819\u65e511\u65f613\u520615\u79d2 \u5408\u8ba1\u4eba\u6c11\u5e010.00\u5143 \u6d59\u6c5f\u7f51\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8'}]}]);
 assert.deepEqual(result.errors,[]);result.records.forEach(validateRecord);assert.equal(result.records[0].balanceEvidence.balanceKind,'distributor_total');assert.equal(result.records[0].occurredAt,'2026-10-19T11:13:15+08:00');assert.equal(result.records[0].amountMinor,'0');
});
