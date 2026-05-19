const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const ossBaseUrl = (process.env.OSS_CDN_BASE_URL || 'https://gewugongfang.oss-cn-hangzhou.aliyuncs.com/desktop').replace(/\/+$/, '');
const ossObjectPrefix = (process.env.OSS_OBJECT_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '');

// Locate latest Windows installer in dist
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  console.error('Missing dist directory: ' + distDir);
  process.exit(1);
}
const setups = fs.readdirSync(distDir)
  .filter(f => f.endsWith('.exe'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (setups.length === 0) {
  console.error('No .exe installer found in dist');
  process.exit(1);
}
const SETUP_FILE = path.join(distDir, setups[0].name);
console.log('Upload file:', path.basename(SETUP_FILE));

if (dryRun) {
  const fileName = path.basename(SETUP_FILE);
  const objectKey = [ossObjectPrefix, fileName].filter(Boolean).join('/');
  console.log(JSON.stringify({
    dry_run: true,
    target: 'quark',
    file: fileName,
    size: fs.statSync(SETUP_FILE).size,
    oss_key: objectKey,
    oss_url: `${ossBaseUrl}/${encodeURIComponent(fileName)}`,
  }, null, 2));
  process.exit(0);
}

const COOKIE_FILE = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'opencode-quark-cookies.json');
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'opencode-quark-profile');
const today = new Date();
const DATE_FOLDER = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const ROOT_FOLDER = 'codex项目';
const ROOT_FOLDER_ALIASES = ['codex项目', 'Codex项目'];

async function getItemNames(page) {
  return await page.evaluate(() => {
    const nodes = document.querySelectorAll('[class*="filename-text"], [data-node-name]');
    return Array.from(nodes).map(n => (n.textContent || '').trim()).filter(Boolean);
  });
}

async function dblClickByName(page, name) {
  const pos = await page.evaluate((n) => {
    const list = document.querySelectorAll('[class*="filename-text"], [data-node-name]');
    for (const el of list) {
      if ((el.textContent || '').trim() === n) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.x + r.width/2, y: r.y + r.height/2 };
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
    '.ant-btn:has-text("新建文件夹")'
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        const b = await loc.boundingBox();
        if (b) {
          await page.mouse.click(b.x + b.width/2, b.y + b.height/2);
          return true;
        }
      }
    } catch {}
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

async function ensureFolder(page, name, aliases = [name]) {
  const names = await getItemNames(page);
  const existing = aliases.find(alias => names.includes(alias));
  const targetName = existing || name;
  if (!existing) {
    console.log(`Creating folder: ${name}`);
    await createFolder(page, name);
    await page.waitForTimeout(1500);
  }
  // refresh names and enter
  const ok = await dblClickByName(page, targetName);
  if (!ok) throw new Error('Failed to enter folder: ' + targetName);
  await page.waitForTimeout(1200);
}

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  });

  if (fs.existsSync(COOKIE_FILE)) {
    try { await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'))); } catch {}
  }

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('\n[1/4] Open Quark...');
    await page.goto('https://pan.quark.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait up to 3 min for user to be logged in (URL contains /list)
    const t0 = Date.now();
    while (!/\/list/.test(page.url()) && Date.now() - t0 < 180000) {
      await page.waitForTimeout(2000);
    }
    if (!/\/list/.test(page.url())) {
      // Try an explicit wait
      await page.waitForURL('**/list**', { timeout: 60000 }).catch(() => {});
    }
    // Save cookies
    try { fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2)); } catch {}

    console.log('[2/4] Enter folders...');
    // ensure root folder
    await page.waitForTimeout(1500);
    await ensureFolder(page, ROOT_FOLDER, ROOT_FOLDER_ALIASES);
    // ensure date folder
    await ensureFolder(page, DATE_FOLDER);

    console.log('[3/4] Upload file...');
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(SETUP_FILE);

    const basename = path.basename(SETUP_FILE, '.exe');
    const start = Date.now();
    let done = false;
    while (Date.now() - start < 600000) {
      await page.waitForTimeout(5000);
      const list = await getItemNames(page);
      if (list.some(n => n.includes(basename))) { done = true; break; }
    }
    if (!done) console.warn('Upload not confirmed within timeout. Check manually.');
    else console.log('[4/4] Upload completed.');

    const shot = path.join(process.env.TEMP || '.', 'quark-upload.png');
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    console.log('Screenshot:', shot);

  } catch (e) {
    console.error('Uploader error:', e.message);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
})();
