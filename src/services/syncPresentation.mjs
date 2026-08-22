const text = {
  submit: '\u4e0e\u4e91\u7aef\u540c\u6b65',
  helper: '\u540c\u6b65\u524d\u5148\u9884\u89c8\u5e76\u786e\u8ba4\uff1b\u968f\u540e\u63d0\u4ea4\u672c\u673a\u8349\u7a3f\uff0c\u518d\u83b7\u53d6\u5e76\u5408\u5e76\u4e91\u7aef\u6700\u65b0\u6570\u636e\u3002',
  offline: '\u4e91\u7aef\u79bb\u7ebf',
  current: '\u6570\u636e\u5df2\u662f\u6700\u65b0',
  pending: '\u6761\u672c\u673a\u66f4\u6539\u5f85\u540c\u6b65',
};

export function getSyncPresentation(status = {}) {
  const pendingCount = Number(status.pendingCount || 0);
  const online = status.online !== false;
  return {
    showDraftSubmission: true,
    tone: !online || pendingCount > 0 ? 'warning' : 'success',
    statusText: !online ? `${text.offline}\uff0c${pendingCount} ${text.pending}` : pendingCount > 0 ? `${pendingCount} ${text.pending}` : text.current,
    primaryLabel: text.submit,
    helperText: text.helper,
  };
}
