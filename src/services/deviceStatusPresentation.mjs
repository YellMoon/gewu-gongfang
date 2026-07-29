const DEFAULT_STATUS = Object.freeze({ label: '\u5f85\u5904\u7406', color: 'default' });

const STATUS_PRESENTATION = Object.freeze({
  active: Object.freeze({ label: '\u53ef\u4fe1', color: 'green' }),
  revoked: Object.freeze({ label: '\u5df2\u64a4\u9500', color: 'default' }),
  replaced: Object.freeze({ label: '\u5df2\u88ab\u66ff\u6362', color: 'gold' }),
  retired: Object.freeze({ label: '\u5df2\u9000\u5f79', color: 'default' }),
  pending: DEFAULT_STATUS,
});

export function deviceStatusPresentation({ status, approvedAt } = {}) {
  if (status === 'pending' && approvedAt) {
    return Object.freeze({ label: '\u5df2\u6279\u51c6\uff0c\u7b49\u5f85\u65b0\u8bbe\u5907\u5b8c\u6210\u8bbe\u7f6e', color: 'blue' });
  }
  return STATUS_PRESENTATION[status] || Object.freeze({ label: String(status || '\u672a\u77e5'), color: 'default' });
}
