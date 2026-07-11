function canRemoveQuestionLocalRecord(record = {}, context = {}) {
  return record.storage_state === 'local_draft'
    && Boolean(record.sourceDeviceId && record.ownerUserId)
    && record.sourceDeviceId === context.deviceId
    && record.ownerUserId === context.userId;
}
module.exports = { canRemoveQuestionLocalRecord };
