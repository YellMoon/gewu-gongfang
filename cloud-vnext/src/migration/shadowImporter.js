'use strict';

const crypto = require('crypto');
const path = require('path');
const { canonicalJson } = require('../../../shared/migrationBundleProtocol');
const {
  decryptBundleFile,
  verifySealedMigrationBundle,
} = require('../../../scripts/vnext-migration/sealedMigrationBundle');
const { loadSourceTableCatalog, validateSourceTableCatalog } = require('../../../migration/vnext/sourceTableCatalog');
const sourceInventory = require('../../../migration/vnext/fixtures/phase1-authority-schema.json');
const { withTransaction } = require('../db');

const IMPORTER_VERSION = 'vnext-shadow-1';
const SCHEMA_VERSION = 1;
const TARGET_PATTERN = /^(identity|access|business|question|storage|audit|migration)\.([a-z][a-z0-9_]*)$/;
const EVIDENCE_TARGETS = new Set([
  'identity.legacy_account_evidence', 'identity.external_identity_requests',
  'access.account_memberships', 'access.role_applications', 'access.role_bindings', 'access.legacy_role_evidence',
  'storage.question_assets', 'storage.paper_artifacts', 'storage.paper_jobs', 'storage.archive_jobs',
  'audit.legacy_authorization_events', 'audit.identity_provisioning_events', 'audit.legacy_sync_events',
  'audit.legacy_sync_rejections', 'audit.question_delete_events', 'audit.storage_events',
  'migration.legacy_record_ledger', 'migration.legacy_schema_events', 'migration.source_metadata',
  'migration.source_provenance',
]);

function importError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function unwrap(value) {
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') throw importError('VNEXT_CANONICAL_VALUE_INVALID');
  if (value.type === 'null') return null;
  if (value.type === 'text') return String(value.value);
  if (value.type === 'integer64') return String(value.value);
  if (value.type === 'real') return String(value.value);
  if (value.type === 'boolean') return Boolean(value.value);
  if (value.type === 'blob') return { bytes: Number(value.bytes), sha256: String(value.sha256) };
  throw importError('VNEXT_CANONICAL_VALUE_INVALID');
}

function unwrapRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw importError('VNEXT_CANONICAL_RECORD_INVALID');
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, unwrap(value)]));
}

function requireText(value, code) {
  const text = String(value || '').trim();
  if (!text) throw importError(code);
  return text;
}

function requireTimestamp(value, fallback) {
  const text = String(value || '').trim();
  if (text && !Number.isNaN(Date.parse(text))) return new Date(text).toISOString();
  return fallback;
}

function targetIdFor(record, sourceTable, sourceRecordKey) {
  for (const field of ['id', 'application_id', 'binding_id', 'operation_id', 'record_id', 'account_id', 'user_id', 'key', 'name']) {
    if (record[field] !== null && record[field] !== undefined && String(record[field]).trim()) return String(record[field]);
  }
  return `legacy_${sha256(`${sourceTable}\n${sourceRecordKey}`).slice(0, 40)}`;
}

function quoteTarget(target) {
  const match = TARGET_PATTERN.exec(String(target || ''));
  if (!match) throw importError('VNEXT_IMPORT_TARGET_INVALID');
  return `"${match[1]}"."${match[2]}"`;
}

function parseNdjson(bytes) {
  const text = bytes.toString('utf8');
  if (!text.trim()) return [];
  return text.trimEnd().split('\n').map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw importError(`VNEXT_BUNDLE_NDJSON_INVALID:${index + 1}`, error); }
  });
}

function encryptQuarantine(record, encryptionKey, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJson(record), 'utf8')), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'), aadHash: sha256(aad),
  };
}

function tenantRow(record, now) {
  return {
    columns: ['id', 'name', 'status', 'row_version', 'created_at', 'updated_at'],
    values: [
      requireText(record.id, 'VNEXT_TENANT_ID_REQUIRED'),
      requireText(record.name, 'VNEXT_TENANT_NAME_REQUIRED'),
      ['active', 'suspended', 'archived'].includes(record.status) ? record.status : 'active',
      1,
      requireTimestamp(record.created_at, now),
      requireTimestamp(record.updated_at, now),
    ],
  };
}

