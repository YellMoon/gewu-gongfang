'use strict';

const fs = require('fs');
const path = require('path');

function failure() {
  return Object.assign(new Error('STORAGE_AGENT_LAUNCH_CONFIG_INVALID'), { code: 'STORAGE_AGENT_LAUNCH_CONFIG_INVALID' });
}

function loadEnvironmentFile(configPath) {
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath) || !fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) throw failure();
  const source = fs.readFileSync(configPath, 'utf8');
  if (source.length < 1 || source.length > 65536 || source.includes('\0')) throw failure();
  const result = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw failure();
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || !value || Object.prototype.hasOwnProperty.call(result, key)) throw failure();
    result[key] = value;
  }
  if (!Object.keys(result).length) throw failure();
  return Object.freeze(result);
}

module.exports = { loadEnvironmentFile };
