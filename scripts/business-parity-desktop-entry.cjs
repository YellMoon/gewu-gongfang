'use strict';
// Test harness only: production runtime configuration remains immutable.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.GEWU_PARITY_SHADOW_URL;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:[0-9]+$/);
assert.match(process.env.GEWU_DATA_DIR || '', /gewu-business-parity-[^\\/]+[\\/]profile$/);
const {app} = require('electron');
app.setAppPath(root);
const config = require('../public/runtimeConfig');
const ensure = config.ensureRuntimeConfig;
config.ensureRuntimeConfig = (file, options) => ensure(file, {...options,
  managedCloudBaseUrl:base + '/legacy-disabled', managedCloudBusinessBaseUrl:base});
require('../public/electron');