function evidenceRow(target, record, source, now) {
  const id = targetIdFor(record, source.sourceTable, source.sourceRecordKey);
  const common = {
    id,
    source_table: source.sourceTable,
    source_record_key: source.sourceRecordKey,
    source_row_hash: source.recordHash,
    evidence_payload: record,
  };
  if (target.startsWith('audit.')) return {
    columns: [...Object.keys(common), 'occurred_at'],
    values: [...Object.values(common), requireTimestamp(record.occurred_at || record.created_at, now)],
  };
  if (target.startsWith('storage.')) {
    const statusColumn = target.endsWith('_jobs') ? 'import_status' : 'verification_status';
    const statusValue = target.endsWith('_jobs') ? 'historical' : 'unverified';
    return { columns: [...Object.keys(common), statusColumn, 'imported_at'], values: [...Object.values(common), statusValue, now] };
  }
  if (target.startsWith('migration.')) return {
    columns: [...Object.keys(common), 'imported_at'], values: [...Object.values(common), now],
  };
  return {
    columns: [...Object.keys(common), 'review_status', 'imported_at'],
    values: [...Object.values(common), 'pending_review', now],
  };
}

function buildTargetRow(source, now) {
  const record = unwrapRecord(source.record);
  if (source.target === 'identity.tenants') return { id: requireText(record.id, 'VNEXT_TENANT_ID_REQUIRED'), ...tenantRow(record, now) };
  if (EVIDENCE_TARGETS.has(source.target)) {
    const row = evidenceRow(source.target, record, source, now);
    return { id: String(row.values[0]), ...row };
  }
  throw importError('VNEXT_IMPORT_TRANSFORMER_UNIMPLEMENTED');
}

async function insertRow(client, target, row) {
  const columns = row.columns.map(column => `"${column}"`).join(',');
  const placeholders = row.values.map((_, index) => `$${index + 1}`).join(',');
  const result = await client.query(
    `insert into ${quoteTarget(target)} (${columns}) values (${placeholders}) on conflict do nothing returning 1`,
    row.values,
  );
  return result.rowCount === 1;
}

async function quarantine(client, { batchId, source, reasonCode, encryptionKey, bundleHash, now }) {
  const id = `quarantine_${sha256(`${batchId}\n${source.sourceTable}\n${source.sourceRecordKey}`).slice(0, 40)}`;
  const encrypted = encryptQuarantine(source, encryptionKey, `${bundleHash}:${id}`);
  await client.query(`insert into migration.quarantine_records(
    id,migration_batch_id,logical_source_id,source_table,source_record_key,source_row_hash,
    encrypted_payload,reason_code,quarantined_at
  ) values($1,$2,'authority-db',$3,$4,$5,$6::jsonb,$7,$8) on conflict do nothing`,
  [id, batchId, source.sourceTable, source.sourceRecordKey, source.recordHash, JSON.stringify(encrypted), reasonCode, now]);
  return id;
}

