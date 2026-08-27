'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function text(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('CLOUD_PAPER_EXPORT_MEDIA_INVALID');
  return value;
}

function createPaperExportMediaResolver({ questionAssetDeliveries } = {}) {
  if (!questionAssetDeliveries || typeof questionAssetDeliveries.requestForPaperExport !== 'function' || typeof questionAssetDeliveries.download !== 'function') {
    throw failure('CLOUD_PAPER_EXPORT_MEDIA_CONFIG_INVALID');
  }
  return async input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('CLOUD_PAPER_EXPORT_MEDIA_INVALID');
    const tenantId = text(input.tenantId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const accountId = text(input.accountId, /^.{1,512}$/);
    const taskId = text(input.taskId, /^paper_task_[A-Za-z0-9_-]{1,128}$/);
    const questionId = text(input.questionId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const assetKey = text(input.assetKey, /^[0-9a-f]{64}$/);
    const fileName = text(input.fileName, /^.{1,512}$/);
    const mimeType = text(input.mimeType, /^image\/(?:png|jpe?g)$/i).toLowerCase();
    const delivery = await questionAssetDeliveries.requestForPaperExport({ tenantId, accountId, taskId, questionId, assetKey });
    if (!delivery || typeof delivery !== 'object' || typeof delivery.deliveryId !== 'string') throw failure('CLOUD_PAPER_EXPORT_MEDIA_UNAVAILABLE');
    if (delivery.status !== 'ready') throw failure('CLOUD_PAPER_EXPORT_MEDIA_PENDING');
    const downloaded = await questionAssetDeliveries.download({ tenantId, accountId, deliveryId: delivery.deliveryId });
    if (!downloaded || typeof downloaded !== 'object' || downloaded.fileName !== fileName || String(downloaded.mimeType || '').toLowerCase() !== mimeType
      || !Buffer.isBuffer(downloaded.bytes) || downloaded.bytes.length < 1 || downloaded.bytes.length > (64 * 1024 * 1024)) {
      throw failure('CLOUD_PAPER_EXPORT_MEDIA_INVALID');
    }
    return Buffer.from(downloaded.bytes);
  };
}

module.exports = Object.freeze({ createPaperExportMediaResolver });
