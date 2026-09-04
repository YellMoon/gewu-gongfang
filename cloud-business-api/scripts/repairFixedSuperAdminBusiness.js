'use strict';

const { Pool } = require('pg');
const { resolveFixedSuperAdminIdentity } = require('./verifyFixedSuperAdmin');
const { resolveRuntimeDatabaseUser } = require('../src/runtimeDatabaseRole');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');
  let repair = false;
  let rollback = false;
  let backupSha256 = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repair' && !repair) {
      repair = true;
    } else if (value === '--rollback' && !rollback) {
      rollback = true;
    } else if (value === '--backup-sha256' && backupSha256 === null && index + 1 < argv.length) {
      backupSha256 = argv[index + 1];
      index += 1;
    } else {
      throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');
    }
  }
  if (!repair && (rollback || backupSha256 !== null)) throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');
  if (repair && !/^[0-9a-f]{64}$/u.test(backupSha256 || '')) throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_BACKUP_REQUIRED');
  return Object.freeze({ repair, rollback, backupEvidenceProvided: backupSha256 !== null });
}

function fixedIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.authorityId !== 'string' || !value.authorityId
    || typeof value.accountId !== 'string' || !value.accountId
    || !/^[0-9a-f]{64}$/u.test(value.phoneHmac || '')) {
    throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');
  }
  return Object.freeze({ authorityId: value.authorityId, accountId: value.accountId, phoneHmac: value.phoneHmac });
}

function state(row) {
  const keys = ['activeSuperAdminCount', 'fixedActiveSuperAdminCount', 'extraActiveSuperAdminCount', 'fixedActiveAccountCount'];
  if (!row || typeof row !== 'object' || keys.some(key => !Number.isInteger(row[key]) || row[key] < 0)
    || row.activeSuperAdminCount !== row.fixedActiveSuperAdminCount + row.extraActiveSuperAdminCount) {
    throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_STATE_INVALID');
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, row[key]])));
}

async function readState(client, identity) {
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE role='super_admin' AND status='active')::integer AS "activeSuperAdminCount",
       count(*) FILTER (WHERE role='super_admin' AND status='active' AND account_id=$1)::integer AS "fixedActiveSuperAdminCount",
       count(*) FILTER (WHERE role='super_admin' AND status='active' AND account_id<>$1)::integer AS "extraActiveSuperAdminCount",
       (SELECT count(*)::integer
          FROM business.miniapp_cloud_accounts
         WHERE account_id=$1 AND phone_hmac=$2 AND status='active') AS "fixedActiveAccountCount"
       FROM business.miniapp_cloud_role_grants`,
    [identity.accountId, identity.phoneHmac],
  );
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_STATE_INVALID');
  }
  return state(result.rows[0]);
}

function safeToRepair(current) {
  return current.fixedActiveAccountCount === 1 && current.fixedActiveSuperAdminCount === 1;
}

function publicResult({ mode, before, after, revokedGrantCount, committed, backupEvidenceProvided }) {
  return Object.freeze({
    mode,
    committed,
    backupEvidenceProvided,
    safeToRepair: safeToRepair(before),
    activeSuperAdminCountBefore: before.activeSuperAdminCount,
    fixedActiveSuperAdminCountBefore: before.fixedActiveSuperAdminCount,
    extraActiveSuperAdminCountBefore: before.extraActiveSuperAdminCount,
    fixedActiveAccountCountBefore: before.fixedActiveAccountCount,
    revokedGrantCount,
    activeSuperAdminCountAfter: after.activeSuperAdminCount,
    fixedActiveSuperAdminCountAfter: after.fixedActiveSuperAdminCount,
    extraActiveSuperAdminCountAfter: after.extraActiveSuperAdminCount,
  });
}

async function repairFixedSuperAdminBusiness({ client, identity: rawIdentity, repair = false, rollback = false, backupEvidenceProvided = false }) {
  if (!client || typeof client.query !== 'function' || typeof repair !== 'boolean' || typeof rollback !== 'boolean'
    || typeof backupEvidenceProvided !== 'boolean' || (rollback && !repair) || (repair && !backupEvidenceProvided)) {
    throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');
  }
  const identity = fixedIdentity(rawIdentity);
  let transactionOpen = false;
  try {
    await client.query(repair ? 'BEGIN' : 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    if (repair) {
      await client.query('LOCK TABLE business.miniapp_cloud_accounts, business.miniapp_cloud_role_grants IN SHARE ROW EXCLUSIVE MODE');
    }
    const before = await readState(client, identity);
    if (!repair) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return publicResult({ mode: 'report', before, after: before, revokedGrantCount: 0, committed: false, backupEvidenceProvided: false });
    }
    if (!safeToRepair(before)) throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_UNSAFE');
    const update = await client.query(
      `UPDATE business.miniapp_cloud_role_grants
          SET status='revoked', updated_at=transaction_timestamp()
        WHERE role='super_admin' AND status='active' AND account_id<>$1`,
      [identity.accountId],
    );
    const revokedGrantCount = update?.rowCount;
    if (!Number.isInteger(revokedGrantCount) || revokedGrantCount !== before.extraActiveSuperAdminCount) {
      throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_POSTCONDITION_FAILED');
    }
    const after = await readState(client, identity);
    if (!safeToRepair(after) || after.activeSuperAdminCount !== 1 || after.fixedActiveSuperAdminCount !== 1
      || after.extraActiveSuperAdminCount !== 0) {
      throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_POSTCONDITION_FAILED');
    }
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
    transactionOpen = false;
    return publicResult({
      mode: rollback ? 'repair_rollback' : 'repair',
      before,
      after,
      revokedGrantCount,
      committed: !rollback,
      backupEvidenceProvided,
    });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    if (error?.code && String(error.code).startsWith('CLOUD_FIXED_SUPER_ADMIN_REPAIR_')) throw error;
    throw failure('CLOUD_FIXED_SUPER_ADMIN_REPAIR_FAILED');
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv);
  const identity = resolveFixedSuperAdminIdentity({
    recordsJson: env.CLOUD_OPERATOR_PHONE_HMACS,
    phonePepper: env.CLOUD_IDENTITY_PHONE_PEPPER,
  });
  const pool = new Pool({
    host: env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud',
    user: resolveRuntimeDatabaseUser(env.POSTGRES_USER),
    password: env.POSTGRES_PASSWORD,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
  });
  const client = await pool.connect();
  try {
    return await repairFixedSuperAdminBusiness({ client, identity, ...options });
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    console.error(error?.code || 'CLOUD_FIXED_SUPER_ADMIN_REPAIR_FAILED');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ parseArguments, repairFixedSuperAdminBusiness, main });
