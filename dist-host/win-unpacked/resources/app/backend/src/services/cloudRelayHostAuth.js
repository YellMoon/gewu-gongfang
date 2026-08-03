function resolveCloudRelayHostAuthOptions(input = {}) {
  const authorization = input.authorization || '';
  const hostCredential = input.hostCredential || '';
  const hostDeviceId = input.hostDeviceId || '';
  const hostGeneration = Number(input.hostGeneration);
  if (!hostCredential || !hostDeviceId || !Number.isSafeInteger(hostGeneration) || hostGeneration < 1) {
    const error = new Error('MANAGED_HOST_IDENTITY_INCOMPLETE');
    error.code = 'MANAGED_HOST_IDENTITY_INCOMPLETE';
    throw error;
  }
  return {
    authorization,
    hostCredential,
    hostDeviceId,
    hostGeneration,
  };
}

module.exports = {
  resolveCloudRelayHostAuthOptions,
};
