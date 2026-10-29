'use strict';
function registerBillMailboxRoutes({ app, mailbox, finance, projectionService, tenantId, desktopContext }) {
  const prefix = '/api/business/personal-finance/mailbox';
  const run = (work, heavy = false) => async (req, res) => {
    try {
      const actor = await desktopContext(req);
      if (!actor?.roles?.some(role => ['teacher', 'super_admin'].includes(role))) return res.status(403).json({ ok: false, code: 'BILL_MAIL_ACCESS_DENIED' });
      if (!mailbox || !finance) return res.status(503).json({ ok: false, code: 'BILL_MAIL_NOT_CONFIGURED' });
      const execute = async () => res.json({ ok: true, ...await work(req, actor) });
      return await (heavy && projectionService?.exclusive ? projectionService.exclusive(execute) : execute());
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
  app.post(prefix + '/preview', run(async (req, actor) => {
    const input=body(req,['messageId','attachmentId','password','expectedFileHash','financialAccountId','relatedFinancialAccountIds']);
    const preview=await mailbox.previewAttachment({actor,...input});
    return {preview:typeof finance.resolveImportAccount==='function'?{...preview,...await finance.resolveImportAccount({tenantId,actor,financialAccountId:input.financialAccountId,relatedFinancialAccountIds:input.relatedFinancialAccountIds},preview)}:preview};
  }, true));
  app.post(prefix + '/import', run(async (req, actor) => {
    const input = body(req, ['messageId', 'attachmentId', 'financialAccountId', 'expectedRevision', 'fieldMapping','password','expectedFileHash','expectedFinancialAccountId','relatedFinancialAccountIds','expectedRelatedFinancialAccountIds']);
    const key = req.get('x-idempotency-key');
    if (!key) throw Object.assign(new Error('BILL_MAIL_INPUT_INVALID'), { code: 'BILL_MAIL_INPUT_INVALID' });
    const source = await mailbox.getAttachment({ actor, messageId: input.messageId, attachmentId: input.attachmentId });
    return { receipt: await finance.import({ tenantId, actor, filename: source.filename, base64: source.buffer.toString('base64'), financialAccountId: input.financialAccountId, expectedFinancialAccountId:input.expectedFinancialAccountId,relatedFinancialAccountIds:input.relatedFinancialAccountIds,expectedRelatedFinancialAccountIds:input.expectedRelatedFinancialAccountIds, expectedRevision: input.expectedRevision, fieldMapping: input.fieldMapping, password: input.password, expectedFileHash: input.expectedFileHash, idempotencyKey: key }) };
  }, true));
}
module.exports = { registerBillMailboxRoutes };
