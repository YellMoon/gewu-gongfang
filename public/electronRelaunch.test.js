'use strict';

const assert = require('assert');
const { buildRelaunchArguments } = require('./electronRelaunch');

assert.deepStrictEqual(
  buildRelaunchArguments(['C:\\Program Files\\Gewu\\Gewu.exe', '--user-data-dir=C:\\Temp\\test', '--remote-debugging-port=45210']),
  ['--user-data-dir=C:\\Temp\\test', '--remote-debugging-port=45210'],
  'an explicitly requested CDP port must survive app.relaunch for isolated UI tests'
);
assert.deepStrictEqual(
  buildRelaunchArguments(['C:\\Program Files\\Gewu\\Gewu.exe', '--user-data-dir=C:\\Users\\user\\AppData']),
  ['--user-data-dir=C:\\Users\\user\\AppData'],
  'ordinary production launch must not gain a CDP argument'
);
console.log('electron relaunch argument tests passed');
