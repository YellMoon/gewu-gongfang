'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const destinationRoot = process.argv[2];
const expectedRoot = path.resolve('D:\\GewuDataHost\\backups');
const resolvedDestination = path.resolve(destinationRoot || '');
if (!resolvedDestination.startsWith(`${expectedRoot}${path.sep}`)) {
  throw new Error('backup destination is outside the approved host backup root');
}
fs.mkdirSync(resolvedDestination, { recursive: true });

async function backupDatabase(sourcePath, destinationName) {
  if (!fs.existsSync(sourcePath)) throw new Error(`missing database: ${sourcePath}`);
  const destinationPath = path.join(resolvedDestination, destinationName);
  const source = new Database(sourcePath);
  source.pragma('wal_checkpoint(FULL)');
  await source.backup(destinationPath);
  source.close();
  const copy = new Database(destinationPath, { readonly: true });
  const quickCheck = copy.pragma('quick_check', { simple: true });
  copy.close();
  if (quickCheck !== 'ok') throw new Error(`quick_check failed: ${destinationName}`);
  return { name: destinationName, size: fs.statSync(destinationPath).size, quickCheck };
}

(async () => {
  const results = [];
  results.push(await backupDatabase('D:\\GewuDataHost\\data\\scheduling.db', 'scheduling-authoritative.db'));
  const fallback = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'data', 'scheduling.db');
  if (fs.existsSync(fallback)) {
    results.push(await backupDatabase(fallback, 'scheduling-local-fallback.db'));
  }
  console.log(JSON.stringify({ destination: resolvedDestination, databases: results }));
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
