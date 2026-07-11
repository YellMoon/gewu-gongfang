const text = {
  bidirectional: '\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65',
  helper: '\u540c\u6b65\u524d\u5148\u9884\u89c8\u5e76\u786e\u8ba4\uff1b\u968f\u540e\u4e0a\u4f20\u672c\u673a\u66f4\u6539\uff0c\u518d\u83b7\u53d6\u5e76\u5408\u5e76\u4e3b\u673a\u6700\u65b0\u6570\u636e\u3002',
  hostPrimary: '\u5904\u7406\u5f85\u540c\u6b65\u8bf7\u6c42',
  hostSecondary: '\u67e5\u770b\u51b2\u7a81\u5ba1\u6838',
  offline: '\u4e3b\u673a\u79bb\u7ebf',
  current: '\u6570\u636e\u5df2\u662f\u6700\u65b0',
  pending: '\u6761\u672c\u673a\u66f4\u6539\u5f85\u540c\u6b65',
  hostReady: '\u6570\u636e\u4e3b\u673a\u6b63\u5e38\u8fd0\u884c',
};

export function getSyncPresentation(nodeRole, status = {}) {
  const isHost = nodeRole === 'primary-host';
  const pendingCount = Number(status.pendingCount || 0);
  const online = status.online !== false;
  if (isHost) {
    return {
      isHost: true,
      showClientSync: false,
      tone: status.conflictCount > 0 ? 'warning' : 'success',
      statusText: text.hostReady,
      primaryLabel: text.hostPrimary,
      secondaryLabel: text.hostSecondary,
      helperText: '',
    };
  }
  return {
    isHost: false,
    showClientSync: true,
    tone: !online || pendingCount > 0 ? 'warning' : 'success',
    statusText: !online ? `${text.offline}\uff0c${pendingCount} ${text.pending}` : pendingCount > 0 ? `${pendingCount} ${text.pending}` : text.current,
    primaryLabel: text.bidirectional,
    secondaryLabel: '',
    helperText: text.helper,
  };
}
