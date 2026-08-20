'use strict';

const { types } = require('util');
const {
  checkoutVNextPg17SyntheticVerifierLease,
  isVNextPg17SyntheticTlsBrandForPool,
  syntheticVerifierPoolDatabase,
  isVNextPg17SyntheticVerifierPoolForHandle,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

function unavailable() {
  const error = new Error('vNext PG17 production verifier is unavailable');
  error.code = 'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE';
  return error;
}

function snapshotConfig(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw unavailable();
  const keys = Reflect.ownKeys(value);
  const expected = ['databaseBinding', 'expectedDatabase', 'expectedUser', 'syntheticTlsBrand', 'verifierPool'];
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) throw unavailable();
  for (const key of keys) {
    if (typeof key !== 'string') throw unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw unavailable();
  }
  const { databaseBinding, verifierPool, expectedDatabase, expectedUser, syntheticTlsBrand } = value;
  if (!databaseBinding || typeof databaseBinding !== 'object' || types.isProxy(databaseBinding)
    || !verifierPool || typeof verifierPool !== 'object' || types.isProxy(verifierPool)
    || !syntheticTlsBrand || typeof syntheticTlsBrand !== 'object' || types.isProxy(syntheticTlsBrand)
    || typeof expectedDatabase !== 'string' || expectedDatabase.trim() === ''
    || typeof expectedUser !== 'string' || expectedUser !== 'vnext_pg17_verifier') throw unavailable();
  return Object.freeze({ databaseBinding, verifierPool, expectedDatabase, expectedUser, syntheticTlsBrand });
}

function createVNextPg17ProductionVerifierReadiness(config) {
  const settings = snapshotConfig(config);
  try {
    if (!isVNextPg17SyntheticVerifierPoolForHandle(settings.verifierPool, settings.databaseBinding)
      || syntheticVerifierPoolDatabase(settings.verifierPool) !== settings.expectedDatabase
      || !isVNextPg17SyntheticTlsBrandForPool(settings.syntheticTlsBrand, settings.verifierPool)) throw unavailable();
  } catch (_) {
    throw unavailable();
  }
  const catalog = createVNextPg17CatalogBoundary(settings.databaseBinding);
  let closed = false;

  async function check() {
    if (closed) throw unavailable();
    let lease;
    let transactionSent = false;
    let beginConfirmed = false;
    let commitSent = false;
    let transactionFinalized = false;
    let releaseAttempted = false;
    let leaseReleased = false;
    let destroyAttempted = false;
    try {
      lease = await checkoutVNextPg17SyntheticVerifierLease(settings.verifierPool);
      transactionSent = true;
      await lease.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      beginConfirmed = true;
      await lease.query("SELECT set_config('TimeZone', 'UTC', true)");
      await lease.query("SELECT set_config('statement_timeout', '5000ms', true)");
      await lease.query("SELECT set_config('lock_timeout', '1000ms', true)");
      await lease.query("SELECT set_config('application_name', 'gewu-vnext-verifier-readiness', true)");
      const identity = await lease.query('SELECT current_database() AS database_name, current_user AS user_name');
      if (identity.rows.length !== 1 || identity.rows[0].database_name !== settings.expectedDatabase
        || identity.rows[0].user_name !== settings.expectedUser) throw unavailable();
      const tls = await lease.query('SELECT COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl');
      if (tls.rows.length !== 1 || tls.rows[0].ssl !== false) throw unavailable();
      const facade = catalog.createVerifierQueryFacade((text, values) => lease.query(text, values));
      await catalog.assertQueryFacade(facade);
      commitSent = true;
      await lease.query('COMMIT');
      transactionFinalized = true;
      releaseAttempted = true;
      await lease.release();
      leaseReleased = true;
      return Object.freeze({ migrationVersion: 15, ready: true, schemaVersion: 5 });
    } catch (_) {
      if (lease) {
        if (transactionSent && beginConfirmed && !transactionFinalized && !commitSent) {
          try {
            await lease.query('ROLLBACK');
            transactionFinalized = true;
          } catch (_) { /* destroy the uncertain connection below */ }
        }
        if (transactionFinalized && !releaseAttempted) {
          releaseAttempted = true;
          try {
            await lease.release();
            leaseReleased = true;
          } catch (_) {
            /* destroy the unreturned connection below */
          }
        }
        if (!leaseReleased && !destroyAttempted) {
          destroyAttempted = true;
          try { await lease.destroy(); } catch (_) { /* no-op */ }
        }
      }
      throw unavailable();
    }
  }

  return Object.freeze({ check, close: () => { closed = true; } });
}

module.exports = Object.freeze({ createVNextPg17ProductionVerifierReadiness });
