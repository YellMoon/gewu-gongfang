'use strict';
const assert = require('node:assert/strict');
const { downloadPaperDocument } = require('./questionPaperDownload');

function fixture(overrides = {}) {
  const calls = [];
  let active = true;
  const delivery = status => ({ success: true, data: { delivery: { deliveryId: 'delivery-1', status } } });
  const options = {
    token: 'isolated-session', taskId: 'task-1', format: 'word', isActive: () => active,
    request: async (...args) => { calls.push(['request', ...args]); return delivery('queued'); },
    read: async (...args) => { calls.push(['read', ...args]); return delivery('ready'); },
    download: async (...args) => { calls.push(['download', ...args]); return { success: true, data: { tempFilePath: 'wxfile://document', statusCode: 200 } }; },
    open: async value => { calls.push(['open', value]); },
    wait: async value => { calls.push(['wait', value]); }, now: () => 0,
    ...overrides,
  };
  return { options, calls, delivery, deactivate: () => { active = false; } };
}

(async () => {
  const queued = fixture();
  await downloadPaperDocument(queued.options);
  assert.deepEqual(queued.calls.map(row => row[0]), ['request', 'wait', 'read', 'download', 'open']);
  assert.deepEqual(queued.calls.at(-1)[1], { filePath: 'wxfile://document', fileType: 'docx', showMenu: true });
  assert(queued.calls.filter(row => ['read', 'download'].includes(row[0])).every(row => row[1] === 'isolated-session' && row[2] === 'delivery-1'));
  const ready = fixture({ format: 'pdf' });
  ready.options.request = async () => ready.delivery('ready');
  await downloadPaperDocument(ready.options);
  assert.equal(ready.calls[0][0], 'download');
  assert.equal(ready.calls.at(-1)[1].fileType, 'pdf');
  for (const stage of ['request', 'wait', 'read', 'download']) {
    const cancelled = fixture();
    const original = cancelled.options[stage];
    cancelled.options[stage] = async (...args) => { const result = await original(...args); cancelled.deactivate(); return result; };
    await assert.rejects(downloadPaperDocument(cancelled.options), { code: 'PAPER_DOWNLOAD_INACTIVE' });
    assert(!cancelled.calls.some(row => row[0] === 'open'), `account/page changed after ${stage}: never open`);
  }
  for (const status of ['failed', 'expired', 'cancelled', 'unknown']) {
    const bad = fixture();
    bad.options.request = async () => bad.delivery(status);
    await assert.rejects(downloadPaperDocument(bad.options), { code: 'PAPER_DOWNLOAD_PREPARATION_FAILED' });
    assert.equal(bad.calls.length, 0);
  }
  const mismatch = fixture();
  mismatch.options.read = async () => ({ success: true, data: { delivery: { deliveryId: 'other', status: 'ready' } } });
  await assert.rejects(downloadPaperDocument(mismatch.options), { code: 'PAPER_DOWNLOAD_PREPARATION_FAILED' });
  const slow = fixture();
  slow.options.read = async () => slow.delivery('leased');
  await assert.rejects(downloadPaperDocument(slow.options), { code: 'PAPER_DOWNLOAD_TIMEOUT' });
  assert.equal(slow.calls.filter(row => row[0] === 'wait').length, 12, 'bounded even if the clock stalls');
  const expired = fixture();
  let elapsed = 0;
  expired.options.now = () => elapsed;
  expired.options.wait = async () => { elapsed = 45001; };
  await assert.rejects(downloadPaperDocument(expired.options), { code: 'PAPER_DOWNLOAD_TIMEOUT' });
  assert(!expired.calls.some(row => row[0] === 'read'), 'do not start another request after timeout');
  const brokenFile = fixture({ download: async () => ({ success: true, data: { statusCode: 503, tempFilePath: 'wxfile://error' } }) });
  await assert.rejects(downloadPaperDocument(brokenFile.options), { code: 'PAPER_DOWNLOAD_FAILED' });
  assert(!brokenFile.calls.some(row => row[0] === 'open'));
  const unauthenticated = fixture({ token: '' });
  await assert.rejects(downloadPaperDocument(unauthenticated.options), { code: 'PAPER_DOWNLOAD_INACTIVE' });
  assert.equal(unauthenticated.calls.length, 0);
  console.log('paper download preparation, bounded polling and session isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
