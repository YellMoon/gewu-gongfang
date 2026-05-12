const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 自动找最新编译的安装包（按文件修改时间）
const distDir = path.join('C:', 'Users', '83423', '.openclaw', 'workspace', 'scheduling-system', 'dist');
const setupFiles = fs.readdirSync(distDir)
  .filter(f => f.startsWith('格物工坊 Setup') && f.endsWith('.exe'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (setupFiles.length === 0) { console.error('找不到安装包'); process.exit(1); }
const SETUP_FILE = path.join(distDir, setupFiles[0].name);
const COOKIE_FILE = path.join(process.env.LOCALAPPDATA, 'opencode-quark-cookies.json');
const now = new Date();
const TODAY = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

if (!fs.existsSync(SETUP_FILE)) { console.error('找不到: ' + SETUP_FILE); process.exit(1); }
console.log(`文件: ${path.basename(SETUP_FILE)} (${(fs.statSync(SETUP_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`当日文件夹: ${TODAY}`);

async function getNames(page) {
  return await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="filename-text"]');
    return Array.from(els).map(el => el.textContent.trim()).filter(n => n);
  });
}

async function dblClickName(page, name) {
  const pos = await page.evaluate((n) => {
    const els = document.querySelectorAll('[class*="filename-text"]');
    for (const el of els) {
      if (el.textContent.trim() === n) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, name);
  if (!pos) return false;
  await page.mouse.dblclick(pos.x, pos.y);
  await page.waitForTimeout(500);
  return true;
}

async function createAndRenameFolder(page, name) {
  const btn = page.locator('[class*="create-folder"], button:has-text("新建文件夹"), .ant-btn:has-text("新建文件夹")').first();
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  const b = await btn.boundingBox();
  if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(1000);

  const editInput = page.locator('.ant-input.input-edit, input[class*="input-edit"]').first();
  await editInput.waitFor({ state: 'visible', timeout: 5000 });
  await editInput.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
  await page.keyboard.type(name, { delay: 50 });
  await page.waitForTimeout(300);
  console.log(`  输入: "${await editInput.inputValue()}"`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  return true;
}

(async () => {
  const context = await chromium.launchPersistentContext(
    path.join(process.env.LOCALAPPDATA, 'opencode-quark-profile'),
    { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null }
  );

  if (fs.existsSync(COOKIE_FILE)) {
    try { await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'))); } catch (e) {}
  }

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('\n=== 1. 登录 ===');
    await page.goto('https://pan.quark.cn/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    if (!page.url().includes('/list')) {
      console.log('等待登录...');
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        await page.waitForTimeout(2000);
        const btn = page.locator('button:has-text("确认登录"), div:has-text("确认登录"), span:has-text("确认登录")').first();
        try { if (await btn.isVisible({ timeout: 500 }).catch(() => false)) { const bb = await btn.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); } } catch (e) {}
        if (page.url().includes('/list')) break;
      }
      if (!page.url().includes('/list')) { await page.waitForURL('**/list**', { timeout: 60000 }).catch(() => {}); }
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
      console.log('登录态已保存');
    } else { console.log('已登录 (cookie)'); }
    await page.waitForTimeout(2000);

    console.log('\n=== 2. 进入 opencode项目 ===');
    let names = await getNames(page);
    if (!names.includes('opencode项目')) {
      console.log('"opencode项目" 不存在，创建...');
      await createAndRenameFolder(page, 'opencode项目');
      await page.waitForTimeout(3000);
      names = await getNames(page);
      if (!names.includes('opencode项目')) {
        console.log('  ! 创建失败，手动等30秒...');
        await page.waitForTimeout(30000);
      } else { console.log('  ✓ 已创建'); }
    }
    for (const f of ['opencode项目']) {
      console.log(`进入: ${f}`);
      await page.waitForTimeout(1500);
      await dblClickName(page, f);
      console.log('  OK'); await page.waitForTimeout(2500);
    }

    console.log(`\n=== 3. 检查 "${TODAY}" ===`);
    await page.waitForTimeout(2000);
    names = await getNames(page);
    const folders = names.filter(n => /^\d{4}-\d{1,2}-\d{1,2}$/.test(n));
    console.log(`${folders.length} 个日期文件夹: ${folders.join(', ')}`);

    if (!names.includes(TODAY)) {
      console.log(`"${TODAY}" 不存在，创建...`);
      await createAndRenameFolder(page, TODAY);
      await page.waitForTimeout(2000);
      names = await getNames(page);
      if (!names.includes(TODAY)) {
        console.log('  ! 创建后未检测到，手动等30秒...');
        await page.waitForTimeout(30000);
        names = await getNames(page);
      }
      console.log(`  ${names.includes(TODAY) ? '✓ 已创建' : '✗ 创建失败'}`);
    } else {
      console.log('已存在');
    }

    console.log(`\n=== 4. 进入 "${TODAY}" ===`);
    await page.waitForTimeout(1500);
    names = await getNames(page);
    if (!names.includes(TODAY)) {
      console.log(`  ! 不在当前目录，取消上传`);
      await page.waitForTimeout(10000);
      process.exit(1);
    }
    if (!(await dblClickName(page, TODAY))) {
      console.log('  ! 无法进入');
      process.exit(1);
    }
    console.log('  OK');
    await page.waitForTimeout(2000);

    console.log('\n=== 5. 上传 ===');
    console.log(`  ${path.basename(SETUP_FILE)}`);
    const fi = page.locator('input[type="file"]').first();
    await fi.setInputFiles(SETUP_FILE);
    console.log('  已提交，等待完成...');

    const base = path.basename(SETUP_FILE, '.exe');
    const start = Date.now();
    let done = false;
    while (Date.now() - start < 600000) {
      await page.waitForTimeout(5000);
      const list = await getNames(page);
      if (list.some(n => n.includes(base))) {
        await page.waitForTimeout(5000);
        console.log('  ✓ 上传完成');
        done = true;
        break;
      }
    }
    if (!done) { console.log('  ! 超时'); }

    console.log('\n===== 完成 =====');
    await page.waitForTimeout(5000);

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await context.close();
  }
})();
