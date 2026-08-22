'use strict';

const assert = require('assert');
const readiness = require('./check_deploy_readiness');

assert.deepStrictEqual(
  readiness.checkDesktopReleaseBoundary().issues,
  [],
  'release readiness must accept exactly one unified desktop package and reject any restored host-only installer configuration'
);

console.log('deploy readiness unified desktop boundary checks passed');
