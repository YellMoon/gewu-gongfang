'use strict';

const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'gewugongfang.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.deviceId !== 'desktop_host_001') throw new Error('unexpected host device id');
if (path.resolve(config.mainDbPath) !== path.resolve('D:\\GewuDataHost\\data\\scheduling.db')) {
  throw new Error('unexpected authoritative database path');
}
if (path.resolve(config.questionBankPath) !== path.resolve('I:\\GewuQuestionBank')) {
  throw new Error('unexpected question bank path');
}
const before = { ...config };
config.nodeRole = 'primary-host';
const temporary = `${configPath}.restore-primary-host.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
fs.renameSync(temporary, configPath);
const changedKeys = Object.keys(config).filter(key => JSON.stringify(config[key]) !== JSON.stringify(before[key]));
if (changedKeys.length !== 1 || changedKeys[0] !== 'nodeRole') throw new Error('unexpected configuration change');
console.log(JSON.stringify({ restored: true, changedKeys, nodeRole: config.nodeRole }));
