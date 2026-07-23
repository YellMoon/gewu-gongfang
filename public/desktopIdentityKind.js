function resolveConfiguredDesktopIdentityKind(input = {}) {
  const primaryHostCapable = input.primaryHostCapable === true;
  const singleUserHostEnrollment = input.singleUserHostEnrollment === true;
  if (primaryHostCapable
    && singleUserHostEnrollment
    && input.desktopIdentityMode === 'single-user') {
    return 'primary-host';
  }
  return primaryHostCapable && input.nodeRole === 'primary-host'
    ? 'primary-host'
    : 'desktop-client';
}

module.exports = { resolveConfiguredDesktopIdentityKind };
