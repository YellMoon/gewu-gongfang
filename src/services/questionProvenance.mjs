/**
 * Keep provenance fields under the trusted desktop session's control.
 * The adapter intentionally accepts structurally different question inputs
 * (full records, create payloads, and partial updates).
 *
 * @param {any} input
 * @param {any} trusted
 * @param {any} existing
 * @returns {any}
 */
export function applyTrustedQuestionProvenance(input = {}, trusted = {}, existing = null) {
  const {
    storage_state: _storageState,
    sourceDeviceId: _sourceDeviceId,
    ownerUserId: _ownerUserId,
    ...business
  } = input;

  return {
    ...business,
    storage_state: existing?.storage_state || 'local_draft',
    sourceDeviceId: existing?.sourceDeviceId || trusted.deviceId || '',
    ownerUserId: existing?.ownerUserId || trusted.userId || '',
  };
}
