'use strict';
const assert = require('node:assert/strict');
const { createBusinessCommandWriter } = require('./businessCommandTransaction');

(async () => {
  const statements = [];
  let releaseCount = 0;
  const client = { async query(sql) { statements.push(sql); if (sql === 'bad') throw Object.assign(new Error('unique'), { code: '23505' }); return { rows: [] }; }, release() { releaseCount++; } };
  const writer = createBusinessCommandWriter({ connect: async () => client, query: async () => { throw new Error('escaped transaction'); } });
  await writer.transaction(async () => {
    await writer.query('good');
    await assert.rejects(writer.query('bad'), error => error.code === '23505');
    await writer.query('after handled error');
  });
  assert.ok(statements.includes('ROLLBACK TO SAVEPOINT business_command_statement'));
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(releaseCount, 1);
  await assert.rejects(writer.transaction(async () => { await writer.query('bad'); }));
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(releaseCount, 2);
  let releaseSavepoint, lateQuery;
  const raceStatements = [];
  const raceClient = { query: async sql => {
    raceStatements.push(sql);
    if (sql.startsWith('SAVEPOINT')) await new Promise(resolve => { releaseSavepoint = resolve; });
    return { rows: [] };
  }, release() {} };
  const raceWriter = createBusinessCommandWriter({ connect: async () => raceClient });
  await assert.rejects(raceWriter.transaction(async () => {
    lateQuery = raceWriter.query('must not execute after rollback');
    throw new Error('response closed');
  }), /response closed/);
  const rejectedLate = assert.rejects(lateQuery, error => error.code === 'CLOUD_BUSINESS_COMMAND_TRANSACTION_CLOSED');
  releaseSavepoint();
  await rejectedLate;
  assert.ok(!raceStatements.includes('must not execute after rollback'), 'a query awaiting its savepoint cannot escape an aborted transaction');
  let releaseCleanup, cleanupEntered, cleanupQuery, released = false;
  const cleanupReady = new Promise(resolve => { cleanupEntered = resolve; });
  const cleanupStatements = [];
  const cleanupClient = { query: async sql => {
    cleanupStatements.push({ sql, released });
    if (sql === 'bad') throw new Error('unique');
    if (sql.startsWith('ROLLBACK TO')) { cleanupEntered(); await new Promise(resolve => { releaseCleanup = resolve; }); }
    return { rows: [] };
  }, release() { released = true; } };
  const cleanupWriter = createBusinessCommandWriter({ connect: async () => cleanupClient });
  await assert.rejects(cleanupWriter.transaction(async () => {
    cleanupQuery = cleanupWriter.query('bad');
    await cleanupReady;
    throw new Error('response closed');
  }), /response closed/);
  const rejectedCleanup = assert.rejects(cleanupQuery, /unique/);
  releaseCleanup();
  await rejectedCleanup;
  assert.ok(!cleanupStatements.some(row => row.released), 'savepoint cleanup must not query a released connection');
  console.log('business command transaction lifecycle passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