async function importRecord(client, context, source) {
  if (!source || !source.sourceTable || !source.sourceRecordKey || !source.target
    || !/^[a-f0-9]{64}$/.test(String(source.recordHash || ''))) {
    throw importError('VNEXT_IMPORT_RECORD_INVALID');
  }
  if (sha256(canonicalJson(source.record)) !== source.recordHash) throw importError('VNEXT_IMPORT_RECORD_HASH_MISMATCH');
  const contract = context.catalogBySource.get(source.sourceTable);
  if (!contract || contract.disposition !== 'canonical' || contract.target !== source.target
    || contract.transformerId !== source.transformerId) {
    throw importError('VNEXT_IMPORT_RECORD_CONTRACT_MISMATCH');
  }
  const existing = await client.query(`select source_row_hash, disposition from migration.record_ledger
    where migration_batch_id=$1 and logical_source_id='authority-db' and source_table=$2 and source_record_key=$3`,
  [context.batchId, source.sourceTable, source.sourceRecordKey]);
  if (existing.rowCount) {
    if (existing.rows[0].source_row_hash !== source.recordHash) throw importError('VNEXT_IMPORT_REPLAY_HASH_CONFLICT');
    return { outcome: 'noop' };
  }

  let targetRow;
  try {
    targetRow = buildTargetRow(source, context.now);
  } catch (error) {
    if (error && error.code === 'VNEXT_IMPORT_TRANSFORMER_UNIMPLEMENTED') {
      await quarantine(client, { ...context, source, reasonCode: error.code });
      await client.query(`insert into migration.record_ledger(
        id,migration_batch_id,logical_source_id,source_table,source_record_key,source_row_hash,disposition,recorded_at
      ) values($1,$2,'authority-db',$3,$4,$5,'quarantined',$6)`,
      [`ledger_${sha256(`${context.batchId}\n${source.sourceTable}\n${source.sourceRecordKey}`).slice(0, 40)}`,
        context.batchId, source.sourceTable, source.sourceRecordKey, source.recordHash, context.now]);
      return { outcome: 'quarantined' };
    }
    throw error;
  }
  const targetConflict = await client.query(`select target_row_hash from migration.record_ledger
    where target_table=$1 and target_record_id=$2 and disposition='imported' order by recorded_at desc limit 1`,
  [source.target, targetRow.id]);
  if (targetConflict.rowCount && targetConflict.rows[0].target_row_hash !== source.recordHash) {
    await quarantine(client, { ...context, source, reasonCode: 'VNEXT_IMPORT_TARGET_HASH_CONFLICT' });
    await client.query(`insert into migration.record_ledger(
      id,migration_batch_id,logical_source_id,source_table,source_record_key,source_row_hash,disposition,recorded_at
    ) values($1,$2,'authority-db',$3,$4,$5,'quarantined',$6)`,
    [`ledger_${sha256(`${context.batchId}\n${source.sourceTable}\n${source.sourceRecordKey}`).slice(0, 40)}`,
      context.batchId, source.sourceTable, source.sourceRecordKey, source.recordHash, context.now]);
    return { outcome: 'quarantined' };
  }
  const inserted = await insertRow(client, source.target, targetRow);
  if (!inserted && !targetConflict.rowCount) throw importError('VNEXT_IMPORT_UNTRACKED_TARGET_CONFLICT');
  await client.query(`insert into migration.record_ledger(
    id,migration_batch_id,logical_source_id,source_table,source_record_key,source_row_hash,
    target_table,target_record_id,target_row_hash,disposition,recorded_at
  ) values($1,$2,'authority-db',$3,$4,$5,$6,$7,$8,'imported',$9)`,
  [`ledger_${sha256(`${context.batchId}\n${source.sourceTable}\n${source.sourceRecordKey}`).slice(0, 40)}`,
    context.batchId, source.sourceTable, source.sourceRecordKey, source.recordHash,
    source.target, targetRow.id, source.recordHash, context.now]);
  return { outcome: inserted ? 'inserted' : 'linked' };
}

