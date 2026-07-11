function canDeleteQuestion(context = {}) {
  if (!context.userApproved || context.role === 'pending') return false;
  if (context.storageState === 'local_draft') {
    return Boolean(context.deviceId && context.userId
      && context.deviceId === context.sourceDeviceId
      && context.userId === context.ownerUserId);
  }
  if (context.storageState !== 'host_committed' || context.gateway) return false;
  if (!['teacher', 'admin', 'super_admin'].includes(context.role)) return false;
  return context.runtimeNodeRole === 'primary-host'
    && context.tokenUse === 'desktop-session'
    && Boolean(context.deviceId)
    && context.deviceId === context.tokenDeviceId
    && context.deviceTrusted === true
    && context.deviceActive === true
    && context.deviceOwnerUserId === context.userId;
}

function committedDeleteError() {
  const error = new Error('已入库试题只能在本地数据主机桌面端删除');
  error.code = 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE';
  error.status = 403;
  return error;
}

module.exports = { canDeleteQuestion, committedDeleteError };
