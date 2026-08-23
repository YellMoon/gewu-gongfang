'use strict';

const assert = require('assert');
const experience = require('./accountExperience');

const identity = {
  account_state: 'unrecognized',
  token_use: 'unrecognized-student',
  capabilities: [...experience.UNRECOGNIZED_CAPABILITIES],
};
assert.strictEqual(experience.isUnrecognizedIdentity(identity), true);
assert.deepStrictEqual(experience.accountCapabilities(identity), experience.UNRECOGNIZED_CAPABILITIES);
assert.strictEqual(experience.accountExperiencePath(identity, 'questions'), '/api/experience/questions');
assert.strictEqual(experience.accountExperiencePath(identity, 'createTask'), '/api/experience/tasks');
assert.throws(() => experience.accountExperiencePath(identity, 'artifact', 'artifact-1'));
assert.ok(!experience.UNRECOGNIZED_CAPABILITIES.includes('sample-paper-export'));
console.log('account experience read-only checks passed');
