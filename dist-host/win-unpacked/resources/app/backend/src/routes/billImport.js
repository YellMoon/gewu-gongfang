/**
 * 账单导入路由 — 邮件拉取 + CSV 解析
 */
const express = require('express');
const router = express.Router();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { PassThrough } = require('stream');

// ===== CSV 解析器 =====
const PLATFORM_PARSERS = {
  wechat: { name: '微信', keywords: ['微信支付账单明细', '微信支付'] },
  alipay: { name: '支付宝', keywords: ['支付宝', 'alipay'] },
  bank: { name: '银行通用', keywords: ['交易日期', '摘要', '对方户名'] },
};

function parseCsv(content) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  // auto-detect platform
  let platform = 'bank';
  for (const [key, cfg] of Object.entries(PLATFORM_PARSERS)) {
    if (cfg.keywords.some(k => content.includes(k))) { platform = key; break; }
  }

  // find header
  let headerIdx = -1, headers = [];
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const fields = lines[i].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    if (platform === 'wechat' && fields.includes('交易时间')) { headerIdx = i; headers = fields; break; }
    if (platform === 'alipay' && fields.some(f => ['交易号', '商品说明'].includes(f))) { headerIdx = i; headers = fields; break; }
    if (platform === 'bank' && fields.some(f => ['交易日期', '摘要', '对方户名'].includes(f))) { headerIdx = i; headers = fields; break; }
  }
  if (headerIdx === -1) return [];

  const fieldMap = {
    '交易时间': 'dt', '交易创建时间': 'dt', '付款时间': 'dt', '交易日期': 'date',
    '商品': 'desc', '商品名称': 'desc', '摘要': 'desc', '摘要信息': 'desc',
    '交易对方': 'cp', '对方户名': 'cp',
    '金额(元)': 'amt', '金额': 'amt', '金额（元）': 'amt',
    '收/支': 'dir', '借贷方向': 'dir',
    '收入金额': 'inc', '支出金额': 'exp', '借方发生额': 'exp', '贷方发生额': 'inc',
  };
  const mapped = headers.map(h => fieldMap[h] || h);

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('-') || line.startsWith('#')) continue;
    const fields = line.split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    if (fields.length < headers.length) continue;

    const raw = {};
    mapped.forEach((h, idx) => { raw[h] = fields[idx] || ''; });

    const dir = raw.dir || '';
    let type = 'other', amount = 0;
    if (dir.includes('收入') || dir.includes('贷') || raw.inc) { type = 'income'; amount = parseFloat(raw.inc || raw.amt || '0') || 0; }
    else if (dir.includes('支出') || dir.includes('借') || raw.exp) { type = 'expense'; amount = parseFloat(raw.exp || raw.amt || '0') || 0; }
    if (type === 'other' || amount <= 0) continue;

    const dt = (raw.dt || raw.date || '').replace(/\//g, '-');
    results.push({
      date: dt.split(' ')[0], type, amount, description: raw.desc || '',
      counterparty: raw.cp || '', platform: PLATFORM_PARSERS[platform]?.name || '未知'
    });
  }
  return results;
}

// ===== IMAP 邮件检查 ====
router.post('/check', async (req, res) => {
  const { imap_server, imap_port, email, password } = req.body;
  if (!imap_server || !email || !password) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const imap = new Imap({
    user: email, password, host: imap_server, port: imap_port || 993,
    tls: true, tlsOptions: { rejectUnauthorized: false }
  });

  const billKeywords = ['账单', '交易明细', '电子账单', '账户明细', '消费记录', '流水'];
  const results = [];

  try {
    await new Promise((resolve, reject) => {
      imap.once('ready', resolve);
      imap.once('error', reject);
      imap.connect();
    });

    await new Promise((resolve, reject) => {
      imap.openBox('INBOX', true, (err, box) => err ? reject(err) : resolve(box));
    });

    // Build search criteria
    const searchCriteria = billKeywords.map(kw => ['SUBJECT', kw]);
    // Flatten: [['OR', ['SUBJECT','a'], ['SUBJECT','b']], ['SUBJECT','c']]
    const flatCriteria = [];
    for (const kw of billKeywords) flatCriteria.push(['SUBJECT', kw]);

    const msgIds = await new Promise((resolve, reject) => {
      imap.search(flatCriteria, (err, ids) => err ? reject(err) : resolve(ids || []));
    });

    const recentIds = msgIds.slice(-20); // last 20 emails

    for (const id of recentIds) {
      try {
        const msg = await new Promise((resolve, reject) => {
          const fetch = imap.fetch(id, { bodies: '' });
          fetch.on('message', (msg, seqno) => {
            const chunks = [];
            msg.on('body', (stream, info) => {
              stream.on('data', c => chunks.push(c));
              stream.on('end', () => resolve(Buffer.concat(chunks)));
            });
          });
          fetch.once('error', reject);
          fetch.once('end', () => { /*noop*/ });
        });

        const parsed = await simpleParser(msg);
        const subject = parsed.subject || '';
        const matched = billKeywords.find(k => subject.includes(k));

        if (matched && parsed.attachments && parsed.attachments.length > 0) {
          for (const att of parsed.attachments) {
            const ext = (att.filename || '').toLowerCase();
            if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx')) continue;
            const content = att.content.toString('utf-8');
            const records = parseCsv(content);
            if (records.length > 0) {
              results.push({ subject, filename: att.filename, records, count: records.length });
            }
          }
        }
      } catch (e) {
        // skip failed emails
      }
    }

    imap.end();
  } catch (e) {
    try { imap.end(); } catch(ex) {}
    return res.json({ error: e.message, emails: results });
  }

  res.json({ emails: results, total: results.reduce((s, r) => s + r.count, 0) });
});

// ===== CSV 文件解析 ====
router.post('/parse-csv', (req, res) => {
  const { content, filename } = req.body;
  if (!content) return res.status(400).json({ error: '缺少内容' });
  const records = parseCsv(content);
  res.json({ records, count: records.length, filename });
});

module.exports = router;
