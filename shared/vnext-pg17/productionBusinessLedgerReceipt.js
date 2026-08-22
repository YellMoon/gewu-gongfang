'use strict';

const fs = require('fs');
const path = require('path');

const { BUSINESS_FOUNDATION_MIGRATIONS, sha256 } = require('./businessFoundationManifest');

const MINIAPP_STUDENT_ACCESS_SQL_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'cloud-business-api',
  'sql',
  '20260822-miniapp-student-access.sql'
);
const EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256 = '3f85ebba7522d9faf09e98bc67a53205ace5d2e1531e9a6ad8ab22a9fffffb00';
const MINIAPP_STUDENT_ACCESS_SQL = fs.readFileSync(MINIAPP_STUDENT_ACCESS_SQL_PATH, 'utf8');

if (sha256(MINIAPP_STUDENT_ACCESS_SQL.trim()) !== EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256) {
  throw new Error('PRODUCTION_BUSINESS_LEDGER_RECEIPT_SOURCE_HASH_MISMATCH');
}

const MINIAPP_STUDENT_ACCESS_MIGRATION = Object.freeze({
  migrationId: 'business-miniapp-student-access-3',
  semanticVersion: 3,
  sql: MINIAPP_STUDENT_ACCESS_SQL,
  manifestSha256: EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256,
});

const PRODUCTION_BUSINESS_LEDGER_MIGRATIONS = Object.freeze([
  ...BUSINESS_FOUNDATION_MIGRATIONS,
  MINIAPP_STUDENT_ACCESS_MIGRATION,
]);

function assertProductionBusinessLedgerRows(rows) {
  if (!Array.isArray(rows) || rows.length !== PRODUCTION_BUSINESS_LEDGER_MIGRATIONS.length) {
    throw new Error('PRODUCTION_BUSINESS_LEDGER_DRIFT');
  }
  for (let index = 0; index < PRODUCTION_BUSINESS_LEDGER_MIGRATIONS.length; index += 1) {
    const expected = PRODUCTION_BUSINESS_LEDGER_MIGRATIONS[index];
    const actual = rows[index] || {};
    if (
      actual.migration_id !== expected.migrationId
      || String(actual.semantic_version) !== String(expected.semanticVersion)
      || actual.manifest_sha256 !== expected.manifestSha256
    ) {
      throw new Error('PRODUCTION_BUSINESS_LEDGER_DRIFT');
    }
  }
  return rows;
}

module.exports = {
  EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256,
  MINIAPP_STUDENT_ACCESS_MIGRATION,
  MINIAPP_STUDENT_ACCESS_SQL_PATH,
  PRODUCTION_BUSINESS_LEDGER_MIGRATIONS,
  assertProductionBusinessLedgerRows,
};
