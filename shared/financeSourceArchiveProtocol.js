'use strict';
const crypto = require('node:crypto');
const MAX_ENCRYPTED_BYTES = 24 * 1024 * 1024 + 32;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validReferenceId = id => typeof id === 'string' && /^[a-f0-9]{64}-[a-f0-9]{64}$/.test(id);
const objectIdFor = id => {
  if (!validReferenceId(id)) throw Object.assign(new Error('BILL_ARCHIVE_REFERENCE_INVALID'), {code:'BILL_ARCHIVE_REFERENCE_INVALID'});
  return 'obj_bill_' + sha256(id);
};
function validDescriptor(value) {
  return Boolean(value) && /^obj_bill_[a-f0-9]{64}$/.test(value.objectId || '') && value.version === 1
    && /^[a-f0-9]{64}$/.test(value.sha256 || '') && Number.isSafeInteger(value.bytes)
    && value.bytes > 32 && value.bytes <= MAX_ENCRYPTED_BYTES;
}
function validTask(value) {
  return Boolean(value) && /^bill_transfer_[a-f0-9]{32}$/.test(value.taskId || '')
    && ['store','read'].includes(value.operation) && validDescriptor(value.descriptor)
    && /^[A-Za-z0-9_-]{32,128}$/.test(value.leaseToken || '');
}
module.exports = {MAX_ENCRYPTED_BYTES,sha256,validReferenceId,objectIdFor,validDescriptor,validTask};
