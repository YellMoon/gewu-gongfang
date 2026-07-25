'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const configPath = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'gewugongfang.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const db = new Database(config.mainDbPath, { readonly: true });
const result = {
  nodeRole: config.nodeRole,
  deviceId: config.deviceId,
  primaryHostGeneration: config.primaryHostGeneration ?? null,
  mainDbPath: config.mainDbPath,
  questionBankPath: config.questionBankPath,
  questionBankStoreId: config.questionBankStoreId,
  databaseExists: fs.existsSync(config.mainDbPath),
  questionBankExists: fs.existsSync(config.questionBankPath),
  quickCheck: db.pragma('quick_check', { simple: true }),
  userVersion: db.pragma('user_version', { simple: true }),
  taxonomySystemCount: db.prepare('SELECT COUNT(*) AS count FROM taxonomy_systems').get().count,
};
db.close();
console.log(JSON.stringify(result));
