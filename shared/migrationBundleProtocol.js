'use strict';

const BUNDLE_SCHEMA_VERSION = 1;
const SOURCE_KINDS = Object.freeze(['sqlite', 'filesystem', 'desktop-export', 'cloud-control']);
const LEDGER_STATUSES = Object.freeze([
  'discovered',
  'migrated',
  'archived',
  'quarantined',
  'intentionally_excluded',
]);

const SOURCE_FIELDS = Object.freeze(new Set(['sourceId', 'kind', 'pathHash', 'label']));
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function protocolError(code) {
  return Object.assign(new Error(code), { code });
}

function requireText(value, code, pattern) {
  const text = String(value || '').trim();
  if (!text || (pattern && !pattern.test(text))) throw protocolError(code);
  return text;
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function normalizeSource(source = {}) {
  for (const field of Object.keys(source)) {
    if (!SOURCE_FIELDS.has(field)) throw protocolError('MIGRATION_SOURCE_FIELD_FORBIDDEN');
  }
  const sourceId = requireText(source.sourceId, 'MIGRATION_SOURCE_ID_INVALID', ID_PATTERN);
  const kind = requireText(source.kind, 'MIGRATION_SOURCE_KIND_INVALID');
  if (!SOURCE_KINDS.includes(kind)) throw protocolError('MIGRATION_SOURCE_KIND_INVALID');
  const pathHash = requireText(source.pathHash, 'MIGRATION_SOURCE_PATH_HASH_INVALID', HASH_PATTERN);
  const label = source.label === undefined
    ? sourceId
    : requireText(source.label, 'MIGRATION_SOURCE_LABEL_INVALID', ID_PATTERN);
  return { sourceId, kind, pathHash, label };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function validateManifest(input = {}) {
  if (Number(input.schemaVersion) !== BUNDLE_SCHEMA_VERSION) {
    throw protocolError('MIGRATION_BUNDLE_SCHEMA_UNSUPPORTED');
  }
  if (input.mode !== 'inventory-only') throw protocolError('MIGRATION_BUNDLE_MODE_INVALID');
  if (input.status !== 'complete') throw protocolError('MIGRATION_BUNDLE_STATUS_INVALID');
  const bundleId = requireText(input.bundleId, 'MIGRATION_BUNDLE_ID_INVALID', ID_PATTERN);
  const createdAt = requireText(input.createdAt, 'MIGRATION_BUNDLE_CREATED_AT_INVALID');
  if (!Number.isFinite(Date.parse(createdAt))) throw protocolError('MIGRATION_BUNDLE_CREATED_AT_INVALID');
  const sourceVersion = requireText(input.sourceVersion, 'MIGRATION_SOURCE_VERSION_INVALID');
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw protocolError('MIGRATION_SOURCES_REQUIRED');
  }
  const seen = new Set();
  const sources = input.sources.map(normalizeSource).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  for (const source of sources) {
    if (seen.has(source.sourceId)) throw protocolError('MIGRATION_SOURCE_ID_DUPLICATE');
    seen.add(source.sourceId);
  }
  return deepFreeze({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    mode: 'inventory-only',
    status: 'complete',
    bundleId,
    createdAt,
    sourceVersion,
    sources,
  });
}

function createInventoryManifest({ bundleId, createdAt, sourceVersion, sources } = {}) {
  return validateManifest({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    mode: 'inventory-only',
    status: 'complete',
    bundleId,
    createdAt,
    sourceVersion,
    sources,
  });
}

function validateLedgerEntry(input = {}) {
  const status = requireText(input.status, 'MIGRATION_LEDGER_STATUS_INVALID');
  if (!LEDGER_STATUSES.includes(status)) throw protocolError('MIGRATION_LEDGER_STATUS_INVALID');
  const sourceHash = nullableText(input.sourceHash);
  const targetHash = nullableText(input.targetHash);
  if (sourceHash && !HASH_PATTERN.test(sourceHash)) throw protocolError('MIGRATION_LEDGER_SOURCE_HASH_INVALID');
  if (targetHash && !HASH_PATTERN.test(targetHash)) throw protocolError('MIGRATION_LEDGER_TARGET_HASH_INVALID');
  return deepFreeze({
    sourceId: requireText(input.sourceId, 'MIGRATION_LEDGER_SOURCE_ID_INVALID', ID_PATTERN),
    sourceType: requireText(input.sourceType, 'MIGRATION_LEDGER_SOURCE_TYPE_INVALID'),
    sourceRecordId: nullableText(input.sourceRecordId),
    sourceHash,
    status,
    targetType: nullableText(input.targetType),
    targetRecordId: nullableText(input.targetRecordId),
    targetHash,
    conflictCode: nullableText(input.conflictCode),
  });
}

module.exports = {
  BUNDLE_SCHEMA_VERSION,
  LEDGER_STATUSES,
  SOURCE_KINDS,
  canonicalJson,
  createInventoryManifest,
  validateLedgerEntry,
  validateManifest,
};
