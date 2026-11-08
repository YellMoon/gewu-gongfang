'use strict';
// Viewing categories are derived from evidence, without changing ledger annotations.
const BILL_CATEGORIES = ['支付红包与减免','房贷','车贷','物业费','房租','停车费','日常消费','工资与其他收入','退款','转账与其他还款','其他待分类'];
/** @type {Array<[string, RegExp]>} */
const BILL_CATEGORY_RULES = [
 ['支付红包与减免', /红包|减免|抵扣|立减|优惠券|支付优惠/],
 ['房贷', /房贷|住房贷款|住房按揭|购房贷款|公积金贷款/],
 ['车贷', /车贷|汽车贷款|汽车金融|车辆贷款|购车分期/],
 ['物业费', /物业|物管/],
 ['房租', /房租|租房|租金|房屋租赁/],
 ['停车费', /停车|泊车|泊位/],
];
function billCategory(transaction) {
 const category = String(transaction.category || '').trim();
 if (BILL_CATEGORIES.includes(category)) return category;
 const evidence = [category, transaction.description, transaction.counterparty].join(' ');
 for (const [label, pattern] of BILL_CATEGORY_RULES) if (pattern.test(evidence)) return label;
 if (transaction.kind === 'refund') return '退款';
 if (transaction.kind === 'income') return '工资与其他收入';
 if (['transfer','debt_payment','loan_drawdown'].includes(transaction.kind)) return '转账与其他还款';
 if (['expense','fee','interest'].includes(transaction.kind)) return '日常消费';
 return '其他待分类';
}
function compareBillAmount(left, right) {
 const a = BigInt(left.amountMinor), b = BigInt(right.amountMinor);
 const magnitudeA = a < 0n ? -a : a, magnitudeB = b < 0n ? -b : b;
 return magnitudeA === magnitudeB ? 0 : magnitudeA < magnitudeB ? -1 : 1;
}
function billTimestamp(transaction) {
 return transaction.occurredAt || transaction.sources?.[0]?.occurredAt || transaction.date;
}
function compareBillTime(left, right) {
 return Date.parse(billTimestamp(left)) - Date.parse(billTimestamp(right)) || String(left.id).localeCompare(String(right.id));
}
function largeBillThresholds(transactions) {
 const groups = new Map();
 for (const transaction of transactions) {
  const consumption = BigInt(transaction.selectedConsumptionMinor ?? transaction.consumptionMinor ?? '0');
  if (transaction.status !== 'completed' || consumption <= 0n) continue;
  const key = JSON.stringify([transaction.currency, billCategory(transaction)]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(consumption);
 }
 const thresholds = new Map();
 for (const [key, amounts] of groups) {
  if (amounts.length < 5) continue;
  amounts.sort((a,b) => a === b ? 0 : a < b ? -1 : 1);
  const median = amounts[Math.floor((amounts.length - 1) / 2)];
  const lower = amounts[Math.floor((amounts.length - 1) / 4)];
  const upper = amounts[Math.floor((amounts.length - 1) * 3 / 4)];
  const fence = upper + (upper - lower) * 3n / 2n;
  thresholds.set(key, median * 3n > fence ? median * 3n : fence);
 }
 return thresholds;
}
function isLargeBill(transaction, thresholds) {
 const threshold = thresholds.get(JSON.stringify([transaction.currency, billCategory(transaction)]));
 return threshold !== undefined && transaction.status === 'completed'
  && BigInt(transaction.selectedConsumptionMinor ?? transaction.consumptionMinor ?? '0') > threshold;
}
module.exports={BILL_CATEGORIES,billCategory,compareBillAmount,billTimestamp,compareBillTime,largeBillThresholds,isLargeBill};
