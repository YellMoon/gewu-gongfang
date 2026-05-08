/**
 * 模块加载器
 * 从 modules/ 目录动态加载各功能模块的路由
 */
const fs = require('fs');
const path = require('path');

// 优先: gateway/src/config/../../modules = gateway/../modules
// 备选: process.cwd()/../modules (PM2 cwd=.../gateway 时)
const MODULES_DIR = path.join(__dirname, '../../modules');
const ALT_MODULES_DIR = path.resolve(process.cwd(), '../modules');

function loadModules() {
  const modules = [];

  let modulesDir = MODULES_DIR;
  if (!fs.existsSync(modulesDir)) {
    console.log(`[ModuleLoader] ${modulesDir} 不存在，尝试 ${ALT_MODULES_DIR}`);
    modulesDir = ALT_MODULES_DIR;
  }

  if (!fs.existsSync(modulesDir)) {
    console.log('[ModuleLoader] modules/ 目录不存在，跳过模块加载');
    return modules;
  }

  console.log(`[ModuleLoader] 模块目录: ${modulesDir}`);

  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const moduleDir = path.join(modulesDir, entry.name);
    const manifestPath = path.join(moduleDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.log(`[ModuleLoader] ${entry.name}/manifest.json 不存在，跳过`);
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const routerPath = path.join(moduleDir, manifest.entry || 'src/index.js');

      if (!fs.existsSync(routerPath)) {
        console.log(`[ModuleLoader] ${entry.name} 入口文件不存在: ${routerPath}`);
        continue;
      }

      const router = require(routerPath);
      modules.push({
        id: entry.name,
        routePrefix: manifest.route_prefix,
        router,
        permission: manifest.permission || null
      });

      console.log(`[ModuleLoader] 已加载模块: ${entry.name} → ${manifest.route_prefix}`);
    } catch (err) {
      console.error(`[ModuleLoader] 加载模块 ${entry.name} 失败:`, err.message);
    }
  }

  return modules;
}

module.exports = { loadModules };
