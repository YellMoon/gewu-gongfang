function questionDeletePresentation(question = {}, context = {}) {
  if (question.storage_state === 'cloud_cached') {
    return { visible: true, enabled: true, reason: '' };
  }
  if (question.storage_state === 'host_committed') {
    const allowed = (context.capabilities || []).includes('question-bank:delete-committed');
    return { visible: allowed, enabled: allowed, reason: allowed ? '' : '\u5df2\u5165\u5e93\u8bd5\u9898\u53ea\u80fd\u7531\u4e91\u7aef\u6743\u9650\u5141\u8bb8\u7684\u684c\u9762\u7aef\u5220\u9664' };
  }
  const allowed = question.storage_state === 'local_draft'
    && question.sourceDeviceId === context.deviceId && question.ownerUserId === context.userId;
  return { visible: allowed, enabled: allowed, reason: allowed ? '' : '\u5df2\u5165\u5e93\u8bd5\u9898\u53ea\u80fd\u7531\u4e91\u7aef\u6743\u9650\u5141\u8bb8\u7684\u684c\u9762\u7aef\u5220\u9664' };
}
module.exports = { questionDeletePresentation };
