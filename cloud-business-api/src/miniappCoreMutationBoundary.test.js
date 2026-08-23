'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const mutationStart = source.indexOf("app.put('/api/business/schedules/:scheduleId'");
const mutationEnd = source.indexOf("app.post('/api/storage-agent/lease'");
assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, 'core mutation route boundaries must exist');
const mutationRoutes = source.slice(mutationStart, mutationEnd);

assert.ok(!mutationRoutes.includes('!desktopRegistration && !miniappCloudAccount'), 'miniapp identity must never make a core teaching mutation route available');
assert.ok(!mutationRoutes.includes('await businessContext(request)'), 'core teaching mutation routes must not accept a miniapp context');
assert.strictEqual((mutationRoutes.match(/await desktopBusinessContext\(request\)/g) || []).length, 16, 'every core teaching mutation must use desktop-only identity');

console.log('miniapp core mutation boundary checks passed');
