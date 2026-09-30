'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const component = path.join(__dirname, 'NumberedTable.tsx');
const code = fs.existsSync(component) ? ts.transpileModule(fs.readFileSync(component, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText : 'module.exports.default = require("antd").Table';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    for (const file of ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js', 'dayjs/dayjs.min.js', 'antd/dist/antd.min.js'])
      await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
    await page.evaluate(code => {
      const module = { exports: {} };
      new Function('require', 'module', 'exports', code)(name => name === 'react' ? window.React : window.antd, module, module.exports);
      const Table = module.exports.default;
      const h = window.React.createElement;
      const mount = window.ReactDOM.createRoot(document.getElementById('root'));
      const allRows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, name: `课程${i + 1}`, group: i % 2 ? 'B' : 'A' }));
      window.events = [];
      window.renderTable = (pagination, count = 45, selection = false) => mount.render(h(Table, {
        key: JSON.stringify([pagination, selection]), rowKey: 'id', dataSource: allRows.slice(0, count),
        columns: [{ title: '课程', dataIndex: 'name', sorter: (a, b) => b.id - a.id },
          { title: '分组', dataIndex: 'group', filters: [{ text: 'A', value: 'A' }], onFilter: (value, row) => row.group === value }],
        pagination, rowSelection: selection ? {} : undefined, scroll: { x: 700 },
        onChange: (pagination, filters, sorter, extra) => window.events.push(extra.action),
      }));
      function ServerTable() {
        const [pagination, setPagination] = window.React.useState({ current: 1, pageSize: 20 });
        return h(Table, { rowKey: 'id', columns: [{ title: '课程', dataIndex: 'name' }],
          dataSource: allRows.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
          pagination: { ...pagination, total: allRows.length, showSizeChanger: true, pageSizeOptions: [10, 20, 50] },
          onChange: next => setPagination({ current: next.current, pageSize: next.pageSize }),
        });
      }
      window.renderServerTable = () => mount.render(h(ServerTable));
      window.renderFilteredTable = (count = 45, defaults = false) => mount.render(h(Table, {
        key: defaults ? 'initial-filter' : 'replaced-filter', rowKey: 'id', dataSource: allRows.slice(0, count),
        columns: [{ title: '课程', dataIndex: 'name' }, { title: '分组', dataIndex: 'group',
          filters: [{ text: 'A', value: 'A' }], defaultFilteredValue: defaults ? ['A'] : undefined,
          onFilter: (value, row) => row.group === value }],
        pagination: { defaultCurrent: defaults ? 3 : 1, pageSize: 10 },
      }));
      window.renderTable({ defaultPageSize: 20, showSizeChanger: true });
    }, code);
    const firstNumber = () => page.locator('tbody tr.ant-table-row td.ant-table-cell').first().innerText();
    await page.locator('tbody tr.ant-table-row').first().waitFor();
    assert.equal(await firstNumber(), '1', 'first column numbers records');
    await page.locator('.ant-pagination-item-2').click();
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '21');
    assert.equal(await firstNumber(), '21');
    await page.getByRole('columnheader', { name: '课程' }).click();
    assert.equal(await firstNumber(), '21', 'sorting retains page offset');
    assert.match(await page.locator('tbody tr.ant-table-row').first().innerText(), /课程25/);
    await page.locator('.ant-table-filter-trigger').first().click();
    await page.getByRole('menuitem', { name: 'A' }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '1');
    assert.equal(await firstNumber(), '1', 'filter resets numbering with pagination');
    assert.deepEqual(await page.evaluate(() => window.events), ['paginate', 'sort', 'filter']);
    await page.evaluate(() => window.renderTable({ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }));
    await page.locator('.ant-pagination-item-2').click();
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '21');
    await page.locator('.ant-pagination-options .ant-select').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '10 / page' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr.ant-table-row').length === 10);
    assert.equal(await firstNumber(), '11', 'page size changes retain AntD current page and recalculate offset');
    await page.evaluate(() => window.renderTable({ current: 3, pageSize: 20 }));
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '41');
    await page.evaluate(() => window.renderTable({ current: 3, pageSize: 20 }, 3));
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '1');
    await page.evaluate(() => window.renderTable({ defaultCurrent: 2, defaultPageSize: 10 }));
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '11');
    await page.evaluate(() => window.renderTable(false));
    await page.waitForFunction(() => document.querySelectorAll('tbody tr.ant-table-row').length === 45);
    assert.equal(await firstNumber(), '1');
    assert.equal(await page.locator('tbody tr.ant-table-row').last().locator('td').first().innerText(), '45');
    await page.evaluate(() => window.renderTable({ pageSize: 20 }, 45, true));
    await page.locator('tbody tr.ant-table-row .ant-checkbox-input').first().check();
    assert.equal(await page.locator('tbody tr.ant-table-row-selected').count(), 1, 'row selection remains available');
    assert.equal(await page.locator('tbody tr.ant-table-row').first().locator('td').nth(1).innerText(), '1');
    const output = path.join(root, 'output/list-numbering-20260930');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop-numbered-table.png'), fullPage: true });
    await page.evaluate(() => window.renderServerTable());
    await page.locator('.ant-pagination-item-2').click();
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '21');
    assert.equal(await page.locator('tbody tr.ant-table-row').count(), 20, 'server pagination does not slice the current page twice');
    assert.match(await page.locator('tbody tr.ant-table-row').first().innerText(), /课程21/);
    await page.screenshot({ path: path.join(output, 'desktop-server-page-2.png'), fullPage: true });
    await page.locator('.ant-pagination-options .ant-select').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '10 / page' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr.ant-table-row').length === 10);
    assert.equal(await firstNumber(), '11', 'controlled server page size changes use the new offset');
    assert.match(await page.locator('tbody tr.ant-table-row').first().innerText(), /课程11/);
    await page.evaluate(() => window.renderFilteredTable(25, true));
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td:nth-child(2)').textContent === '课程21');
    const initialFilteredNumber = await firstNumber();
    await page.evaluate(() => window.renderFilteredTable());
    await page.locator('.ant-table-filter-trigger').first().click();
    await page.getByRole('menuitem', { name: 'A' }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.locator('.ant-pagination-item-3').click();
    await page.waitForFunction(() => document.querySelector('tbody tr.ant-table-row td').textContent === '21');
    await page.evaluate(() => window.renderFilteredTable(11));
    await page.waitForFunction(() => document.querySelectorAll('tbody tr.ant-table-row').length === 6);
    assert.deepEqual([initialFilteredNumber, await firstNumber()], ['11', '1'], 'initial and retained filters clamp the row number with the filtered result count');
    assert.deepEqual(errors, []);
    console.log('NumberedTable real AntD browser pagination, sorting, filtering, clamping and selection passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

