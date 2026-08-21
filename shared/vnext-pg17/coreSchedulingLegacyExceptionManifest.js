'use strict';

const { createHash } = require('crypto');

// This is a non-PII, read-only exception record for the legacy snapshot the
// user identified as deleted-course copy residue. It never authorizes a row
// write: matching rows are quarantined only.
const APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256 = '9d382041654d039a25f2c21921e75f74add4ee0629b1c07e37e787a7a9b533c5';
const APPROVED_OBSOLETE_SCHEDULE_IDS = Object.freeze([
  '1c573086-dd43-46a9-b6f9-191a5cd2c589',
  '1c573086-dd43-46a9-b6f9-191a5cd2c589_cpy_1781797658970_hn52',
  '1c573086-dd43-46a9-b6f9-191a5cd2c589_cpy_1781797658970_hn52_cpy_1781797683509_ay1m',
  '1cbef290-f471-4327-92c9-eaca40d91472',
  '1cbef290-f471-4327-92c9-eaca40d91472_cpy_1781797658970_6yz7',
  '1cbef290-f471-4327-92c9-eaca40d91472_cpy_1781797658970_6yz7_cpy_1781797683510_osy5',
  '3661393c-9750-409c-857b-ce348c125971',
  '3661393c-9750-409c-857b-ce348c125971_cpy_1781797658970_3jnb',
  '3661393c-9750-409c-857b-ce348c125971_cpy_1781797658970_3jnb_cpy_1781797683509_fb9b',
  '4497850a-cc18-4138-bcd4-4135778c5b70',
  '4497850a-cc18-4138-bcd4-4135778c5b70_cpy_1781797658970_koec',
  '4497850a-cc18-4138-bcd4-4135778c5b70_cpy_1781797658970_koec_cpy_1781797683509_r34d',
  '99b4ce6a-d898-483f-9c54-c16b78dee584',
  '99b4ce6a-d898-483f-9c54-c16b78dee584_cpy_1781797658970_baw9',
  '99b4ce6a-d898-483f-9c54-c16b78dee584_cpy_1781797658970_baw9_cpy_1781797683509_9ej6',
  'fdd90e91-3211-43e8-8bff-a47368ae9937',
  'fdd90e91-3211-43e8-8bff-a47368ae9937_cpy_1781797658970_yt6r',
  'fdd90e91-3211-43e8-8bff-a47368ae9937_cpy_1781797658970_yt6r_cpy_1781797683509_z7g0',
]);
const APPROVED_OBSOLETE_SCHEDULE_IDS_SHA256 = '16c7da88007bd0d2aa7f63253894464e4ce4b67cb1f82aae067b96c85f2ca71a';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isApprovedObsoleteScheduleSet(sourceInventorySha256, scheduleIds) {
  if (sourceInventorySha256 !== APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256
    || !Array.isArray(scheduleIds) || scheduleIds.length !== APPROVED_OBSOLETE_SCHEDULE_IDS.length
    || new Set(scheduleIds).size !== scheduleIds.length) return false;
  return sha256([...scheduleIds].sort()) === APPROVED_OBSOLETE_SCHEDULE_IDS_SHA256;
}

module.exports = Object.freeze({
  APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256,
  APPROVED_OBSOLETE_SCHEDULE_IDS,
  APPROVED_OBSOLETE_SCHEDULE_IDS_SHA256,
  isApprovedObsoleteScheduleSet,
});
