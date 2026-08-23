'use strict';

const crypto = require('crypto');

function cloudEpochError(code) {
  return Object.assign(new Error(code), { code });
}

function epochIdFor(authorityId) {
  const normalized = String(authorityId || '').trim();
  if (!normalized) throw cloudEpochError('AUTHORITY_CLOUD_EPOCH_AUTHORITY_REQUIRED');
  return `cloud-${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

function createAuthorityCloudEpochService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db?.prepare || !db?.exec || !db?.transaction) {
    throw cloudEpochError('AUTHORITY_CLOUD_EPOCH_DATABASE_REQUIRED');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS authority_cloud_epochs (
    authority_id TEXT PRIMARY KEY,
    authority_epoch_id TEXT NOT NULL UNIQUE,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const findById = db.prepare(`SELECT authority_epoch_id AS id,authority_id,generation
    FROM authority_cloud_epochs WHERE authority_epoch_id=? AND status='active'`);
  const findByAuthority = db.prepare(`SELECT authority_epoch_id AS id,authority_id,generation
    FROM authority_cloud_epochs WHERE authority_id=? AND status='active'`);
  const hasAuthority = db.prepare(`SELECT 1 FROM authority_accounts
    WHERE authority_id=? AND status='active' LIMIT 1`);
  const insert = db.prepare(`INSERT INTO authority_cloud_epochs
    (authority_id,authority_epoch_id,generation,status,created_at,updated_at)
    VALUES(?,?,1,'active',?,?) ON CONFLICT(authority_id) DO NOTHING`);

  const ensure = db.transaction(authorityId => {
    const authority = String(authorityId || '').trim();
    if (!authority || !hasAuthority.get(authority)) {
      throw cloudEpochError('AUTHORITY_CLOUD_EPOCH_AUTHORITY_INACTIVE');
    }
    const timestamp = new Date(now()).toISOString();
    insert.run(authority, epochIdFor(authority), timestamp, timestamp);
    return findByAuthority.get(authority);
  });

  return Object.freeze({
    ensure,
    find: id => findById.get(String(id || '').trim()) || null,
    findForAuthority: authorityId => findByAuthority.get(String(authorityId || '').trim()) || null,
    epochIdFor,
  });
}

module.exports = { cloudEpochError, createAuthorityCloudEpochService, epochIdFor };
