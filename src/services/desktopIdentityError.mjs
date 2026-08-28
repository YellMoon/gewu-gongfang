const ERROR_MESSAGES = Object.freeze({
  DESKTOP_IDENTITY_BRIDGE_REQUIRED: '\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u684c\u9762\u767b\u5f55\uff0c\u8bf7\u4ece\u683c\u7269\u5de5\u574a\u684c\u9762\u5e94\u7528\u6253\u5f00\u3002',
  DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH: '\u5fae\u4fe1\u6838\u9a8c\u8eab\u4efd\u4e0e\u8fd9\u53f0\u7535\u8111\u539f\u6709\u8eab\u4efd\u4e0d\u4e00\u81f4\uff0c\u4e0d\u80fd\u91cd\u8bbe\u5bc6\u7801\u3002',
  DESKTOP_PASSWORD_RESET_DEVICE_NOT_ACTIVE: '\u8fd9\u53f0\u7535\u8111\u7684\u539f\u6388\u6743\u5df2\u5931\u6548\uff0c\u4e0d\u80fd\u901a\u8fc7\u5bc6\u7801\u91cd\u8bbe\u6062\u590d\u3002',
  DESKTOP_IDENTITY_PASSWORD_RESET_UNAVAILABLE: '\u5f53\u524d\u684c\u9762\u7248\u672c\u4e0d\u652f\u6301\u5b89\u5168\u91cd\u8bbe\u672c\u673a\u5bc6\u7801\u3002',
  DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED: '\u672c\u673a\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002',
  DESKTOP_IDENTITY_LOCAL_PASSWORD_INVALID: '\u672c\u673a\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u91cd\u8bd5\u3002',
  DESKTOP_PHONE_REVERIFICATION_REQUIRED: '\u8be5\u8bbe\u5907\u9700\u8981\u91cd\u65b0\u901a\u8fc7\u5fae\u4fe1\u6838\u9a8c\u624b\u673a\u53f7\u3002',
  DESKTOP_DEVICE_NOT_ACTIVE: '\u8be5\u8bbe\u5907\u6388\u6743\u5df2\u88ab\u64a4\u9500\u6216\u505c\u7528\u3002',
  DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID: '\u672c\u673a\u8bbe\u5907\u7b7e\u540d\u9a8c\u8bc1\u5931\u8d25\u3002',
  ACTIVE_ROLE_NOT_GRANTED: '\u672c\u673a\u5bc6\u7801\u5df2\u901a\u8fc7\uff0c\u4f46\u8d26\u6237\u6743\u9650\u6570\u636e\u5c1a\u672a\u5b8c\u6210\u8fc1\u79fb\u3002\u8bf7\u66f4\u65b0\u540e\u91cd\u8bd5\u3002',
  DESKTOP_REGISTRATION_NOT_APPROVED: '\u8bbe\u5907\u5c1a\u672a\u83b7\u5f97\u5ba1\u6838\u901a\u8fc7\u3002',
  PAIRING_API_BASE_REQUIRED: '\u5c1a\u672a\u914d\u7f6e\u963f\u91cc\u4e91\u8eab\u4efd\u670d\u52a1\u5730\u5740\u3002',
  PRIMARY_HOST_RUNTIME_ROLE_REQUIRED: '\u6570\u636e\u4e3b\u673a\u521d\u59cb\u5316\u6d41\u7a0b\u672a\u5b8c\u6210\uff0c\u672a\u4fee\u6539\u672c\u673a\u6570\u636e\u3002\u8bf7\u66f4\u65b0\u5e94\u7528\u540e\u91cd\u8bd5\u3002',
  PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED: '\u8bf7\u5148\u5728\u6570\u636e\u4e3b\u673a\u4e0a\u8fde\u63a5\u5e76\u7ed1\u5b9a\u9898\u5e93\u79fb\u52a8\u786c\u76d8\uff0c\u518d\u5b8c\u6210\u8eab\u4efd\u521d\u59cb\u5316\u3002',
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
