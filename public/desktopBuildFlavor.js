'use strict';

const UNIFIED_DESKTOP_FLAVOR = 'unified-desktop';
const UPDATE_FEED = 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/';

function resolveDesktopBuildFlavor() {
  return UNIFIED_DESKTOP_FLAVOR;
}

function validateDesktopCapabilityManifest() {
  return true;
}

function updateFeedForFlavor(_flavor, env = process.env) {
  const override = String(env.UPDATE_FEED_URL || '').trim();
  return (override || UPDATE_FEED).replace(/\/?$/, '/');
}

module.exports = {
  UNIFIED_DESKTOP_FLAVOR,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
  validateDesktopCapabilityManifest,
};
