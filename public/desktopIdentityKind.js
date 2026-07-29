function resolveConfiguredDesktopIdentityKind(input = {}) {
  return input.nodeRole === 'primary-host' ? 'primary-host' : 'desktop-client';
}

module.exports = { resolveConfiguredDesktopIdentityKind };
