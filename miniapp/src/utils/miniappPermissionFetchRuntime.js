const {
  permissionIdentityKey,
  sanitizeCapabilitiesForIdentity,
} = require('./miniappAuthorizationRuntime');

function emptyPermissionData(user) {
  return { permissions: [], capabilities: [], user_type: user?.user_type || 'pending' };
}

function permissionData(user, capabilities) {
  return {
    permissions: capabilities.map(capability => ({
      id: capability,
      module_id: capability.split(':')[0],
      action: capability.split(':')[1],
      description: capability,
      status: 1,
    })),
    capabilities,
    user_type: user?.user_type || 'pending',
  };
}

function createPermissionFetchBoundary(dependencies) {
  async function fetchPermissions() {
    const localUser = dependencies.getCurrentUser();
    const localIdentityKey = permissionIdentityKey(localUser);
    dependencies.setMemoryCache(null);
    dependencies.setPermissionState({ status: 'idle', identityKey: localIdentityKey, capabilities: [] });
    const result = await dependencies.refreshAuthorization(localUser);
    if (result.status === 'stale') {
      return dependencies.getMemoryCache() || emptyPermissionData(dependencies.getCurrentUser());
    }
    const refreshedUser = dependencies.getCurrentUser();
    const identityKey = permissionIdentityKey(refreshedUser);
    if (result.status !== 'loaded') {
      dependencies.setPermissionState({ status: 'error', identityKey, capabilities: [] });
      return emptyPermissionData(refreshedUser);
    }
    const capabilities = sanitizeCapabilitiesForIdentity(refreshedUser, result.capabilities);
    const data = permissionData(refreshedUser, capabilities);
    dependencies.setMemoryCache(data);
    dependencies.setPermissionState({ status: 'loaded', identityKey, capabilities });
    return data;
  }

  return { fetchPermissions };
}

module.exports = { createPermissionFetchBoundary };
