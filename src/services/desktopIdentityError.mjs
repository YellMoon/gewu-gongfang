const ERROR_MESSAGES = Object.freeze({
  DESKTOP_IDENTITY_BRIDGE_REQUIRED: '\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u684c\u9762\u767b\u5f55\uff0c\u8bf7\u4ece\u683c\u7269\u5de5\u574a\u684c\u9762\u5e94\u7528\u6253\u5f00\u3002',
  DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH: '\u6682\u65f6\u65e0\u6cd5\u91cd\u8bbe\u5bc6\u7801\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u8bd5\u3002',
  DESKTOP_PASSWORD_RESET_DEVICE_NOT_ACTIVE: '\u6682\u65f6\u65e0\u6cd5\u91cd\u8bbe\u5bc6\u7801\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u8bd5\u3002',
  DESKTOP_IDENTITY_PASSWORD_RESET_UNAVAILABLE: '\u6682\u65f6\u65e0\u6cd5\u91cd\u8bbe\u5bc6\u7801\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u8bd5\u3002',
  DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED: '\u8d26\u53f7\u6216\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002',
  DESKTOP_IDENTITY_LOCAL_PASSWORD_INVALID: '\u8d26\u53f7\u6216\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002',
  DESKTOP_PHONE_REVERIFICATION_REQUIRED: '\u8be5\u8bbe\u5907\u9700\u8981\u91cd\u65b0\u901a\u8fc7\u5fae\u4fe1\u6838\u9a8c\u624b\u673a\u53f7\u3002',
  DESKTOP_DEVICE_NOT_ACTIVE: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
  DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
  PAIRING_API_BASE_REQUIRED: '\u5c1a\u672a\u914d\u7f6e\u963f\u91cc\u4e91\u8eab\u4efd\u670d\u52a1\u5730\u5740\u3002',
});

export function extractDesktopIdentityErrorCode(error) {
  const chain = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    chain.push(`${String(current?.code || '')} ${String(current?.message || current || '')}`);
    current = current?.cause;
  }
  const raw = chain.join(' ');
  return Object.keys(ERROR_MESSAGES).find(code => raw.includes(code)) || 'DESKTOP_IDENTITY_FAILED';
}

export function desktopIdentityErrorMessage(error) {
  return ERROR_MESSAGES[extractDesktopIdentityErrorCode(error)]
    || '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u683c\u7269\u5de5\u574a\u3002';
}
