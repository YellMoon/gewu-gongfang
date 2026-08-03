'use strict';

function runtimeEpochError(code) { return Object.assign(new Error(code), { code }); }

function createAuthorityRuntimeHostEpochService({ db } = {}) {
  if (!db?.prepare || !db?.exec || !db?.transaction) throw runtimeEpochError('AUTHORITY_RUNTIME_EPOCH_DATABASE_REQUIRED');
  db.exec(`CREATE TABLE IF NOT EXISTS authority_runtime_host_epochs (
    host_epoch_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, host_generation INTEGER NOT NULL,
    host_device_id TEXT NOT NULL, host_public_key TEXT NOT NULL, status TEXT NOT NULL,
    verified_at TEXT NOT NULL
  )`);
  const primaryColumns = new Set(db.prepare("SELECT name FROM pragma_table_info('primary_host_epochs')").all().map(row => row.name));
  const primaryGeneration = primaryColumns.has('generation') ? 'generation' : '0';
  const primaryDevice = primaryColumns.has('device_id') ? 'device_id' : "''";
  const primaryOrder = primaryColumns.has('generation') ? 'generation DESC' : 'id DESC';
  const primaryById = db.prepare(`SELECT id,db_authority_id AS authority_id,${primaryGeneration} AS generation,${primaryDevice} AS device_id
    FROM primary_host_epochs WHERE id=? AND status='active'`);
  const runtimeById = db.prepare(`SELECT host_epoch_id AS id,authority_id,host_generation AS generation,
    host_device_id AS device_id FROM authority_runtime_host_epochs WHERE host_epoch_id=? AND status='active'`);
  const primaryByDevice = primaryColumns.has('device_id') ? db.prepare(`SELECT id,db_authority_id AS authority_id,${primaryGeneration} AS generation,device_id
    FROM primary_host_epochs WHERE device_id=? AND status='active' ORDER BY ${primaryOrder} LIMIT 1`) : null;
  const runtimeByDevice = db.prepare(`SELECT host_epoch_id AS id,authority_id,host_generation AS generation,
    host_device_id AS device_id FROM authority_runtime_host_epochs WHERE host_device_id=? AND status='active'
    ORDER BY host_generation DESC LIMIT 1`);
  const primaryLatest = db.prepare(`SELECT id,db_authority_id AS authority_id,${primaryGeneration} AS generation,${primaryDevice} AS device_id
    FROM primary_host_epochs WHERE status='active' ORDER BY ${primaryOrder} LIMIT 1`);
  const runtimeLatest = db.prepare(`SELECT host_epoch_id AS id,authority_id,host_generation AS generation,
    host_device_id AS device_id FROM authority_runtime_host_epochs WHERE status='active' ORDER BY host_generation DESC LIMIT 1`);
  const find = id => primaryById.get(id) || runtimeById.get(id) || null;
  const findForDevice = deviceId => (primaryByDevice?.get(deviceId)) || runtimeByDevice.get(deviceId) || null;
  const findLatest = () => primaryLatest.get() || runtimeLatest.get() || null;
  const install = db.transaction(({ epoch, hostSigningKey } = {}) => {
    const id = String(epoch?.id || '').trim(); const authority = String(epoch?.authorityId || '').trim();
    const deviceId = String(epoch?.deviceId || '').trim(); const generation = Number(epoch?.generation);
    const publicKey = String(epoch?.hostPublicKey || '').trim(); const expectedKey = String(hostSigningKey?.publicKeyPem || '').trim();
    if (!id || !authority || !deviceId || !Number.isSafeInteger(generation) || generation < 1 || !publicKey || publicKey !== expectedKey) throw runtimeEpochError('AUTHORITY_RUNTIME_EPOCH_INVALID');
    const metadata = db.prepare("SELECT value FROM authority_metadata WHERE key='database_authority_id'").get()?.value;
    if (String(metadata || '') !== authority) throw runtimeEpochError('AUTHORITY_RUNTIME_EPOCH_AUTHORITY_MISMATCH');
    const existing = find(id);
    if (existing && (existing.authority_id !== authority || existing.device_id !== deviceId || Number(existing.generation) !== generation)) throw runtimeEpochError('AUTHORITY_RUNTIME_EPOCH_CONFLICT');
    const other = findForDevice(deviceId);
    if (other && other.id !== id) throw runtimeEpochError('AUTHORITY_RUNTIME_EPOCH_CONFLICT');
    db.prepare(`INSERT INTO authority_runtime_host_epochs(host_epoch_id,authority_id,host_generation,host_device_id,host_public_key,status,verified_at)
      VALUES(?,?,?,?,?,'active',?) ON CONFLICT(host_epoch_id) DO UPDATE SET authority_id=excluded.authority_id,host_generation=excluded.host_generation,host_device_id=excluded.host_device_id,host_public_key=excluded.host_public_key,status='active',verified_at=excluded.verified_at`)
      .run(id, authority, generation, deviceId, publicKey, new Date().toISOString());
    return find(id);
  });
  return Object.freeze({ find, findForDevice, findLatest, install });
}

module.exports = { createAuthorityRuntimeHostEpochService, runtimeEpochError };
