'use strict';
function registerBillMailboxRoutes({ app, mailbox, finance, tenantId, desktopContext }) {
  const prefix = '/api/business/personal-finance/mailbox';
  const run = work => async (req, res) => {
    try {
      const actor = await desktopContext(req);
      if (!actor?.roles?.some(role => ['teacher', 'super_admin'].includes(role))) return res.status(403).json({ ok: false, code: 'BILL_MAIL_ACCESS_DENIED' });
      if (!mailbox || !finance) return res.status(503).json({ ok: false, code: 'BILL_MAIL_NOT_CONFIGURED' });
      return res.json({ ok: true, ...await work(req, actor) });
    } catch (error) {
      const code = error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' ? 'BILL_MAIL_ACCESS_DENIED' : /^(BILL_|CLOUD_PERSONAL_FINANCE_)/.test(error.code || '') ? error.code : 'BILL_MAIL_UNAVAILABLE';
      return res.status(/ACCESS_DENIED/.test(code) ? 403 : /CONFLICT/.test(code) ? 409 : /INPUT_INVALID/.test(code) ? 400 : 503).json({ ok: false, code });
    }
  };
  const body = (req, keys) => {
    const value = req.body || {};
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Object.assign(new Error('BILL_MAIL_INPUT_INVALID'), { code: 'BILL_MAIL_INPUT_INVALID' });
    return value;
  };
  app.get(prefix, run(async (_, actor) => ({ mailbox: mailbox.status({ actor }) })));
  app.post(prefix + '/check', run(async (req, actor) => ({ mailbox: await mailbox.check({ actor, ...body(req, ['pageToken']) }) })));
  app.post(prefix + '/preview', run(async (req, actor) => ({ preview: await mailbox.previewAttachment({ actor, ...body(req, ['messageId', 'attachmentId']) }) })));
  app.post(prefix + '/import', run(async (req, actor) => {
    const input = body(req, ['messageId', 'attachmentId', 'financialAccountId', 'expectedRevision', 'fieldMapping']);
    const key = req.get('x-idempotency-key');
    if (!key || !input.financialAccountId) throw Object.assign(new Error('BILL_MAIL_INPUT_INVALID'), { code: 'BILL_MAIL_INPUT_INVALID' });
    const source = await mailbox.getAttachment({ actor, messageId: input.messageId, attachmentId: input.attachmentId });
    return { receipt: await finance.import({ tenantId, actor, filename: source.filename, base64: source.buffer.toString('base64'), financialAccountId: input.financialAccountId, expectedRevision: input.expectedRevision, fieldMapping: input.fieldMapping, idempotencyKey: key }) };
  }));
}
module.exports = { registerBillMailboxRoutes };
