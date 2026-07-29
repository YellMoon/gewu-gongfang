'use strict';

// Copies the locally configured cloud test token only into a disposable
// packaged-Electron profile. It never prints the token or its source path.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function isDisposableProfile(root) {
  return /^tmp-real-desktop-(host-ui|client)-/.test(path.basename(root));
}

function main() {
  const target = path.resolve(process.argv[2] || '');
  assert(path.basename(target) === 'gewugongfang.config.json', 'TEST_CONFIG_PATH_REQUIRED');
  assert(fs.existsSync(target), 'TEST_CONFIG_NOT_FOUND');
  assert(isDisposableProfile(path.dirname(target)), 'DISPOSABLE_TEST_PROFILE_REQUIRED');

  const source = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'gewugongfang.config.json');
  const sourceConfig = JSON.parse(fs.readFileSync(source, 'utf8'));
  const token = String(sourceConfig.desktopSyncToken || '').trim();
  assert(token, 'CLOUD_TEST_TOKEN_NOT_CONFIGURED');

  const config = JSON.parse(fs.readFileSync(target, 'utf8'));
  config.desktopSyncToken = token;
  fs.writeFileSync(target, JSON.stringify(config, null, 2), 'utf8');
  console.log(JSON.stringify({ updated: true, disposable: true, tokenRecorded: false }));
}

main();
