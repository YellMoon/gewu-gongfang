'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { describeOperation } = require('./operationAudit');
const failure = code => Object.assign(new Error(code), { code });
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function createBusinessCommandWriter(pool) {
  const storage = new AsyncLocalStorage();
  async function query(text, values) {
    const scope = storage.getStore();
    if (!scope) return pool.query(text, values);
    if (!scope.active) throw failure('CLOUD_BUSINESS_COMMAND_TRANSACTION_CLOSED');
    await scope.client.query('SAVEPOINT business_command_statement');
    if (!scope.active) throw failure('CLOUD_BUSINESS_COMMAND_TRANSACTION_CLOSED');
    try {
      const result = await scope.client.query(text, values);
      if (!scope.active) throw failure('CLOUD_BUSINESS_COMMAND_TRANSACTION_CLOSED');
      await scope.client.query('RELEASE SAVEPOINT business_command_statement');
      if (!scope.active) throw failure('CLOUD_BUSINESS_COMMAND_TRANSACTION_CLOSED');
      return result;
    } catch (error) {
      if (!scope.active) throw error;
      await scope.client.query('ROLLBACK TO SAVEPOINT business_command_statement');
      if (!scope.active) throw error;
      await scope.client.query('RELEASE SAVEPOINT business_command_statement');
      throw error;
    }
  }
  async function transaction(work) {
    const client = await pool.connect();
    const scope = { client, active: true };
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '20s'");
      const result = await storage.run(scope, work);
      scope.active = false;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      scope.active = false;
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { scope.active = false; client.release(); }
  }
  return Object.freeze({ query, transaction });
}

function createBusinessCommandMiddleware({ writer, tenantId, desktopContext }) {
  return async (request, response, next) => {
    const operation = describeOperation(request);
    if (!operation || operation.miniapp || !request.path.startsWith('/api/business/')) return next();
    const commandId = request.get('X-Gewu-Command-Id');
    const payloadHash = request.get('X-Gewu-Command-Hash');
    if (!commandId && !payloadHash) return next(); // Older desktop clients retain their existing contract.
    const send = response.json.bind(response);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(commandId || '') || !/^[0-9a-f]{64}$/.test(payloadHash || '')) {
      return response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_COMMAND_INPUT_INVALID' });
    }
    if (!writer || !tenantId) return response.status(503).json({ ok: false, code: 'CLOUD_BUSINESS_COMMAND_UNAVAILABLE' });
    let actor;
    try { actor = await desktopContext(request); }
    catch (_) { return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' }); }
    const requestHash = hash({ method: request.method, path: request.path, body: request.body,
      roles: [...(actor.roles || [])].sort(), teacherId: actor.teacherId || null, studentId: actor.studentId || null,
      profile: actor.profile || null, authorityId: actor.authorityId || null });
    try {
      const outcome = await writer.transaction(async () => {
        const args = [tenantId, actor.accountId, commandId, payloadHash, requestHash];
        const existing = (await writer.query('SELECT * FROM business.vnext_begin_business_command($1,$2,$3,$4,$5)', args)).rows[0];
        if (existing?.http_status) return { status: existing.http_status, body: existing.response_body };
        let timer, onClose;
        const result = await new Promise((resolve, reject) => {
          let captured = false;
          response.json = body => {
            if (!captured) { captured = true; resolve({ status: response.statusCode, body }); }
            return response;
          };
          onClose = () => reject(failure('CLOUD_BUSINESS_COMMAND_RESPONSE_CLOSED'));
          response.once('close', onClose);
          timer = setTimeout(() => reject(failure('CLOUD_BUSINESS_COMMAND_TIMEOUT')), 25000);
          next();
        }).finally(() => { clearTimeout(timer); response.removeListener('close', onClose); });
        if (result.status >= 500) throw failure('CLOUD_BUSINESS_COMMAND_UNAVAILABLE');
        await writer.query('SELECT business.vnext_finish_business_command($1,$2,$3,$4,$5,$6,$7)', [...args, result.status, JSON.stringify(result.body)]);
        return result;
      });
      response.json = send;
      if (!response.destroyed) { response.status(outcome.status); send(outcome.body); }
    } catch (error) {
      response.json = send;
      if (response.destroyed) return;
      const conflict = error?.message === 'VNEXT_BUSINESS_COMMAND_HASH_MISMATCH';
      response.status(conflict ? 409 : 503);
      send({ ok: false, code: conflict ? 'CLOUD_BUSINESS_COMMAND_CONFLICT' : 'CLOUD_BUSINESS_COMMAND_UNAVAILABLE' });
    }
  };
}
module.exports = { createBusinessCommandWriter, createBusinessCommandMiddleware };
