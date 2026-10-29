'use strict';
// Deliberately bounded evidence: unknown calendar years return null. Weekend
// make-up workdays remain non-trading days for funds.
const sources = [
  'https://cschannel.alipay.com/mobile/helpDetail.htm?flag=0&help_id=261940',
  'https://www.xib.com.cn/upload/office/2014/11/be70cd25-75fa-4168-bdb4-4f4912836664.pdf',
  'https://www.nea.gov.cn/2015-01/08/c_133904166.htm',
  'https://www.ndrc.gov.cn/xxgk/zcfb/qt/201505/t20150513_967883.html'
];
const closedWeekdays = new Set([
  '01-01', '01-02', '02-18', '02-19', '02-20', '02-23', '02-24',
  '04-06', '05-01', '06-22', '09-03', '09-04',
  '10-01', '10-02', '10-05', '10-06', '10-07'
]);
function ordinaryYuebaoSettlement2015(o) {
  const match = String(o.occurredAt || '').match(/^(2015-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/);
  if (!match || match[1] !== o.date || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  let day = Date.parse(o.date + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== o.date) return null;
  const trading = date => ![0, 6].includes(date.getUTCDay()) && !closedWeekdays.has(date.toISOString().slice(5, 10));
  let remaining = trading(new Date(day)) && Number(match[2]) < 15 ? 1 : 2;
  for (let count = 0; count < 14; count++) {
    day += 86400000;
    const date = new Date(day), text = date.toISOString().slice(0, 10);
    if (!text.startsWith('2015-')) return null;
    if (trading(date) && --remaining === 0) return {dueDate:text, sources, rule:'ordinary_t_plus_1_fund_trading_days_2015', mode:'inferred_from_actual_receipt_not_original_service_selection'};
  }
  return null;
}
module.exports = {ordinaryYuebaoSettlement2015};
