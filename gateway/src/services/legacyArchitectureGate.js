function hasAuthorityCutoverMarker(db) {
  try {
    return Boolean(db.prepare("SELECT 1 AS ok FROM authority_migration_ledger WHERE name='authority_protocol_v1_cutover'").get());
  } catch (_error) {
    return false;
  }
}

function createLegacyArchitectureGate({ db, hardRetire = false } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('LEGACY_ARCHITECTURE_GATE_DATABASE_REQUIRED');
  return (req, res, next) => {
    if (hardRetire || hasAuthorityCutoverMarker(db)) {
      return res.status(410).json({ success: false, error: { code: 'LEGACY_ARCHITECTURE_RETIRED' } });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) {
      return res.status(409).json({ success: false, error: { code: 'AUTHORITY_PROTOCOL_MIGRATION_REQUIRED' } });
    }
    return next();
  };
}

module.exports = { createLegacyArchitectureGate, hasAuthorityCutoverMarker };
