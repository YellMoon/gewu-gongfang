/**
 * 教学工具插件注册中心初始化脚本
 * 运行：node scripts/sync-plugins-to-server.js
 *
 * 将桌面端内置教学工具插件同步到服务端注册中心
 * 这样小程序端通过 GET /api/teaching-tools/tools 就能获取到工具列表
 */
const path = require('path');
const fs = require('fs');

// 加载服务端数据库
const db = require('../modules/teaching-tools/src/database');

// 内置插件 manifest 路径
const PLUGIN_DIRS = [
  'performance-analysis',
  'knowledge-distribution',
  'wave-demo',
];

const builtinManifests = PLUGIN_DIRS.map(dir => {
  const manifestPath = path.join(__dirname, '..', 'src', 'teaching-tools', dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn(`[WARN] 未找到插件清单: ${manifestPath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}).filter(Boolean);

console.log(`\n📦 发现 ${builtinManifests.length} 个内置教学工具插件:\n`);
builtinManifests.forEach(m => {
  console.log(`  - ${m.name} (${m.id}) v${m.version} [${m.type}]`);
  if (m.parameters?.properties) {
    const paramCount = Object.keys(m.parameters.properties).length;
    console.log(`    参数: ${paramCount} 个`);
  }
  if (m.platform) {
    const mp = m.platform.miniprogram || 'none';
    console.log(`    小程序兼容: ${mp}`);
  }
  console.log();
});

// 同步到服务端
const results = db.syncPlugins(builtinManifests, 'desktop-builtin');
console.log('=== 同步结果 ===');
console.log(`  新增: ${results.filter(r => r.action === 'registered').length}`);
console.log(`  更新: ${results.filter(r => r.action === 'updated').length}`);
console.log(`  跳过: ${results.filter(r => r.action === 'skipped').length}`);
console.log();

// 验证
const activeTools = db.getActiveTools();
console.log(`=== 服务端注册中心当前有 ${activeTools.length} 个活跃工具 ===\n`);
activeTools.forEach(t => {
  const mpMode = t.platform?.miniprogram || 'none';
  const hasSchema = t.parameters ? '✅ 有参数 schema' : '⚠️ 无参数 schema';
  console.log(`  ${t.name} (${t.id}) v${t.version} | ${hasSchema} | 小程序: ${mpMode}`);
});

console.log('\n✅ 同步完成');
db.closeDb();
