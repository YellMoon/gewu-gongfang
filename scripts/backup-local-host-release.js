'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Sqlite = require('better-sqlite3');

const projectPackage = require('../package.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('RELEASE_VERSION_INVALID');
  return version;
}

async function main() {
  const configPath = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'gewugongfang.config.json');
  if (!fs.existsSync(configPath)) throw new Error('PRIMARY_HOST_RUNTIME_CONFIG_MISSING');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sourceDb = path.resolve(String(config.mainDbPath || ''));
  const questionBankRoot = path.resolve(String(config.questionBankPath || ''));
  const manifestPath = path.join(questionBankRoot, 'manifest.json');
  if (!fs.existsSync(sourceDb) || !fs.existsSync(manifestPath)) {
    throw new Error('PRIMARY_HOST_AUTHORITY_FILES_MISSING');
  }

  const hostRoot = path.dirname(path.dirname(sourceDb));
  const backupParent = path.resolve(hostRoot, 'backups');
  if (path.parse(backupParent).root !== path.parse(sourceDb).root || backupParent === hostRoot) {
    throw new Error('PRIMARY_HOST_BACKUP_SCOPE_INVALID');
  }
  const version = safeVersion(process.env.GEWU_RELEASE_TARGET_VERSION || projectPackage.version);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backupRoot = path.join(backupParent, `release-${version}-${stamp}`);
  fs.mkdirSync(backupRoot, { recursive: false });

  const backupDb = path.join(backupRoot, 'scheduling.db');
  const source = new Sqlite(sourceDb, { readonly: true, fileMustExist: true });
  const sourceCheck = source.pragma('quick_check', { simple: true });
  try {
    await source.backup(backupDb);
  } finally {
    source.close();
  }
  const copy = new Sqlite(backupDb, { readonly: true, fileMustExist: true });
  const backupCheck = copy.pragma('quick_check', { simple: true });
  copy.close();
  if (sourceCheck !== 'ok' || backupCheck !== 'ok') throw new Error('PRIMARY_HOST_BACKUP_INTEGRITY_FAILED');

  const copied = [
    [configPath, 'gewugongfang.config.json'],
    [manifestPath, 'question-bank-manifest.json'],
  ];
  for (const [sourcePath, name] of copied) fs.copyFileSync(sourcePath, path.join(backupRoot, name));

  const files = fs.readdirSync(backupRoot).sort().map(name => {
    const filePath = path.join(backupRoot, name);
    return { name, bytes: fs.statSync(filePath).size, sha256: sha256(filePath) };
  });
  const evidence = {
    schemaVersion: 1,
    releaseVersion: version,
    createdAt: new Date().toISOString(),
    backupRoot,
    sourceCheck,
    backupCheck,
    files,
    secretsRecorded: false,
  };
  fs.writeFileSync(path.join(backupRoot, 'backup-verification.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence));
}

main().catch(error => {
  console.error(String(error?.code || error?.message || error));
  process.exitCode = 1;
});
