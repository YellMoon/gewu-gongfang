const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  console.error('找不到 dist 目录: ' + distDir);
  process.exit(1);
}

const setupFiles = fs.readdirSync(distDir)
  .filter(f => f.endsWith('.exe'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (setupFiles.length === 0) {
  console.error('找不到 Windows 安装包');
  process.exit(1);
}

const SETUP_FILE = path.join(distDir, setupFiles[0].name);
const COOKIE_FILE = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'opencode-quark-cookies.json');
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'opencode-quark-profile');
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const ROOT_FOLDER = 'opencode项目';

console.log(`文件: ${path.basename(SETUP_FILE)} (${(fs.statSync(SETUP_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`目标目录: ${ROOT_FOLDER}/${TODAY}`);

async function getNames(page) {
  return await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="filename-text"], [data-node-name]');
    return Array.from(els).map(el => (el.textContent || '').trim()).filter(Boolean);
  });
}

async function dblClickName(page, name) {
  const pos = await page.evaluate((targetName) => {
    const els = document.querySelectorAll('[class*="filename-text"], [data-node-name]');
    for (const el of els) {
      if ((el.textContent || '').trim() === targetName) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
    }
    return null;
  }, name);
  if (!pos) return false;
  await page.mouse.dblclick(pos.x, pos.y);
  await page.waitForTimeout(700);
  return true;
}

async function clickNewFolder(page) {
  const candidates = [
    '[class*="create-folder"]',
    'button:has-text("新建文件夹")',
    'div:has-text("新建文件夹")',
    '.ant-btn:has-text("新建文件夹")',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
        const box = await locator.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          return true;
        }
      }
    } catch {
      // Try the next selector.
    }
  }
  return false;
}

async function createFolder(page, name) {
  if (!await clickNewFolder(page)) return false;
  const input = page.locator('.ant-input.input-edit, input[class*="input-edit"]').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name, { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  return true;
}

async function ensureFolder(page, name) {
  let names = await getNames(page);
  if (!names.includes(name)) {
    console.log(`创建文件夹: ${name}`);
    await createFolder(page, name);
    await page.waitForTimeout(1500);
    names = await getNames(page);
  }
  if (!names.includes(name)) {
    throw new Error(`创建后仍未找到文件夹: ${name}`);
  }
  if (!await dblClickName(page, name)) {
    throw new Error(`无法进入文件夹: ${name}`);
  }
  await page.waitForTimeout(1200);
}

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });

  if (fs.existsSync(COOKIE_FILE)) {
    try {
      await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8')));
    } catch {
      // Cookie 读取失败时继续走页面登录。
    }
  }

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('\n[1/4] 打开夸克网盘...');
    await page.goto('https://pan.quark.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const startLogin = Date.now();
    while (!/\/list/.test(page.url()) && Date.now() - startLogin < 180000) {
      await page.waitForTimeout(2000);
    }
    if (!/\/list/.test(page.url())) {
      await page.waitForURL('**/list**', { timeout: 60000 }).catch(() => {});
    }
    try {
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
    } catch {
      // Cookie 保存失败不影响上传流程。
    }

    console.log('[2/4] 进入目标目录...');
    await page.waitForTimeout(1500);
    await ensureFolder(page, ROOT_FOLDER);
    await ensureFolder(page, TODAY);

    console.log('[3/4] 上传安装包...');
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(SETUP_FILE);

    const basename = path.basename(SETUP_FILE, '.exe');
    const startUpload = Date.now();
    let done = false;
    while (Date.now() - startUpload < 600000) {
      await page.waitForTimeout(5000);
      const list = await getNames(page);
      if (list.some(name => name.includes(basename))) {
        done = true;
        break;
      }
    }

    if (!done) {
      console.warn('上传未在超时时间内确认，请手动检查夸克网盘。');
    } else {
      console.log('[4/4] 上传完成。');
    }

    const screenshotPath = path.join(process.env.TEMP || '.', 'quark-upload-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    console.log(`截图已保存: ${screenshotPath}`);
  } catch (err) {
    console.error('上传脚本错误:', err.message);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
})();
