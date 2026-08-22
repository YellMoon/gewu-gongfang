'use strict';

const assert = require('assert');
const fs = require('fs');

const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
assert.ok(api.includes('DEFAULT_CLOUD_BUSINESS_BASE_URL'), 'miniapp must define an independent cloud-business API base');
assert.ok(api.includes('/api/miniapp/cloud-login'), 'miniapp must call the cloud account endpoint');
assert.ok(api.includes('miniappCloudAuthApi'), 'miniapp must expose a dedicated cloud auth facade');
assert.ok(api.includes('miniappCloudBusinessApi'), 'miniapp must expose a dedicated cloud business facade');
assert.ok(api.includes('/api/business/schedules'), 'cloud business facade must include the cloud schedule read endpoint');
console.log('miniapp cloud auth API source checks passed');
