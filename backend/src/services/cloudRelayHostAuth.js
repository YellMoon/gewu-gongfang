function hasConfiguredGeneration(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function resolveCloudRelayHostAuthOptions(input = {}) {
  const authorization = input.authorization || '';
  const hostCredential = input.hostCredential || '';
  const hostGeneration = input.hostGeneration;
  const identityMode = input.identityMode || 'full';
  const useManagedIdentity = Boolean(hostCredential)
    || (hasConfiguredGeneration(hostGeneration) && identityMode !== 'single-user');

  if (useManagedIdentity) {
    return {
      authorization,
      hostCredential,
      hostDeviceId: input.hostDeviceId || '',
      hostGeneration: Number(hostGeneration),
    };
  }

  return {
    authorization,
    hostToken: input.hostToken || '',
  };
}

module.exports = {
  resolveCloudRelayHostAuthOptions,
};
