'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function healthFailure() {
  return Object.assign(new Error('STORAGE_AGENT_HEALTH_FAILED'), { code: 'STORAGE_AGENT_HEALTH_FAILED' });
}

function assertInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw healthFailure();
  return candidate;
}

function assertNoReparsePoint(candidate, root) {
  const safeCandidate = assertInsideRoot(candidate, root);
  let current = root;
  for (const segment of path.relative(root, safeCandidate).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw healthFailure();
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  return safeCandidate;
}

async function runStorageAgentHealthCheck({ config, version, randomId = () => crypto.randomUUID(), now = () => new Date() } = {}) {
  if (!config || typeof config.agentId !== 'string' || typeof config.nasRoot !== 'string' || !path.isAbsolute(config.nasRoot)
    || typeof version !== 'string' || !version || typeof randomId !== 'function' || typeof now !== 'function') throw healthFailure();
  const root = path.resolve(config.nasRoot);
  const checkedAt = now();
  const probeId = String(randomId());
  if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime()) || !/^[A-Za-z0-9_-]{4,128}$/.test(probeId)) throw healthFailure();
  const healthDirectory = assertNoReparsePoint(path.join(root, '.gewu-storage-agent', 'health'), root);
  const probePath = assertNoReparsePoint(path.join(healthDirectory, `${probeId}.probe`), root);
  const bytes = crypto.randomBytes(32);
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const directoryExisted = fs.existsSync(healthDirectory);
  try {
    await fs.promises.mkdir(healthDirectory, { recursive: true });
    assertNoReparsePoint(healthDirectory, root);
    assertNoReparsePoint(probePath, root);
    await fs.promises.writeFile(probePath, bytes, { flag: 'wx' });
    const observed = await fs.promises.readFile(probePath);
    if (observed.length !== bytes.length || crypto.createHash('sha256').update(observed).digest('hex') !== expectedHash) throw healthFailure();
  } catch (error) {
    if (error?.code === 'STORAGE_AGENT_HEALTH_FAILED') throw error;
    throw healthFailure();
  } finally {
    try {
      await fs.promises.rm(probePath, { force: true });
      if (!directoryExisted) await fs.promises.rmdir(healthDirectory);
    } catch (_) {
      throw healthFailure();
    }
  }
  return Object.freeze({
    ok: true,
    agentId: config.agentId,
    version,
    checkedAt: checkedAt.toISOString(),
    writableAuthority: false,
  });
}

module.exports = Object.freeze({ runStorageAgentHealthCheck });
