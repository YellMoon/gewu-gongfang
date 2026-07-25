const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backupRoot = path.join('D:\\GewuDataHost\\backups', `release-6.2.0-${stamp}`);
  const sourceDb = 'D:\\GewuDataHost\\data\\scheduling.db';
  const backupDb = path.join(backupRoot, 'scheduling.db');
  fs.mkdirSync(backupRoot, { recursive: true });

  const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
  const sourceCheck = source.pragma('quick_check', { simple: true });
  await source.backup(backupDb);
  source.close();

  const backup = new Database(backupDb, { readonly: true, fileMustExist: true });
  const backupCheck = backup.pragma('quick_check', { simple: true });
  backup.close();
  if (sourceCheck !== 'ok' || backupCheck !== 'ok') {
    throw new Error(`SQLite quick_check failed: source=${sourceCheck} backup=${backupCheck}`);
  }

  const copies = [
    [path.join(process.env.APPDATA, 'gewu-gongfang', 'gewugongfang.config.json'), 'gewugongfang.config.json'],
    ['I:\\GewuQuestionBank\\manifest.json', 'question-bank-manifest.json'],
  ];
  for (const [sourcePath, targetName] of copies) {
    fs.copyFileSync(sourcePath, path.join(backupRoot, targetName));
  }

  const files = fs.readdirSync(backupRoot).sort().map(name => {
    const filePath = path.join(backupRoot, name);
    return { name, bytes: fs.statSync(filePath).size, sha256: sha256(filePath) };
  });
  const result = { backupRoot, sourceCheck, backupCheck, files };
  const verificationPath = path.join(backupRoot, 'backup-verification.json');
  fs.writeFileSync(verificationPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...result, verificationPath }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
