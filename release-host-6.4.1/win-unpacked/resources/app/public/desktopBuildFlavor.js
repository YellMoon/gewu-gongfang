'use strict';

const DESKTOP_CLIENT_FLAVOR = 'desktop-client';
const PRIMARY_HOST_FLAVOR = 'primary-host';
const UPDATE_FEEDS = Object.freeze({
  [DESKTOP_CLIENT_FLAVOR]: 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/',
  [PRIMARY_HOST_FLAVOR]: 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/host/',
});

function normalizeFlavor(value) {
  return value === PRIMARY_HOST_FLAVOR ? PRIMARY_HOST_FLAVOR : DESKTOP_CLIENT_FLAVOR;
}

function resolveDesktopBuildFlavor({ isPackaged = true, metadata = {}, env = process.env } = {}) {
  if (isPackaged) return normalizeFlavor(metadata.desktopBuildFlavor);
  return normalizeFlavor(env.GEWU_DESKTOP_BUILD_FLAVOR || metadata.desktopBuildFlavor);
}

function updateFeedForFlavor(flavor, env = process.env) {
  const override = String(env.UPDATE_FEED_URL || '').trim();
  return (override || UPDATE_FEEDS[normalizeFlavor(flavor)]).replace(/\/?$/, '/');
}

module.exports = {
  DESKTOP_CLIENT_FLAVOR,
  PRIMARY_HOST_FLAVOR,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
};
