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
  const declaredFlavor = normalizeFlavor(metadata.desktopBuildFlavor);
  // A primary-host artifact is capability-bearing. Its package metadata is
  // authoritative even when an unpacked Electron runner reports isPackaged=false.
  if (declaredFlavor === PRIMARY_HOST_FLAVOR) return declaredFlavor;
  if (isPackaged) return declaredFlavor;
  return normalizeFlavor(env.GEWU_DESKTOP_BUILD_FLAVOR || metadata.desktopBuildFlavor);
}

function desktopBuildFlavorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateDesktopCapabilityManifest({ metadata = {}, runtimeFlavor } = {}) {
  const declaredFlavor = normalizeFlavor(metadata.desktopBuildFlavor);
  const manifest = metadata.desktopCapabilityManifest;
  if (declaredFlavor !== PRIMARY_HOST_FLAVOR) {
    if (manifest?.flavor === PRIMARY_HOST_FLAVOR) throw desktopBuildFlavorError('PRIMARY_HOST_CAPABILITY_MISMATCH');
    return true;
  }
  if (!manifest || manifest.flavor !== PRIMARY_HOST_FLAVOR || Number(manifest.revision) < 1) {
    throw desktopBuildFlavorError('PRIMARY_HOST_CAPABILITY_MANIFEST_REQUIRED');
  }
  if (normalizeFlavor(runtimeFlavor) !== PRIMARY_HOST_FLAVOR) {
    throw desktopBuildFlavorError('PRIMARY_HOST_CAPABILITY_MISMATCH');
  }
  return true;
}

function updateFeedForFlavor(flavor, env = process.env) {
  const override = String(env.UPDATE_FEED_URL || '').trim();
  return (override || UPDATE_FEEDS[normalizeFlavor(flavor)]).replace(/\/?$/, '/');
}

module.exports = {
  DESKTOP_CLIENT_FLAVOR,
  PRIMARY_HOST_FLAVOR,
  desktopBuildFlavorError,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
  validateDesktopCapabilityManifest,
};
