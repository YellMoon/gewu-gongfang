const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const packageJson = require('../package.json');
const baseUrl = process.env.OSS_CDN_BASE_URL || 'https://gewugongfang.oss-cn-hangzhou.aliyuncs.com/desktop';

const installer = fs.readdirSync(distDir)
  .filter(name => name.endsWith('.exe') && name.includes(packageJson.version))
  .sort()
  .pop();

if (!installer) {
  throw new Error(`未找到版本 ${packageJson.version} 的 Windows 安装包`);
}

const latest = [
  `version: ${packageJson.version}`,
  `files:`,
  `  - url: ${encodeURI(installer)}`,
  `    sha512: ${process.env.INSTALLER_SHA512 || 'UPLOAD_AND_REPLACE_SHA512'}`,
  `    size: ${fs.statSync(path.join(distDir, installer)).size}`,
  `path: ${encodeURI(installer)}`,
  `sha512: ${process.env.INSTALLER_SHA512 || 'UPLOAD_AND_REPLACE_SHA512'}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ``,
].join('\n');

fs.writeFileSync(path.join(distDir, 'latest.yml'), latest, 'utf8');
console.log(`已生成更新 feed: ${baseUrl}/latest.yml`);
