'use strict';

const { verifyFixedSuperAdminFromEnvironment } = require('./verifyFixedSuperAdmin');
const { markFixedSuperAdminVerified } = require('../src/startupVerificationState');

async function start({ verify, markVerified, loadServer }) {
  if (typeof verify !== 'function' || typeof markVerified !== 'function' || typeof loadServer !== 'function') throw new TypeError('verified startup configuration is invalid');
  await verify();
  markVerified();
  loadServer();
}

if (require.main === module) {
  start({
    verify: () => verifyFixedSuperAdminFromEnvironment(),
    markVerified: markFixedSuperAdminVerified,
    loadServer: () => require('../server'),
  }).catch(error => {
    console.error(error?.code || 'CLOUD_VERIFIED_STARTUP_FAILED');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ start });
