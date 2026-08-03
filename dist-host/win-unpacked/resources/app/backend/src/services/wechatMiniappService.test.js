'use strict';

const assert = require('assert');

const ENV_KEYS = [
  'NODE_ENV',
  'APP_ENV',
  'ALLOW_DEV_WECHAT_LOGIN',
  'WECHAT_APPID',
  'WECHAT_APPSECRET',
  'WECHAT_DEV_OPENID',
];

async function main() {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'dev';
    process.env.ALLOW_DEV_WECHAT_LOGIN = 'true';
    delete process.env.WECHAT_APPID;
    delete process.env.WECHAT_APPSECRET;
    process.env.WECHAT_DEV_OPENID = 'isolated-stable-wechat-user';

    const { resolveWechatIdentity } = require('./wechatMiniappService');
    const first = await resolveWechatIdentity('single-use-code-a');
    const second = await resolveWechatIdentity('single-use-code-b');

    assert.strictEqual(first.openid, 'isolated-stable-wechat-user');
    assert.strictEqual(second.openid, first.openid,
      'an isolated WeChat user must keep the same openid across one-time login codes');
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

main().then(() => {
  console.log('wechat miniapp identity checks passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
