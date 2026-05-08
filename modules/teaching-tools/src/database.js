/**
 * 教学工具模块 — 插件注册数据库
 * 存储从桌面端同步的插件清单，供小程序端查询
 */
const path = require('path');
const Database = require('better-sqlite3');

let db = null;

function getDb() {
  if (db) return db;

  const dbPath = path.join(__dirname, '..', 'data', 'plugin-registry.db');
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initializeSchema();
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_registry (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      version       TEXT NOT NULL,
      type          TEXT NOT NULL DEFAULT 'react-component',
      icon          TEXT,
      description   TEXT,
      author        TEXT,
      entry         TEXT,
      parameters    TEXT,        -- JSON schema
      permissions   TEXT,        -- JSON array
      data_dependencies TEXT,    -- JSON array
      platform      TEXT,        -- JSON object
      registry_url  TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      synced_from   TEXT,        -- 来源桌面端标识
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plugin_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id     TEXT NOT NULL REFERENCES plugin_registry(id),
      version       TEXT NOT NULL,
      parameters    TEXT,
      entry         TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plugin_versions_plugin
      ON plugin_versions(plugin_id);
  `);
}

/**
 * 同步/注册插件（增量更新）
 * 如果 id+version 已存在则跳过，否则插入或更新
 */
function syncPlugin(plugin, source) {
  const d = getDb();

  // 检查是否存在
  const existing = d.prepare('SELECT id, version FROM plugin_registry WHERE id = ?').get(plugin.id);

  if (existing) {
    // 版本不同则更新
    if (existing.version !== plugin.version) {
      // 先备份旧版本
      d.prepare(`
        INSERT INTO plugin_versions (plugin_id, version, parameters, entry)
        VALUES (?, ?, ?, ?)
      `).run(existing.id, existing.version, null, null);

      // 更新
      d.prepare(`
        UPDATE plugin_registry SET
          version = ?,
          name = ?,
          type = ?,
          icon = ?,
          description = ?,
          author = ?,
          entry = ?,
          parameters = ?,
          permissions = ?,
          data_dependencies = ?,
          platform = ?,
          status = 'active',
          synced_from = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        plugin.version,
        plugin.name,
        plugin.type || 'react-component',
        plugin.icon || null,
        plugin.description || null,
        plugin.author || null,
        plugin.entry || null,
        plugin.parameters ? JSON.stringify(plugin.parameters) : null,
        plugin.permissions ? JSON.stringify(plugin.permissions) : null,
        plugin.dataDependencies ? JSON.stringify(plugin.dataDependencies) : null,
        plugin.platform ? JSON.stringify(plugin.platform) : null,
        source || null,
        plugin.id
      );
      return { action: 'updated', id: plugin.id, version: plugin.version };
    }
    return { action: 'skipped', id: plugin.id, version: plugin.version };
  }

  // 新增
  d.prepare(`
    INSERT INTO plugin_registry (id, name, version, type, icon, description, author, entry,
      parameters, permissions, data_dependencies, platform, status, synced_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    plugin.id,
    plugin.name,
    plugin.version,
    plugin.type || 'react-component',
    plugin.icon || null,
    plugin.description || null,
    plugin.author || null,
    plugin.entry || null,
    plugin.parameters ? JSON.stringify(plugin.parameters) : null,
    plugin.permissions ? JSON.stringify(plugin.permissions) : null,
    plugin.dataDependencies ? JSON.stringify(plugin.dataDependencies) : null,
    plugin.platform ? JSON.stringify(plugin.platform) : null,
    source || null
  );
  return { action: 'registered', id: plugin.id, version: plugin.version };
}

/**
 * 批量同步多个插件
 */
function syncPlugins(plugins, source) {
  const results = [];
  for (const plugin of plugins) {
    results.push(syncPlugin(plugin, source));
  }
  return results;
}

/**
 * 获取所有已注册的活跃插件（含完整参数 schema）
 */
function getActiveTools() {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM plugin_registry WHERE status = 'active' ORDER BY name").all();
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    version: row.version,
    type: row.type,
    icon: row.icon,
    description: row.description,
    author: row.author,
    entry: row.entry,
    parameters: row.parameters ? tryParseJson(row.parameters) : null,
    permissions: row.permissions ? tryParseJson(row.permissions) : [],
    dataDependencies: row.data_dependencies ? tryParseJson(row.data_dependencies) : [],
    platform: row.platform ? tryParseJson(row.platform) : { desktop: true, miniprogram: 'none' },
    syncedFrom: row.synced_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * 获取单个插件（含参数 schema）
 */
function getToolById(id) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM plugin_registry WHERE id = ? AND status = 'active'").get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    type: row.type,
    icon: row.icon,
    description: row.description,
    author: row.author,
    entry: row.entry,
    parameters: row.parameters ? tryParseJson(row.parameters) : null,
    permissions: row.permissions ? tryParseJson(row.permissions) : [],
    dataDependencies: row.data_dependencies ? tryParseJson(row.data_dependencies) : [],
    platform: row.platform ? tryParseJson(row.platform) : { desktop: true, miniprogram: 'none' },
    syncedFrom: row.synced_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 删除插件
 */
function removeTool(id) {
  const d = getDb();
  const result = d.prepare("UPDATE plugin_registry SET status = 'removed', updated_at = datetime('now') WHERE id = ?").run(id);
  return result.changes > 0;
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  syncPlugin,
  syncPlugins,
  getActiveTools,
  getToolById,
  removeTool,
  closeDb,
};
