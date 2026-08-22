function questionDeletePresentation(question = {}, context = {}) {
  if (question.storage_state === 'cloud_cached') {
    return { visible: true, enabled: true, reason: '' };
  }
  if (question.storage_state === 'host_committed') {
    const allowed = (context.capabilities || []).includes('question-bank:delete-committed');
    return { visible: allowed, enabled: allowed, reason: allowed ? '' : '已入库试题只能在本地数据主机桌面端删除' };
  }
  const allowed = question.storage_state === 'local_draft'
    && question.sourceDeviceId === context.deviceId && question.ownerUserId === context.userId;
  return { visible: allowed, enabled: allowed, reason: allowed ? '' : '只能删除当前设备上由本人创建的本地草稿' };
}
module.exports = { questionDeletePresentation };
