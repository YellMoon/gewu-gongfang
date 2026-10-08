'use strict';
// All fixtures below are synthetic; they are not verified bank exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBillCsv } = require('./billCsv');

test('zero income column cannot hide a bank debit; decimal precision is exact', () => {
  const result = parseBillCsv('交易日期,收入金额,支出金额,余额,摘要\n2026-10-01,0.00,"1,234.56","9,876.54",消费');
  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].amountMinor, '123456');
  assert.equal(result.records[0].balanceMinor, '987654');
  assert.equal(result.records[0].direction, 'debit');
  assert.equal(result.records[0].occurredAt, '2026-10-01T00:00:00+08:00');
});
test('quoted comma/newline and Alipay product/reference survive normalization', () => {
  const result = parseBillCsv('支付宝账单\n交易号,交易创建时间,交易对方,商品说明,收/支,金额（元）,交易状态,商户订单号\n="202610000000000001",2026-10-01 12:34:56,商户,"商品,说明\n第二行",支出,0.29,交易成功,order-1');
  const r = result.records[0];
  assert.equal(result.provider, 'alipay');
  assert.equal(r.amountMinor, '29');
  assert.equal(r.description, '商品,说明\n第二行');
  assert.equal(r.sourceTransactionId, '202610000000000001');
  assert.equal(r.relatedReference, 'order-1');
  assert.equal(r.rawFields['商品说明'], r.description);
});
test('WeChat refund, transfer, failed and pending records remain explicit', () => {
  const result = parseBillCsv('微信支付账单\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n2026-10-01 01:00:00,退款,商户,退款,收入,10,零钱,退款成功,r1\n2026-10-01 02:00:00,转账,朋友,转账,支出,20,银行卡,支付失败,t1\n2026-10-01 03:00:00,转账,朋友,转账,收入,30,零钱,处理中,t2');
  assert.deepEqual(result.records.map(r => [r.kind, r.direction, r.status]), [['refund','credit','completed'], ['transfer','debit','failed'], ['transfer','credit','pending']]);
});
test('canonical template preserves large minor units without floating-point rounding', () => {
  const result = parseBillCsv('\uFEFFdate,type,amount,category,note\n2026-10-01,income,900719925474099.99,工资,备注');
  assert.equal(result.templateId, 'canonical-v1');
  assert.equal(result.records[0].amountMinor, '90071992547409999');
  assert.equal(result.records[0].kind, 'income');
});
test('invalid dates, fractions, ambiguous direction and malformed rows have physical line diagnostics', () => {
  const result = parseBillCsv('date,type,amount,category,note\n2026-02-30,expense,1,a,b\n2026-10-01,expense,1.001,a,b\n2026-10-01,unknown,5,a,b\n2026-10-01,expense,2,a\n2026-10-01,expense,3,a,"unterminated');
  assert.deepEqual(result.errors.map(e => e.line), [2,3,4,5,6]);
  assert.equal(result.records.length, 0);
});
test('unknown schema includes explicit mapping prompt; explicit fields and signed amount work', () => {
  const source = 'posted,value,memo\n2026/10/01,-12.05,消费';
  const unknown = parseBillCsv(source);
  assert.equal(unknown.errors[0].code, 'BILL_HEADER_UNRECOGNIZED');
  assert.match(unknown.errors[0].message, /fieldMapping/);
  const mapped = parseBillCsv(source, { fieldMapping: { date: 'posted', amount: 'value', description: 'memo', amountConvention: 'signed', provider: 'custom-bank' } });
  assert.equal(mapped.records[0].amountMinor, '1205');
  assert.equal(mapped.records[0].direction, 'debit');
  assert.equal(mapped.provider, 'custom-bank');
});
test('debit/credit direction bank export and UnionPay fields normalize', () => {
  const bank = parseBillCsv('交易日期,借贷方向,交易金额,账户余额,对方户名,摘要,流水号\n20261001,贷,1.20,3.20,甲,工资,b1');
  assert.equal(bank.records[0].direction, 'credit');
  assert.equal(bank.records[0].sourceTransactionId, 'b1');
  const union = parseBillCsv('云闪付账单\n交易时间,交易类型,收支类型,交易金额,交易状态,交易订单号,商户名称\n2026-10-01 10:00:00,消费,支出,18.99,成功,u1,商户');
  assert.equal(union.provider, 'unionpay');
  assert.equal(union.records[0].counterparty, '商户');
});
test('simultaneous debit/credit, unknown status and non-CNY never silently post', () => {
  assert.equal(parseBillCsv('交易日期,收入金额,支出金额\n2026-10-01,1,2').errors[0].code, 'BILL_AMOUNT_AMBIGUOUS');
  assert.equal(parseBillCsv('date,type,amount,status\n2026-10-01,expense,1,神秘状态').errors[0].code, 'BILL_STATUS_UNKNOWN');
  assert.equal(parseBillCsv('date,type,amount,currency\n2026-10-01,expense,1,USD').errors[0].code, 'BILL_CURRENCY_UNSUPPORTED');
});
test('signed balance, loan principal/interest/fee and account hint are retained', () => {
  const result = parseBillCsv('date,type,amount,balance,principal,interest,fee,paymentAccountHint\n2026-10-01,debt_payment,102.30,-4.25,100,2,0.30,尾号1234');
  assert.deepEqual([result.records[0].kind,result.records[0].principalMinor,result.records[0].interestMinor,result.records[0].feeMinor,result.records[0].balanceMinor], ['debt_payment','10000','200','30','-425']);
  assert.equal(result.records[0].paymentAccountHint, '1234');
});
test('unknown explicit kind is not reclassified and status mappings are never guessed', () => {
  const r = parseBillCsv('date,direction,kind,amount\n2026-10-01,debit,unknown,1.20');
  assert.equal(r.records[0].kind,'unknown');
});
test('negative dual-column reversals require explicit direction rather than losing the sign', () => {
  const r = parseBillCsv('交易日期,收入金额,支出金额\n2026-10-01,0,-1.20');
  assert.equal(r.records.length,0);
  assert.equal(r.errors[0].code,'BILL_DUAL_AMOUNT_SIGN_REQUIRES_REVIEW');
});
test('overflowed calendar values have a date-specific diagnostic', () => {
  assert.equal(parseBillCsv('date,type,amount\n2026-00-01,expense,1').errors[0].code,'BILL_DATE_INVALID');
});
test('separate bank date/time columns and compact timestamp retain time', () => {
  const split = parseBillCsv('交易日期,交易时间,借贷方向,交易金额\n20261001,12:34:56,借,1.20');
  assert.equal(split.records[0].occurredAt,'2026-10-01T12:34:56+08:00');
  const compact = parseBillCsv('交易时间,借贷方向,交易金额\n20261001123456,贷,1.20');
  assert.equal(compact.records[0].occurredAt,'2026-10-01T12:34:56+08:00');
});
test('untrusted mapping config cannot change result types or use prototype keys', () => {
  const source = 'date,type,amount\n2026-10-01,income,1';
  for (const mapping of [{provider:{}},{defaultDirection:'banana'},{amountConvention:'guess'},JSON.parse('{"constructor":0}')]) {
    assert.equal(parseBillCsv(source,{fieldMapping:mapping}).errors[0].code,'BILL_MAPPING_INVALID');
  }
});
test('only interpreted fields survive in rawFields and account hints are normalized tail four', () => {
  const source = 'date,type,amount,paymentAccountHint,paymentChannel,未知账号,description,sourceTransactionId\n2026-10-01,expense,1.20,6222020123456789,工商银行(6222020123456789),9988776655443322,转账至6222020123456789,2026100100000000000001';
  const r = parseBillCsv(source).records[0];
  assert.equal(r.paymentAccountHint,'6789');
  assert.equal(r.paymentChannel,'工商银行(****6789)');
  assert.equal(r.description,'转账至****6789');
  assert.equal(r.rawFields.paymentAccountHint,'6789');
  assert.equal(r.rawFields['未知账号'],undefined);
  assert.equal(r.sourceTransactionId,'2026100100000000000001');
  assert.ok(!JSON.stringify(r).includes('6222020123456789'));
  assert.ok(!JSON.stringify(r).includes('9988776655443322'));
});
test('decorated bank tail identifiers normalize for exact maskedIdentifier matching', () => {
  for (const hint of ['尾号1234','****1234','中国银行(1234)','1234','6222 0201 9876 1234']) {
    const r = parseBillCsv('date,type,amount,paymentAccountHint\n2026-10-01,expense,1,' + hint).records[0];
    assert.equal(r.paymentAccountHint,'1234');
  }
  const r = parseBillCsv('date,type,amount,paymentChannel\n2026-10-01,expense,1,建设银行(1234)').records[0];
  assert.equal(r.paymentAccountHint,'1234','payment channel tail can identify funding account when explicit hint is absent');
});
