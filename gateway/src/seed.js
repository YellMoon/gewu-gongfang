/**
 * 种子数据脚本
 * 初始化模块注册表和权限定义表
 */
const { getDb, initDatabase } = require('./db/database');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

function seed() {
  initDatabase();
  const db = getDb();

  console.log('[Seed] 开始初始化种子数据...');

  // 读取模块配置
  const modules = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config/modules.json'), 'utf-8')
  );

  // 读取权限配置
  const permissionsConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config/permissions.json'), 'utf-8')
  );

  // 插入模块
  const insertModule = db.prepare(`
    INSERT OR REPLACE INTO modules (id, name, description, icon, route_prefix, sort_order, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const mod of modules) {
    insertModule.run(mod.id, mod.name, mod.description, mod.icon, mod.route_prefix, mod.sort_order, mod.status, now);
    console.log(`[Seed] 模块: ${mod.name} (${mod.id})`);
  }

  // 插入权限
  const insertPerm = db.prepare(`
    INSERT OR REPLACE INTO permissions (id, module_id, sub_module, action, description, allowed_types, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [moduleId, config] of Object.entries(permissionsConfig)) {
    for (const perm of config.permissions) {
      const permId = `${moduleId}:${perm.action}`;
      insertPerm.run(
        permId,
        moduleId,
        perm.sub_module,
        perm.action,
        perm.description,
        JSON.stringify(perm.allowed_types),
        perm.action === 'view' ? 1 : 0
      );
      console.log(`[Seed] 权限: ${permId} → ${perm.description}`);
    }
  }

  console.log('[Seed] 种子数据初始化完成');
  console.log(`[Seed] 模块: ${modules.length} 个`);

  // 创建默认管理员
  const adminExists = db.prepare('SELECT id FROM users WHERE user_type = ?').get('admin');
  if (!adminExists) {
    const adminId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, name, user_type, status, created_at, updated_at)
      VALUES (?, '管理员', 'admin', 1, ?, ?)
    `).run(adminId, now, now);
    console.log(`[Seed] 默认管理员已创建: ${adminId}`);
  }
}

seed();
