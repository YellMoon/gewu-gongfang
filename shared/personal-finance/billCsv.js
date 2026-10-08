'use strict';

// Header aliases describe formats, not bank certifications. Unknown layouts require mapping.
const ALIASES = Object.freeze({
  date: ['date','交易日期','记账日期','入账日期','日期'],
  occurredAt: ['occurredAt','交易时间','交易创建时间','付款时间','记账时间','入账时间'],
  direction: ['direction','收/支','收支','收支类型','收支方向','借贷方向','借贷标志'],
  kind: ['kind','交易类型','业务类型'], type: ['type'],
  amount: ['amount','金额','金额(元)','金额（元）','交易金额','交易金额(元)','发生额','发生金额'],
  incomeAmount: ['incomeAmount','收入金额','贷方发生额','贷方金额','收入','贷方'],
  expenseAmount: ['expenseAmount','支出金额','借方发生额','借方金额','支出','借方'],
  sourceTransactionId: ['sourceTransactionId','交易号','交易单号','交易订单号','流水号','交易流水号','银行流水号'],
  description: ['description','note','商品说明','商品','商品名称','摘要','摘要信息','交易摘要','备注','用途'],
  counterparty: ['counterparty','交易对方','对方户名','对方名称','对手名称','对方账户名称','商户名称'],
  category: ['category','分类','收支分类'],
  paymentChannel: ['paymentChannel','支付方式','收/付款方式','支付渠道','交易渠道','渠道'],
  paymentAccountHint: ['paymentAccountHint','付款账户','支付账户','本方账号','账号','卡号','账户'],
  balance: ['balance','余额','账户余额','交易余额','账户余额(元)','余额(元)'],
  relatedReference: ['relatedReference','商户订单号','商家订单号','原交易号','原交易流水号','关联交易号'],
  status: ['status','交易状态','当前状态','状态'], currency: ['currency','币种','货币'],
  principal: ['principal','本金','本金金额'], interest: ['interest','利息','利息金额'], fee: ['fee','手续费','手续费金额'],
});
const CONFIG_KEYS = new Set(['provider','defaultDirection','amountConvention']);
const KINDS = new Set(['expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown']);
function diagnostic(line, code, message) { return { line, code, message }; }
function invalid(code, message) { throw Object.assign(new Error(message), { code }); }
function clean(value) {
  const text = String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
  // Spreadsheet-safe identifier text, never execute formula expressions.
  return /^="[^"]*"$/.test(text) ? text.slice(2, -1) : text;
}
function normalizePaymentAccountHint(value) {
  const groups = clean(value).match(/\d(?:[\d \t-]*\d)?/g) || [];
  const identifiers = groups.map(group => group.replace(/\D/g,'')).filter(group => group.length >= 4);
  return identifiers.length ? identifiers[identifiers.length - 1].slice(-4) : '';
}
function maskLongNumbers(value) {
  return clean(value).replace(/(^|[^\d])(\d(?:[ \t-]?\d){11,})(?!\d)/g, (_,prefix,number) => `${prefix}****${number.replace(/\D/g,'').slice(-4)}`);
}
function tokenize(source) {
  const rows = []; let cells = [], cell = '', quoted = false, afterQuote = false, line = 1, start = 1, issue = '';
  const flush = () => { cells.push(cell); rows.push({ cells, line: start, issue }); cells = []; cell = ''; issue = ''; afterQuote = false; start = line; };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else { cell += ch; if (ch === '\n') line += 1; }
    } else if (ch === '"' && (!cell.trim() || cell === '=')) { if (cell === '=') cell = ''; quoted = true; }
    else if (ch === ',') { cells.push(cell); cell = ''; afterQuote = false; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i += 1; line += 1; flush(); }
    else { if (afterQuote && ch.trim()) issue = '引号闭合后存在非分隔内容'; cell += ch; }
  }
  if (quoted) issue = '引号未闭合';
  if (cell || cells.length || issue) flush();
  return rows;
}
function money(value, { optional = false, signed = false } = {}) {
  let text = clean(value).replace(/^[¥￥]\s*/, '').replace(/\s*元$/, '');
  if (optional && ['', '-', '--', '/'].includes(text)) return null;
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  if (text.includes(',') && !/^[+-]?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) invalid('BILL_AMOUNT_INVALID', '金额千分位格式无效');
  text = text.replace(/,/g, '');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(text) || text.length > 40) invalid('BILL_AMOUNT_INVALID', '金额必须为最多两位小数的十进制数，不允许精度截断');
  const negative = text[0] === '-';
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const minor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
  return signed && negative && minor !== '0' ? `-${minor}` : minor;
}
function timestamp(value) {
  let text = clean(value).replace(/[年月/]/g, '-').replace(/日/g, '');
  if (/^\d{14}$/.test(text)) text = `${text.slice(0,8)} ${text.slice(8,10)}:${text.slice(10,12)}:${text.slice(12,14)}`;
  if (/^\d{8}(?:$| )/.test(text)) text = `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}${text.slice(8)}`;
  const parts = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!parts) invalid('BILL_DATE_INVALID', '日期/时间格式无效');
  const [, year, month, day, hh = '00', mm = '00', ss = '00', fraction = '', zone = '+08:00'] = parts;
  const date = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) invalid('BILL_DATE_INVALID', '日期超出有效范围');
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date || +hh > 23 || +mm > 59 || +ss > 59 || (zone !== 'Z' && (+zone.slice(1,3) > 14 || +zone.slice(4) > 59 || (+zone.slice(1,3) === 14 && +zone.slice(4) !== 0)))) invalid('BILL_DATE_INVALID', '日期/时间超出有效范围');
  return { date, occurredAt: `${date}T${hh}:${mm}:${ss}${fraction}${zone}` };
}
function directionOf(value) {
  const text = clean(value).toLowerCase();
  if (/^(credit|income|贷|贷方|收入|收|c|cr|收款)$/.test(text)) return 'credit';
  if (/^(debit|expense|借|借方|支出|付|d|dr|付款)$/.test(text)) return 'debit';
  return null;
}
function kindOf(value, direction, description) {
  const text = clean(value).toLowerCase();
  if (KINDS.has(text)) return text;
  const source = `${text} ${description}`;
  if (/退款|退货|refund/.test(source)) return 'refund';
  if (/转账|转入|转出|提现|充值|transfer/.test(source)) return 'transfer';
  if (/借款到账|贷款发放|贷款放款|loan_drawdown/.test(source)) return 'loan_drawdown';
  if (/还款|偿还|debt_payment/.test(source)) return 'debt_payment';
  if (/手续费|服务费/.test(source)) return 'fee';
  if (/利息|结息/.test(source)) return 'interest';
  return direction === 'credit' ? 'income' : 'expense';
}
function statusOf(value) {
  const text = clean(value).toLowerCase();
  if (!text || /^(completed|成功|交易成功|支付成功|退款成功|已入账|已完成|对方已收钱|已收款|已转账|已到账)$/.test(text)) return 'completed';
  if (/失败|关闭|取消|已撤销|已退还/.test(text) || text === 'failed') return 'failed';
  if (/处理中|等待|待付款|待支付|待收款|未支付|退款中/.test(text) || text === 'pending') return 'pending';
  invalid('BILL_STATUS_UNKNOWN', `交易状态“${text}”未识别，请人工核验或映射状态`);
}
function resolveMapping(headers, supplied) {
  const mapping = {};
  for (const [key, aliases] of Object.entries(ALIASES)) {
    const explicit = supplied[key];
    if (explicit !== undefined) {
      const index = Number.isInteger(explicit) ? explicit : headers.indexOf(clean(explicit));
      if (index < 0 || index >= headers.length) return null;
      mapping[key] = index;
    } else {
      const index = headers.findIndex(h => aliases.some(alias => h.toLowerCase() === alias.toLowerCase()));
      if (index >= 0) mapping[key] = index;
    }
  }
  if ((mapping.date === undefined && mapping.occurredAt === undefined) || (mapping.amount === undefined && mapping.incomeAmount === undefined && mapping.expenseAmount === undefined)) return null;
  return mapping;
}
function parseBillCsv(content, { filename = '', fieldMapping = {} } = {}) {
  const result = { provider: 'unknown', templateId: null, records: [], errors: [], warnings: [] };
  if (typeof content !== 'string' || !content.trim() || content.length > 20 * 1024 * 1024) {
    result.errors.push(diagnostic(1, 'BILL_INPUT_INVALID', '账单文本为空或超过20 MiB')); return result;
  }
  if (!fieldMapping || typeof fieldMapping !== 'object' || Array.isArray(fieldMapping) || Object.keys(fieldMapping).some(k => !Object.prototype.hasOwnProperty.call(ALIASES,k) && !CONFIG_KEYS.has(k))
    || (fieldMapping.provider !== undefined && (typeof fieldMapping.provider !== 'string' || !fieldMapping.provider.trim() || fieldMapping.provider.length > 128))
    || (fieldMapping.defaultDirection !== undefined && !['debit','credit'].includes(fieldMapping.defaultDirection))
    || (fieldMapping.amountConvention !== undefined && fieldMapping.amountConvention !== 'signed')
    || Object.entries(fieldMapping).some(([key,value]) => Object.prototype.hasOwnProperty.call(ALIASES,key) && !((typeof value === 'string' && value.trim()) || (Number.isInteger(value) && value >= 0)))) {
    result.errors.push(diagnostic(1, 'BILL_MAPPING_INVALID', 'fieldMapping 含未知字段或格式无效')); return result;
  }
  const rows = tokenize(content.replace(/^\uFEFF/, ''));
  let headerIndex = -1, headers, mapping;
  for (let i = 0; i < Math.min(rows.length, 100); i += 1) {
    const candidate = rows[i].cells.map(clean);
    const resolved = resolveMapping(candidate, fieldMapping);
    if (resolved && !rows[i].issue) { headerIndex = i; headers = candidate; mapping = resolved; break; }
  }
  if (headerIndex < 0) {
    result.errors.push(diagnostic(1, 'BILL_HEADER_UNRECOGNIZED', '未找到有效账单表头。请通过 fieldMapping 映射 date/occurredAt、amount 或 incomeAmount/expenseAmount、direction/type；不得仅依据银行名称猜测格式。')); return result;
  }
  if (new Set(headers).size !== headers.length) { result.errors.push(diagnostic(rows[headerIndex].line, 'BILL_HEADER_DUPLICATE', '账单表头重复，无法无损保存原始字段')); return result; }
  const hint = `${filename} ${content.slice(0,4096)}`;
  result.provider = fieldMapping.provider || (/支付宝/.test(hint) || headers.includes('交易创建时间') ? 'alipay' : /微信/.test(hint) || headers.includes('微信支付交易单号') ? 'wechat' : /云闪付|银联/.test(hint) ? 'unionpay' : headers.includes('date') ? 'generic' : 'bank');
  result.templateId = Object.keys(fieldMapping).some(k => ALIASES[k]) ? 'explicit-mapping-v1' : headers.slice(0,5).join(',') === 'date,type,amount,category,note' ? 'canonical-v1' : `${result.provider}-fields-v1`;
  const get = (row, key) => mapping[key] === undefined ? '' : clean(row.cells[mapping[key]]);
  const dataRows = rows.slice(headerIndex + 1);
  if (dataRows.length > 10000) { result.errors.push(diagnostic(rows[headerIndex].line, 'BILL_ROW_LIMIT', '最多支持10000行账单，请拆分文件')); return result; }
  for (const row of dataRows) {
    if (!row.cells.some(v => clean(v))) continue;
    if (row.cells.length === 1 && /^(?:[-=]{3,}|#)/.test(clean(row.cells[0]))) { result.warnings.push(diagnostic(row.line, 'BILL_NON_TRANSACTION_LINE', '账单分隔/说明行未作为交易导入')); continue; }
    try {
      if (row.issue) invalid('BILL_CSV_SYNTAX', row.issue);
      if (row.cells.length !== headers.length) invalid('BILL_COLUMN_COUNT', `列数应为${headers.length}，实际为${row.cells.length}`);
      const sourceTime = get(row,'occurredAt'), sourceDate = get(row,'date');
      const at = timestamp(/^\d{2}:\d{2}/.test(sourceTime) && sourceDate ? `${sourceDate} ${sourceTime}` : sourceTime || sourceDate);
      const currency = get(row,'currency');
      if (currency && !/^(CNY|RMB|人民币|人民币元|156)$/i.test(currency)) invalid('BILL_CURRENCY_UNSUPPORTED', `暂不支持币种 ${currency}，不可当作人民币导入`);
      const income = money(get(row,'incomeAmount'), { optional: true });
      const expense = money(get(row,'expenseAmount'), { optional: true });
      if ((income && income !== '0' && money(get(row,'incomeAmount'),{signed:true})[0] === '-') || (expense && expense !== '0' && money(get(row,'expenseAmount'),{signed:true})[0] === '-')) invalid('BILL_DUAL_AMOUNT_SIGN_REQUIRES_REVIEW','双列账单出现负数冲正，请人工核验并导出明确方向与单列金额后重新导入');
      if (income && income !== '0' && expense && expense !== '0') invalid('BILL_AMOUNT_AMBIGUOUS', '同一行收入与支出均非零，请人工核验');
      const dualDirection = income && income !== '0' ? 'credit' : expense && expense !== '0' ? 'debit' : null;
      const type = get(row,'type');
      const explicitDirection = directionOf(get(row,'direction')) || directionOf(type) || directionOf(fieldMapping.defaultDirection);
      let direction = explicitDirection || dualDirection;
      if (explicitDirection && dualDirection && explicitDirection !== dualDirection) invalid('BILL_DIRECTION_CONFLICT', '收支方向与收入/支出列冲突');
      let amountMinor = dualDirection ? dualDirection === 'credit' ? income : expense : money(get(row,'amount'));
      if (!direction && fieldMapping.amountConvention === 'signed') direction = /^[-(]/.test(get(row,'amount')) ? 'debit' : 'credit';
      const semanticType = get(row,'kind') || type;
      if (!direction && /^(refund|loan_drawdown|退款|贷款发放|借款到账)$/.test(semanticType)) direction = 'credit';
      if (!direction && /^(debt_payment|fee|还款|手续费)$/.test(semanticType)) direction = 'debit';
      if (!direction) invalid('BILL_DIRECTION_UNKNOWN', '无法确定借贷方向，请通过 fieldMapping 映射 direction/type，或明确 defaultDirection/amountConvention');
      if (amountMinor === '0') invalid('BILL_AMOUNT_ZERO', '交易金额为零，请核验是否为说明行');
      const description = maskLongNumbers(get(row,'description'));
      const channelSource = get(row,'paymentChannel');
      const hintSource = get(row,'paymentAccountHint') || (/(?:银行|银行卡|card|bank|尾号|\*|[（(]\d{4}[）)])/i.test(channelSource) ? channelSource : '');
      const accountHint = normalizePaymentAccountHint(hintSource);
      const rawFields = Object.create(null);
      // The full original is archived privately by the import service. Only interpreted,
      // sanitized fields belong in the business observation; unknown columns are excluded.
      for (const [key,index] of Object.entries(mapping)) {
        const value = get(row,key);
        rawFields[headers[index]] = key === 'paymentAccountHint' || index === mapping.paymentAccountHint ? normalizePaymentAccountHint(value)
          : ['description','counterparty','category','paymentChannel'].includes(key) ? maskLongNumbers(value) : value;
      }
      const record = { sourceTransactionId: get(row,'sourceTransactionId'), ...at, amountMinor, currency: 'CNY', direction,
        kind: kindOf(semanticType, direction, description), description, counterparty: maskLongNumbers(get(row,'counterparty')), category: maskLongNumbers(get(row,'category')),
        paymentChannel: maskLongNumbers(channelSource), paymentAccountHint: accountHint, balanceMinor: money(get(row,'balance'), { optional: true, signed: true }),
        relatedReference: get(row,'relatedReference'), status: statusOf(get(row,'status')), principalMinor: money(get(row,'principal'), { optional: true }),
        interestMinor: money(get(row,'interest'), { optional: true }), feeMinor: money(get(row,'fee'), { optional: true }), rawFields };
      result.records.push(record);
      if (mapping.status === undefined) result.warnings.push(diagnostic(row.line, 'BILL_STATUS_ASSUMED_COMPLETED', '源文件无状态列，按已入账记录处理；提交前请核验'));
    } catch (error) { result.errors.push(diagnostic(row.line, error.code || 'BILL_ROW_INVALID', error.message || '账单行无效')); }
  }
  if (!result.records.length && !result.errors.length) result.errors.push(diagnostic(rows[headerIndex].line, 'BILL_NO_RECORDS', '未找到交易记录'));
  result.errors.sort((a,b) => a.line - b.line);
  return result;
}
module.exports = Object.freeze({ parseBillCsv, normalizePaymentAccountHint, BILL_FIELD_ALIASES: ALIASES });
