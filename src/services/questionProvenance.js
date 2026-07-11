function applyTrustedQuestionProvenance(input = {}, trusted = {}, existing = null) {
  const { storage_state: _storageState, sourceDeviceId: _sourceDeviceId, ownerUserId: _ownerUserId, ...business } = input;
  return { ...business, storage_state: existing?.storage_state || 'local_draft', sourceDeviceId: existing?.sourceDeviceId || trusted.deviceId || '', ownerUserId: existing?.ownerUserId || trusted.userId || '' };
}
module.exports = { applyTrustedQuestionProvenance };
