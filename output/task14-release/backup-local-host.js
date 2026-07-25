const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const root = path.join('D:\\GewuDataHost\\backups', `release-5.14.4-${stamp}`);
  fs.mkdirSync(root, { recursive: true });

  const sourceDb = 'D:\\GewuDataHost\\data\\scheduling.db';
  const backupDb = path.join(root, 'scheduling.db');
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

  const files = [
    [path.join(process.env.APPDATA, 'gewu-gongfang', 'gewugongfang.config.json'), 'gewugongfang.config.json'],
    ['I:\\GewuQuestionBank\\manifest.json', 'question-bank-manifest.json'],
  ];
  for (const [sourcePath, targetName] of files) {
    fs.copyFileSync(sourcePath, path.join(root, targetName));
  }

  const result = {
    backupRoot: root,
    sourceCheck,
    backupCheck,
    dbBytes: fs.statSync(backupDb).size,
    files: fs.readdirSync(root).sort(),
  };
  fs.writeFileSync(path.join(root, 'backup-verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
