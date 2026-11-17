'use strict';
// UTF-8: browser fixture verifies the production hook and visible menu text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('playwright');

const root = process.cwd();
const out = path.join(root, 'output/playwright/schedule-clipboard');
fs.mkdirSync(out, { recursive: true });
const entry = path.join(out, 'entry.tsx');
fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import useBatchSelection from ${JSON.stringify(path.join(root, 'src/pages/useBatchSelection.tsx'))};
const monday = dayjs('2026-11-16');
const initial = [
  { id: 'a', course_id: 'c', course_name: 'Physics', status: 1, start_time: '2026-11-16 10:00', end_time: '2026-11-16 11:00' },
  { id: 'b', course_id: 'c', course_name: 'Physics', status: 1, start_time: '2026-11-17 11:00', end_time: '2026-11-17 12:00' }
];
function Fixture() {
  const ref = React.useRef(null);
  const [schedules, setSchedules] = React.useState(initial);
  const batch = useBatchSelection(ref, monday, setSchedules, () => {}, () => {});
  React.useEffect(() => { batch.setSchedules(schedules); window.__schedules = schedules; window.__setSchedules = setSchedules; }, [schedules]);
  return <><input aria-label="Text input" defaultValue="ordinary text" />
    <div ref={ref} style={{position:'relative',width:700}}>
      <div data-anchor="true" style={{position:'relative'}}>
      {[0,1].map(week => <div key={week} style={{display:'flex'}}>
        {Array.from({length:7}, (_, column) => {
          const date = monday.add(week * 7 + column, 'day').format('YYYY-MM-DD');
          return <div key={date} data-date={date} style={{width:100,flexShrink:0}}>
            <div data-day-body="true" data-min-start-slot="0" style={{height:480,position:'relative',background:'#fafafa',boxShadow:'inset 0 0 0 1px #ddd'}}>
              {schedules.filter(s => dayjs(s.start_time).format('YYYY-MM-DD') === date).map(s => <div key={s.id} data-course-card="true" style={{position:'absolute',left:4,width:92,top:((dayjs(s.start_time).hour()-8)*60+dayjs(s.start_time).minute())/2,height:30,background:'#bae7ff'}}>{s.course_name}</div>)}
            </div>
          </div>;
        })}
      </div>)}
      {batch.batchVisuals}</div>
    </div></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`, 'utf8');

(async () => {
  await new Promise((resolve, reject) => webpack({
    mode: 'development', devtool: false, entry,
    output: { path: out, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript'), require.resolve('@babel/preset-react')] } } }] },
    optimization: { minimize: false },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? fs.readFileSync(path.join(out, 'bundle.js')) : '<!doctype html><meta charset="utf-8"><title>Schedule clipboard</title><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.__schedules?.length === 2);
    const body = await page.locator('[data-day-body]').first().boundingBox();
    const x = body.x, y = body.y;
    async function select() {
      await page.mouse.move(x + 2, y + 59);
      await page.mouse.down();
      await page.mouse.move(x + 198, y + 121, { steps: 12 });
      await page.mouse.up();
      await page.getByText(/已选 2 节/).waitFor();
    }
    await select();
    await page.mouse.click(x + 30, y + 80, { button: 'right' });
    await page.getByRole('menuitem', { name: '复制课程（Ctrl+C）' }).click();
    await page.mouse.click(x + 350, y + 180, { button: 'right' });
    await page.getByRole('menuitem', { name: '粘贴课程（Ctrl+V）' }).waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, 'paste-menu.png') });
    await page.getByRole('menuitem', { name: '粘贴课程（Ctrl+V）' }).click();
    await page.waitForFunction(() => window.__schedules.length === 4);
    const first = await page.evaluate(() => window.__schedules);
    assert.equal(first[2].start_time, '2026-11-19T06:05:00.000Z');
    assert.equal(first[3].start_time, '2026-11-20T07:05:00.000Z');
    await select();
    await page.keyboard.press('Control+c');
    await page.mouse.move(x + 550, y + 240);
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__schedules.length === 6);
    await page.getByRole('textbox', { name: 'Text input' }).focus();
    await page.keyboard.press('Control+v');
    assert.equal(await page.evaluate(() => window.__schedules.length), 6);
    await page.mouse.move(x + 650, y + 475);
    await page.locator('input').blur();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__schedules.length === 8);
    await page.screenshot({ path: path.join(out, 'pasted.png') });
    await page.evaluate(() => window.__setSchedules([{ id: 'blocked', status: 1, start_time: '2026-11-16 00:00', end_time: '2026-11-30 00:00' }]));
    await page.waitForFunction(() => window.__schedules.length === 1);
    await page.mouse.move(x + 350, y + 180);
    await page.keyboard.press('Control+v');
    await page.getByText('无法放下复制的课程，向左上方调整后仍没有足够空间，请选择其他位置').waitFor();
    assert.equal(await page.evaluate(() => window.__schedules.length), 1);
    assert.deepEqual(errors, []);
    console.log('Schedule clipboard browser checks passed. Evidence: ' + out);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
