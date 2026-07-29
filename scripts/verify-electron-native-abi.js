'use strict';

const Database = require('better-sqlite3');

const db = new Database(':memory:');
try {
  db.prepare('SELECT 1 AS ok').get();
  console.log(`electron native ABI verified: ${process.versions.modules}`);
} finally {
  db.close();
}
