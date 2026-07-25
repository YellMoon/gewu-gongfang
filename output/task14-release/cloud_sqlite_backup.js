const path = require('path');
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('usage: cloud_sqlite_backup.js <source> <target>');

async function main() {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(target);
  } finally {
    database.close();
  }
  const backup = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const result = backup.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`SQLite quick_check failed: ${result}`);
  } finally {
    backup.close();
  }
  console.log('sqlite backup quick_check ok');
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
