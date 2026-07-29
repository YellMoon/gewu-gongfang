'use strict';

const assert = require('assert');
const fs = require('fs');

const electronSource = fs.readFileSync('public/electron.js', 'utf8');
const preloadSource = fs.readFileSync('public/preload.js', 'utf8');
const hostConfig = fs.readFileSync('electron-builder.host.config.cjs', 'utf8');

assert.ok(electronSource.includes("require('./primaryHostRuntimeStatus')"));
assert.ok(electronSource.includes("require('./primaryHostListenPolicy')"));
assert.ok(electronSource.includes('Primary host listener scope:'),
  'the packaged host must record the resolved listener scope without logging credentials');
assert.ok(electronSource.includes("require('./primaryHostRelaunchReadiness')"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:runtime-status'"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:relaunch-readiness'"));
assert.ok(electronSource.includes('getPrimaryHostRelaunchReadiness().beginLaunch()'));
assert.ok(electronSource.includes('getPrimaryHostRelaunchReadiness().requestRelaunch()'));
assert.ok(preloadSource.includes("runtimeStatus: () => ipcRenderer.invoke('primary-host:runtime-status')"));
assert.ok(preloadSource.includes("relaunchReadiness: () => ipcRenderer.invoke('primary-host:relaunch-readiness')"));
assert.ok(hostConfig.includes("'public/primaryHostRuntimeStatus.js'"));
assert.ok(hostConfig.includes("'public/primaryHostRelaunchReadiness.js'"));
assert.ok(!electronSource.includes('remote-debugging-port='), 'production relaunch must never add a debug port');
console.log('electron runtime contract integration checks passed');
