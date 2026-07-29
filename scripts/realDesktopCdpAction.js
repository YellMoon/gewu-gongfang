'use strict';

const { connectRealDesktopPage } = require('./realDesktopCdp');

const cdpPort = Number(process.env.GEWU_REAL_DESKTOP_CDP_PORT || 0);
const encoded = String(process.env.GEWU_REAL_DESKTOP_CDP_EXPRESSION || '');
const actionEncoded = String(process.env.GEWU_REAL_DESKTOP_CDP_ACTION || '');
const profileRoot = String(process.env.GEWU_REAL_DESKTOP_PROFILE_ROOT || '');
if (!Number.isInteger(cdpPort) || cdpPort < 1 || (!encoded && !actionEncoded)) throw new Error('REAL_DESKTOP_CDP_ACTION_INPUT_REQUIRED');

async function targetCenter(page, selector, index = 0, coordinateScale = 1) {
  const expression = `(() => { const item = document.querySelectorAll(${JSON.stringify(selector)})[${Number(index)}]; if (!item) return null; const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null; })()`;
  const center = await page.evaluate(expression);
  if (!center) throw new Error('REAL_DESKTOP_CDP_TARGET_MISSING');
  const scale = Number(coordinateScale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error('REAL_DESKTOP_CDP_COORDINATE_SCALE_INVALID');
  return { x: center.x * scale, y: center.y * scale };
}

async function nativeClick(page, selector, index, coordinateScale) {
  const { x, y } = await targetCenter(page, selector, index, coordinateScale);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function nativeFill(page, selector, value, index, coordinateScale) {
  await nativeClick(page, selector, index, coordinateScale);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.send('Input.insertText', { text: String(value) });
  const current = await page.evaluate(`(() => document.querySelectorAll(${JSON.stringify(selector)})[${Number(index || 0)}]?.value || null)()`);
  if (current !== String(value)) throw new Error('REAL_DESKTOP_CDP_NATIVE_FILL_FAILED');
}

async function nativeWheel(page, action = {}) {
  const x = Number(action.x);
  const y = Number(action.y);
  const deltaY = Number(action.deltaY);
  if (![x, y, deltaY].every(Number.isFinite)) throw new Error('REAL_DESKTOP_CDP_WHEEL_INPUT_INVALID');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: Number(action.deltaX) || 0, deltaY });
}

async function nativeKey(page, action = {}) {
  const key = String(action.key || '');
  const code = String(action.code || '');
  const windowsVirtualKeyCode = Number(action.windowsVirtualKeyCode || 0);
  if (!key || !code || !Number.isInteger(windowsVirtualKeyCode)) throw new Error('REAL_DESKTOP_CDP_KEY_INPUT_INVALID');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}

async function main() {
  let page;
  try {
    page = await connectRealDesktopPage({ cdpPort, profileRoot, timeoutMs: 10_000 });
    process.stderr.write('CDP_ACTION_CONNECTED\n');
  } catch (error) {
    throw error;
  }
  try {
    let value;
    if (actionEncoded) {
      const action = JSON.parse(Buffer.from(actionEncoded, 'base64').toString('utf8'));
      if (action.kind === 'native-fill') await nativeFill(page, action.selector, action.value, action.index, action.coordinateScale);
      else if (action.kind === 'native-click') await nativeClick(page, action.selector, action.index, action.coordinateScale);
      else if (action.kind === 'native-wheel') await nativeWheel(page, action);
      else if (action.kind === 'native-key') await nativeKey(page, action);
      else throw new Error('REAL_DESKTOP_CDP_ACTION_KIND_INVALID');
      value = { action: action.kind, completed: true };
    } else {
      const expression = Buffer.from(encoded, 'base64').toString('utf8');
      value = await page.evaluate(expression);
    }
    process.stderr.write('CDP_ACTION_EVALUATED\n');
    console.log(JSON.stringify({ success: true, value }));
  } catch (error) {
    let pageText = '';
    try {
      pageText = String(await page.evaluate('document.body?.innerText || ""')).replace(/\s+/g, ' ').slice(0, 2000);
    } catch (_snapshotError) { /* retain original action failure */ }
    error.message = `${error.code || error.message || error} PAGE_TEXT=${pageText}`;
    throw error;
  } finally {
    await page.close().catch(() => {});
    process.stderr.write('CDP_ACTION_CLOSED\n');
  }
}

main().catch(error => { console.error(error.stack || error.message || error.code || error); process.exitCode = 1; });
