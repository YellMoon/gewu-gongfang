'use strict';

function failure(code) { return Object.assign(new Error(code), { code }); }

async function downloadPaperDocument({ token, taskId, format, isActive, request, read, download, open,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), now = Date.now }) {
  const active = () => {
    if (!token || !taskId || !isActive()) throw failure('PAPER_DOWNLOAD_INACTIVE');
  };
  active();
  if (!['word', 'pdf'].includes(format)) throw failure('PAPER_DOWNLOAD_FAILED');
  const start = now();
  const withinDeadline = () => {
    if (now() - start >= 45000) throw failure('PAPER_DOWNLOAD_TIMEOUT');
  };
  const deliveryFrom = (response, expectedId) => {
    const delivery = response?.data?.delivery;
    if (!response?.success || typeof delivery?.deliveryId !== 'string' || !delivery.deliveryId
      || (expectedId && delivery.deliveryId !== expectedId) || !['queued', 'leased', 'ready'].includes(delivery.status)) {
      throw failure('PAPER_DOWNLOAD_PREPARATION_FAILED');
    }
    return delivery;
  };
  const prepared = await request(token, taskId);
  active();
  let delivery = deliveryFrom(prepared);
  for (let attempt = 0; delivery.status !== 'ready'; attempt += 1) {
    if (attempt >= 12) throw failure('PAPER_DOWNLOAD_TIMEOUT');
    withinDeadline();
    await wait(Math.min((attempt + 1) * 1000, 5000));
    active();
    withinDeadline();
    const response = await read(token, delivery.deliveryId);
    active();
    withinDeadline();
    delivery = deliveryFrom(response, delivery.deliveryId);
  }
  active();
  const file = await download(token, delivery.deliveryId);
  active();
  if (!file?.success || file.data?.statusCode !== 200 || typeof file.data?.tempFilePath !== 'string' || !file.data.tempFilePath) {
    throw failure('PAPER_DOWNLOAD_FAILED');
  }
  // The relay URL has no filename extension; tell WeChat the real document type.
  await open({ filePath: file.data.tempFilePath, fileType: format === 'pdf' ? 'pdf' : 'docx', showMenu: true });
}

module.exports = { downloadPaperDocument };
