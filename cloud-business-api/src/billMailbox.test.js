'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBillMailbox } = require('./billMailbox');
test('mail inbox is owner bound, previews attachments and never sends mail', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/attachments/')) return { ok: true, json: async () => ({ filename: 'bill.csv', download_url: 'https://files.agentmail.to/test.csv' }) };
    if (url.startsWith('https://files.')) return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('bill') };
    return { ok: true, json: async () => ({ messages: [{ message_id: 'm1', attachments: [{ attachment_id: 'a1', filename: 'bill.csv', size: 4 }] }] }) };
  };
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'bill@agentmail.to', apiKey: 'private-key', fetch, parseBillFile: async ({ buffer }) => ({ records: [{ size: buffer.length }], errors: [] }) });
  await assert.rejects(mail.check({ actor: { accountId: 'other' } }), /BILL_MAIL_ACCESS_DENIED/);
  const result = await mail.check({ actor: { accountId: 'owner' } });
  assert.equal(result.attachments[0].preview.records[0].size, 4);
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.equal(calls.every(([, options]) => options.method === 'GET'), true);
  assert.equal(calls.at(-1)[1].headers?.Authorization, undefined);
});
test('missing attachment filename is recovered from owner inbox message metadata', async () => {
  const calls = [];
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'bill@agentmail.to', apiKey: 'private-key',
    fetch: async (url, options) => {
      calls.push([url, options]);
      if (url.includes('/attachments/')) return { ok: true, json: async () => ({ download_url: 'https://files.agentmail.to/blob' }) };
      if (url.includes('/messages/m1')) return { ok: true, json: async () => ({ attachments: [{ attachment_id: 'other', filename: 'wrong.csv' }, { attachment_id: 'a1', filename: 'bank.xlsx' }] }) };
      return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('xlsx fixture') };
    }, parseBillFile: async ({ filename }) => ({ filename }) });
  assert.deepEqual(await mail.previewAttachment({ actor: { accountId: 'owner' }, messageId: 'm1', attachmentId: 'a1' }), { filename: 'bank.xlsx' });
  assert.equal(calls.every(([, options]) => options.method === 'GET'), true);
  assert.equal(calls.at(-1)[1].headers?.Authorization, undefined);
});
test('unnamed attachment is rejected rather than relabeled CSV', async () => {
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'bill@agentmail.to', apiKey: 'key',
    fetch: async url => ({ ok: true, json: async () => url.includes('/attachments/') ? { download_url: 'https://files.agentmail.to/blob' } : { attachments: [] }, arrayBuffer: async () => Buffer.from('unknown') }), parseBillFile: async () => ({}) });
  await assert.rejects(mail.getAttachment({ actor: { accountId: 'owner' }, messageId: 'm1', attachmentId: 'a1' }), /BILL_MAIL_FILENAME_UNAVAILABLE/);
});
test('mail rejects attachment SSRF and oversized sources', async () => {
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'b@agentmail.to', apiKey: 'key', fetch: async url => ({ ok: true, json: async () => url.includes('/attachments/') ? { download_url: 'http://127.0.0.1/private' } : { messages: [{ message_id: 'm', attachments: [{ attachment_id: 'a', filename: 'b.csv', size: 10 }] }] } }), parseBillFile: async () => { throw Error('must not parse'); } });
  const result = await mail.check({ actor: { accountId: 'owner' } });
  assert.equal(result.attachments[0].code, 'BILL_MAIL_DOWNLOAD_URL_INVALID');
});
test('mail pagination preserves failed and deferred attachments without silent omission', async () => {
  const requests = [];
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'bill@agentmail.to', apiKey: 'key',
    fetch: async url => {
      requests.push(url);
      if (url.includes('/attachments/')) return { ok: true, json: async () => ({ filename: 'bank.csv', download_url: 'https://files.agentmail.to/' + url.split('/').at(-1) }) };
      if (url.startsWith('https://files.')) return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from(url.endsWith('/a1') ? 'unknown' : 'bill') };
      return { ok: true, json: async () => ({ messages: [{ message_id: 'm1', attachments: Array.from({ length: 7 }, (_, i) => ({ attachment_id: 'a' + (i + 1), filename: 'bank.csv' })) }], next_page_token: 'next/page' }) };
    }, parseBillFile: async ({ buffer }) => { if (buffer.toString() === 'unknown') throw Error('Unknown format'); return { records: [{}], errors: [] }; } });
  const result = await mail.check({ actor: { accountId: 'owner' }, pageToken: 'previous/page' });
  assert.match(requests[0], /page_token=previous%2Fpage$/);
  assert.equal(result.nextPageToken, 'next/page');
  assert.equal(result.attachments.length, 7);
  assert.equal(result.attachments[0].code, 'BILL_MAIL_PARSE_FAILED');
  assert.equal(result.attachments.filter(a => a.preview).length, 4);
  assert.equal(result.attachments.filter(a => a.code === 'BILL_MAIL_PREVIEW_DEFERRED').length, 2);
  assert.equal((await mail.previewAttachment({ actor: { accountId: 'owner' }, messageId: 'm1', attachmentId: 'a7' })).records.length, 1);
});
test('mail oversized stream is cancelled even without trustworthy length metadata', async () => {
  let cancelled = false, parseCalls = 0;
  const mail = createBillMailbox({ ownerAccountId: 'owner', inboxId: 'bill@agentmail.to', apiKey: 'key', maxBytes: 2,
    fetch: async url => url.includes('/attachments/') ? { ok: true, json: async () => ({ filename: 'bill.csv', download_url: 'https://files.agentmail.to/blob' }) } : {
      ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(3) }), cancel: async () => { cancelled = true; } }) },
    }, parseBillFile: async () => { parseCalls++; return {}; } });
  await assert.rejects(mail.previewAttachment({ actor: { accountId: 'owner' }, messageId: 'm1', attachmentId: 'a1' }), /BILL_MAIL_ATTACHMENT_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.equal(parseCalls, 0);
});
