'use strict';
const fail = code => Object.assign(new Error(code), { code });
function createBillMailbox({ ownerAccountId, inboxId, apiKey, fetch = globalThis.fetch, parseBillFile, downloadHosts = [], maxBytes = 24 * 1024 * 1024 }) {
  if (!ownerAccountId || !inboxId || !apiKey || typeof parseBillFile !== 'function') throw fail('BILL_MAIL_CONFIGURATION');
  const authorize = actor => { if (actor?.accountId !== ownerAccountId) throw fail('BILL_MAIL_ACCESS_DENIED'); };
  const part = value => { if (typeof value !== 'string' || !value || value.length > 300) throw fail('BILL_MAIL_INPUT_INVALID'); return encodeURIComponent(value); };
  const inboxPath = 'https://api.agentmail.to/v0/inboxes/' + part(inboxId);
  async function api(url) {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + apiKey }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw fail('BILL_MAIL_PROVIDER_UNAVAILABLE');
    return response.json();
  }
  async function getAttachment({ actor, messageId, attachmentId }) {
    authorize(actor);
    const meta = await api(inboxPath + '/messages/' + part(messageId) + '/attachments/' + part(attachmentId));
    let url;
    try { url = new URL(meta.download_url); } catch (_) { throw fail('BILL_MAIL_DOWNLOAD_URL_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !(url.hostname.endsWith('.agentmail.to') || downloadHosts.includes(url.hostname))) throw fail('BILL_MAIL_DOWNLOAD_URL_INVALID');
    if (meta.size > maxBytes) throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
    let filename = meta.filename;
    if (typeof filename !== 'string' || !filename.trim()) {
      const message = await api(inboxPath + '/messages/' + part(messageId));
      filename = (message.attachments || []).find(file => file.attachment_id === attachmentId)?.filename;
    }
    if (typeof filename !== 'string' || !filename.trim()) throw fail('BILL_MAIL_FILENAME_UNAVAILABLE');
    const response = await fetch(url.href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw fail('BILL_MAIL_DOWNLOAD_FAILED');
    if (Number(response.headers?.get('content-length')) > maxBytes) throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
    let buffer;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length; if (length > maxBytes) throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      buffer = Buffer.concat(chunks);
    } else buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
    return { filename: filename.slice(0, 180), buffer };
  }
  return Object.freeze({
    status({ actor }) { authorize(actor); return { address: inboxId, provider: 'AgentMail', mode: 'receive-only', configured: true }; },
    getAttachment,
    async previewAttachment(input) { const source = await getAttachment(input); return parseBillFile(source); },
    async check({ actor, pageToken }) {
      authorize(actor);
      if (pageToken && (typeof pageToken !== 'string' || pageToken.length > 1000)) throw fail('BILL_MAIL_INPUT_INVALID');
      const page = await api(inboxPath + '/messages?limit=30' + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''));
      const attachments = []; let budget = 5;
      for (const message of (page.messages || []).slice(0, 30)) {
        for (const file of (message.attachments || []).slice(0, 30)) {
          if (!/\.(csv|txt|xls|xlsx|zip|pdf|html?)$/i.test(file.filename || '')) continue;
          const item = { messageId: message.message_id, attachmentId: file.attachment_id, filename: String(file.filename).slice(0, 180), receivedAt: message.timestamp || null };
          if (budget-- <= 0) { attachments.push({ ...item, code: 'BILL_MAIL_PREVIEW_DEFERRED' }); continue; }
          try {
            if (file.size > maxBytes) throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
            const source = await getAttachment({ actor, messageId: message.message_id, attachmentId: file.attachment_id });
            item.preview = await parseBillFile(source);
          } catch (error) { item.code = /^BILL_/.test(error.code || '') ? error.code : 'BILL_MAIL_PARSE_FAILED'; }
          attachments.push(item);
        }
      }
      return { address: inboxId, attachments, messageCount: (page.messages || []).length, nextPageToken: page.next_page_token || null, checkedAt: new Date().toISOString() };
    },
  });
}
module.exports = { createBillMailbox };
