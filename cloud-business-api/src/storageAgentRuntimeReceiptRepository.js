'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure() {
  return Object.assign(new Error('STORAGE_AGENT_RUNTIME_RECEIPT_INVALID'), { code: 'STORAGE_AGENT_RUNTIME_RECEIPT_INVALID' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure();
  return value;
}

function validate(input) {
  const request = exact(input, ['agentId', 'agentVersion', 'contracts']);
  if (typeof request.agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(request.agentId)
    || typeof request.agentVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(request.agentVersion)) throw failure();
  const contracts = exact(request.contracts, ['questionPaperExport', 'storageAgentTransport']);
  if (contracts.questionPaperExport !== 3 || contracts.storageAgentTransport !== 2) throw failure();
  return request;
}

function output(row) {
  if (!row || typeof row !== 'object' || typeof row.receiptId !== 'string' || !/^storage_runtime_receipt_[A-Za-z0-9_-]{8,128}$/.test(row.receiptId)
    || typeof row.agentId !== 'string' || typeof row.agentVersion !== 'string' || !(row.observedAt instanceof Date) || !Number.isFinite(row.observedAt.getTime())) throw failure();
  const contracts = validate({ agentId: row.agentId, agentVersion: row.agentVersion, contracts: row.contracts }).contracts;
  return Object.freeze({ receiptId: row.receiptId, agentId: row.agentId, agentVersion: row.agentVersion, contracts: { ...contracts }, observedAt: row.observedAt.toISOString() });
}

function createStorageAgentRuntimeReceiptRepository({ query, randomId = () => crypto.randomUUID() } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function') throw failure();
  return Object.freeze({
    async record(input) {
      const request = validate(input);
      const receiptId = `storage_runtime_receipt_${String(randomId()).replace(/[^A-Za-z0-9_-]/g, '')}`;
      if (!/^storage_runtime_receipt_[A-Za-z0-9_-]{8,128}$/.test(receiptId)) throw failure();
      const result = await query(
        `INSERT INTO business.storage_agent_runtime_receipts (receipt_id,agent_id,agent_version,contracts)
         VALUES ($1,$2,$3,$4::jsonb)
         RETURNING receipt_id AS "receiptId",agent_id AS "agentId",agent_version AS "agentVersion",contracts,observed_at AS "observedAt"`,
        [receiptId, request.agentId, request.agentVersion, JSON.stringify(request.contracts)],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure();
      return output(result.rows[0]);
    },
  });
}

module.exports = Object.freeze({ createStorageAgentRuntimeReceiptRepository });
