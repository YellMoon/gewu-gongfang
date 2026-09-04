'use strict';

let fixedSuperAdminVerified = false;

function markFixedSuperAdminVerified() {
  fixedSuperAdminVerified = true;
}

function assertFixedSuperAdminVerified() {
  if (!fixedSuperAdminVerified) {
    throw Object.assign(new Error('cloud startup fixed super administrator verification is required'), {
      code: 'CLOUD_FIXED_SUPER_ADMIN_STARTUP_REQUIRED',
    });
  }
}

module.exports = Object.freeze({ markFixedSuperAdminVerified, assertFixedSuperAdminVerified });
