'use strict';

const assert = require('assert');
const {
  APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256,
  APPROVED_OBSOLETE_SCHEDULE_IDS,
  APPROVED_OBSOLETE_SCHEDULE_IDS_SHA256,
  isApprovedObsoleteScheduleSet,
} = require('./coreSchedulingLegacyExceptionManifest');
const { createHash } = require('crypto');

function sha256(value) { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

assert.strictEqual(APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256, '9d382041654d039a25f2c21921e75f74add4ee0629b1c07e37e787a7a9b533c5');
assert.strictEqual(APPROVED_OBSOLETE_SCHEDULE_IDS.length, 18);
assert.strictEqual(sha256([...APPROVED_OBSOLETE_SCHEDULE_IDS].sort()), APPROVED_OBSOLETE_SCHEDULE_IDS_SHA256);
assert.strictEqual(isApprovedObsoleteScheduleSet(APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256, APPROVED_OBSOLETE_SCHEDULE_IDS), true);
assert.strictEqual(isApprovedObsoleteScheduleSet(APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256, [...APPROVED_OBSOLETE_SCHEDULE_IDS, 'forged']), false);
assert.strictEqual(isApprovedObsoleteScheduleSet('f'.repeat(64), APPROVED_OBSOLETE_SCHEDULE_IDS), false);

console.log('vNext core scheduling legacy exception manifest checks passed');