async function importShadowBundle({
  pool, bundlePath, signingPublicKey, allowedPublicKeyFingerprints, encryptionKey,
  expectedEnvironment = 'shadow', authorityId, expectedSchemaContractHash,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw importError('VNEXT_IMPORT_POOL_REQUIRED');
  if (expectedEnvironment !== 'shadow') throw importError('VNEXT_IMPORT_SHADOW_ONLY');
  const catalog = loadSourceTableCatalog(path.join(__dirname, '..', '..', '..', 'migration', 'vnext', 'source-table-catalog.json'));
  const catalogValidation = validateSourceTableCatalog({ inventory: sourceInventory, catalog });
  const verified = verifySealedMigrationBundle({
    bundlePath, signingPublicKey, allowedPublicKeyFingerprints, encryptionKey, expectedEnvironment,
  });
  if (verified.catalogHash !== catalogValidation.catalogHash) throw importError('VNEXT_IMPORT_CATALOG_HASH_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(String(expectedSchemaContractHash || ''))) throw importError('VNEXT_IMPORT_SCHEMA_HASH_REQUIRED');
  const records = [];
  for (const payload of verified.payloads.filter(item => item.classification === 'business')) {
    const bytes = decryptBundleFile({
      bundlePath, relativePath: payload.relativePath, encryptionKey, signingPublicKey,
      allowedPublicKeyFingerprints, expectedEnvironment,
    });
    records.push(...parseNdjson(bytes));
  }
  records.sort((left, right) => {
    const leftEntry = catalog.tables.find(entry => entry.sourceTable === left.sourceTable);
    const rightEntry = catalog.tables.find(entry => entry.sourceTable === right.sourceTable);
    return (leftEntry?.dependencyOrder ?? 999) - (rightEntry?.dependencyOrder ?? 999)
      || String(left.sourceTable).localeCompare(String(right.sourceTable))
      || String(left.sourceRecordKey).localeCompare(String(right.sourceRecordKey));
  });

  const client = await pool.connect();
  const batchId = `batch_${sha256(`${expectedEnvironment}\n${verified.bundleHash}\n${IMPORTER_VERSION}`).slice(0, 40)}`;
  const now = new Date().toISOString();
  const summary = { batchId, inserted: 0, linked: 0, noop: 0, quarantined: 0, ledgerInserted: 0 };
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [`gewu-vnext:${authorityId}`]);
    await withTransaction(client, async tx => {
      const guard = await tx.query('select environment,authority_id from migration.environment_guard where singleton=true');
      if (guard.rowCount && (guard.rows[0].environment !== expectedEnvironment || guard.rows[0].authority_id !== authorityId)) {
        throw importError('VNEXT_IMPORT_ENVIRONMENT_GUARD_MISMATCH');
      }
      if (!guard.rowCount) await tx.query(`insert into migration.environment_guard(singleton,environment,authority_id,initialized_at)
        values(true,$1,$2,$3)`, [expectedEnvironment, authorityId, now]);
      const schema = await tx.query('select contract_hash from migration.schema_versions where version=$1', [SCHEMA_VERSION]);
      if (schema.rowCount && schema.rows[0].contract_hash !== expectedSchemaContractHash) throw importError('VNEXT_IMPORT_SCHEMA_HASH_MISMATCH');
      if (!schema.rowCount) await tx.query('insert into migration.schema_versions(version,contract_hash,applied_at) values($1,$2,$3)',
        [SCHEMA_VERSION, expectedSchemaContractHash, now]);
      await tx.query(`insert into migration.batches(
        id,environment,source_bundle_hash,source_inventory_hash,catalog_hash,importer_version,mode,status,started_at
      ) values($1,$2,$3,$4,$5,$6,'shadow','running',$7) on conflict(environment,source_bundle_hash,importer_version) do nothing`,
      [batchId, expectedEnvironment, verified.bundleHash, verified.sourceInventoryHash, verified.catalogHash, IMPORTER_VERSION, now]);
    });

    for (const source of records) {
      const result = await withTransaction(client, tx => importRecord(tx, {
        batchId, now, encryptionKey, bundleHash: verified.bundleHash,
        catalogBySource: new Map(catalog.tables.map(entry => [entry.sourceTable, entry])),
      }, source));
      summary[result.outcome] += 1;
      if (result.outcome !== 'noop') summary.ledgerInserted += 1;
    }
    await withTransaction(client, tx => tx.query(`update migration.batches set status='verified',completed_at=$2
      where id=$1 and status in ('running','verified')`, [batchId, new Date().toISOString()]));
    return Object.freeze(summary);
  } catch (error) {
    throw error && String(error.code || '').startsWith('VNEXT_') ? error : importError('VNEXT_IMPORT_FAILED', error);
  } finally {
    try { await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [`gewu-vnext:${authorityId}`]); } catch (_) { /* connection closes */ }
    client.release();
  }
}

module.exports = { IMPORTER_VERSION, importShadowBundle, unwrapRecord };
