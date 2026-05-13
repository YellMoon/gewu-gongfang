const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 鑷姩鎵炬渶鏂扮紪璇戠殑瀹夎鍖咃紙鎸夋枃浠朵慨鏀规椂闂达級
const distDir = path.join('C:', 'Users', '83423', '.openclaw', 'workspace', 'scheduling-system', 'dist');
const setupFiles = fs.readdirSync(distDir)
  .filter(f => f.startsWith('鏍肩墿宸ュ潑 Setup') && f.endsWith('.exe'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (setupFiles.length === 0) { console.error('鎵句笉鍒板畨瑁呭寘'); process.exit(1); }
const SETUP_FILE = path.join(distDir, setupFiles[0].name);
const COOKIE_FILE = path.join(process.env.LOCALAPPDATA, 'opencode-quark-cookies.json');
const now = new Date();
const TODAY = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

if (!fs.existsSync(SETUP_FILE)) { console.error('鎵句笉鍒? ' + SETUP_FILE); process.exit(1); }
console.log(`鏂囦欢: ${path.basename(SETUP_FILE)} (${(fs.statSync(SETUP_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`褰撴棩鏂囦欢澶? ${TODAY}`);

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
  const btn = page.locator('[class*="create-folder"], button:has-text("鏂板缓鏂囦欢澶?), .ant-btn:has-text("鏂板缓鏂囦欢澶?)').first();
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
  console.log(`  杈撳叆: "${await editInput.inputValue()}"`);
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
    console.log('\n=== 1. 鐧诲綍 ===');
    await page.goto('https://pan.quark.cn/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    if (!page.url().includes('/list')) {
      console.log('绛夊緟鐧诲綍...');
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        await page.waitForTimeout(2000);
        const btn = page.locator('button:has-text("纭鐧诲綍"), div:has-text("纭鐧诲綍"), span:has-text("纭鐧诲綍")').first();
        try { if (await btn.isVisible({ timeout: 500 }).catch(() => false)) { const bb = await btn.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); } } catch (e) {}
        if (page.url().includes('/list')) break;
      }
      if (!page.url().includes('/list')) { await page.waitForURL('**/list**', { timeout: 60000 }).catch(() => {}); }
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
      console.log('鐧诲綍鎬佸凡淇濆瓨');
    } else { console.log('已创建'); }
    await page.waitForTimeout(2000);

    console.log('\n=== 2. 杩涘叆 Codex项目 ===');
    let names = await getNames(page);
    if (!names.includes('Codex项目')) {
      console.log('"Codex项目" 涓嶅瓨鍦紝鍒涘缓...');
      await createAndRenameFolder(page, 'Codex项目');
      await page.waitForTimeout(3000);
      names = await getNames(page);
      if (!names.includes('Codex项目')) {
        console.log('  ! 鍒涘缓澶辫触锛屾墜鍔ㄧ瓑30绉?..');
        await page.waitForTimeout(30000);
      } else { console.log('  已宸插垱寤?); }
    }
    for (const f of ['Codex项目']) {
      console.log(`杩涘叆: ${f}`);
      await page.waitForTimeout(1500);
      await dblClickName(page, f);
      console.log('  褰撳墠URL: ' + page.url());
      console.log('  OK'); await page.waitForTimeout(2500);
    }

    console.log(`\n=== 3. 妫€鏌?"${TODAY}" ===`);
    await page.waitForTimeout(2000);
    names = await getNames(page);
    const folders = names.filter(n => /^\d{4}-\d{1,2}-\d{1,2}$/.test(n));
    console.log(`${folders.length} 涓棩鏈熸枃浠跺す: ${folders.join(', ')}`);

    if (!names.includes(TODAY)) {
      console.log(`"${TODAY}" 涓嶅瓨鍦紝鍒涘缓...`);
      await createAndRenameFolder(page, TODAY);
      await page.waitForTimeout(2000);
      names = await getNames(page);
      if (!names.includes(TODAY)) {
        console.log('  ! 鍒涘缓鍚庢湭妫€娴嬪埌锛屾墜鍔ㄧ瓑30绉?..');
        await page.waitForTimeout(30000);
        names = await getNames(page);
      }
      console.log(`  ${names.includes(TODAY) ? '已宸插垱寤? : '已鍒涘缓澶辫触'}`);
    } else {
      console.log('宸插瓨鍦?);
    }

    console.log(`\n=== 4. 杩涘叆 "${TODAY}" ===`);
    await page.waitForTimeout(1500);
    names = await getNames(page);
    if (!names.includes(TODAY)) {
      console.log(`  ! 涓嶅湪褰撳墠鐩綍锛屽彇娑堜笂浼燻);
      await page.waitForTimeout(10000);
      process.exit(1);
    }
    if (!(await dblClickName(page, TODAY))) {
      console.log('  ! 鏃犳硶杩涘叆');
      process.exit(1);
    }
    console.log('  OK');
    await page.waitForTimeout(2000);

    console.log('\n=== 5. 涓婁紶 ===');
    console.log(`  ${path.basename(SETUP_FILE)}`);
    const fi = page.locator('input[type="file"]').first();
    await fi.setInputFiles(SETUP_FILE);
    console.log('  宸叉彁浜わ紝绛夊緟瀹屾垚...');

    const base = path.basename(SETUP_FILE, '.exe');
    const start = Date.now();
    let done = false;
    while (Date.now() - start < 600000) {
      await page.waitForTimeout(5000);
      const list = await getNames(page);
      if (list.some(n => n.includes(base))) {
        await page.waitForTimeout(5000);
        console.log('  已涓婁紶瀹屾垚');
        console.log('  褰撳墠鐩綍鏂囦欢鍒楄〃: ' + list.join(', '));
        done = true;
        break;
      }
    }
    if (!done) { console.log('  ! 瓒呮椂'); }

    // 鎴浘纭
    const screenshotPath = path.join(process.env.TEMP || '/tmp', 'quark-upload-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  鎴浘宸蹭繚瀛? ${screenshotPath}`);

    console.log('\n===== 瀹屾垚 =====');
    await page.waitForTimeout(5000);

  } catch (e) {
    console.error('閿欒:', e.message);
  } finally {
    await context.close();
  }
})();



