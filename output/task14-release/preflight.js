const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..', '..');
const env = { ...process.env };
for (const name of ['.env.local', '.env']) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) Object.assign(env, dotenv.parse(fs.readFileSync(file)));
}
const credentialNames = [
  'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH',
  'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET',
  'ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET',
];
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniapp', 'project.config.json'), 'utf8'));
const keyPath = env.WECHAT_MINIAPP_PRIVATE_KEY_PATH
  || env.MINIAPP_PRIVATE_KEY_PATH
  || env.WX_PRIVATE_KEY_PATH
  || path.join(os.homedir(), '.ssh', `private.${projectConfig.appid}.key`);

console.log(JSON.stringify({
  credentialsPresent: Object.fromEntries(credentialNames.map(name => [name, Boolean(env[name])])),
  miniappAppidPresent: Boolean(projectConfig.appid),
  miniappPrivateKeyPresent: fs.existsSync(keyPath),
  wechatCliPresent: fs.existsSync('C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'),
  questionBankDrivePresent: fs.existsSync('I:/'),
}, null, 2));
