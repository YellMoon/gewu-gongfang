'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('playwright');
const { load, tableHtml } = require('./QuestionFormulaContent.test.js');
const root = path.resolve(__dirname, '../..');
const Renderer = load('QuestionRenderer.tsx').default;
const Viewer = load('StructuredQuestionViewer.tsx').default;
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = content => ({ type: 'doc', content });
const row = values => ({ type: 'tableRow', content: values.map(text => ({type:'tableCell',content:[paragraph(text)]})) });
const columns = Array.from({length:12}, (_, i) => `测量值${i + 1}`);
const structured = renderToStaticMarkup(React.createElement(Viewer, {value:{sections:{
  stem:doc([{type:'table',content:[row(columns),row(columns.map((_,i) => String(i + 1)))]}]),
  answer:doc([]),analysis:doc([]),options:[],subQuestions:[],
}}}));
const wideHtml = `<table><tr>${columns.map(text => `<th>${text}</th>`).join('')}</tr><tr>${columns.map((_,i) => `<td>${i + 1}</td>`).join('')}</tr></table>`;
const legacy = renderToStaticMarkup(React.createElement(Renderer, {content:wideHtml}));
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:900}});
    const output = path.join(root,'output','playwright','question-tables-20261001');
    fs.mkdirSync(output,{recursive:true});
    await page.setContent(`<main style="max-width:900px;margin:20px auto"><h2>题库表格显示验证</h2><div id="sections">${tableHtml}</div><h3>HTML 宽表格</h3><div id="legacy">${legacy}</div><h3>结构化宽表格</h3><div id="structured">${structured}</div></main>`);
    for (const file of ['node_modules/katex/dist/katex.min.css','src/index.css','src/components/QuestionRenderer.css','src/components/StructuredQuestionViewer.css'])
      await page.addStyleTag({path:path.join(root,file)});
    for (const width of [1100,420]) {
      await page.setViewportSize({width,height:900});
      const metrics = await page.evaluate(() => {
        const wide = ['legacy','structured'].map(id => {
          const wrapper = document.querySelector(`#${id} .question-table-scroll`);
          const table = wrapper.querySelector('table');
          const cell = table.querySelector('td');
          wrapper.scrollLeft = wrapper.scrollWidth;
          return {id,width:wrapper.clientWidth,scrollWidth:wrapper.scrollWidth,scrollLeft:wrapper.scrollLeft,
            border:getComputedStyle(cell).borderTopStyle,rows:table.rows.length,cells:table.rows[0].cells.length,
            overflow:getComputedStyle(wrapper).overflowX};
        });
        return {wide,pageWidth:document.documentElement.clientWidth,bodyWidth:document.documentElement.scrollWidth,
          extraBreaks:document.querySelectorAll('.question-table-scroll > br').length};
      });
      assert.equal(metrics.extraBreaks,0);
      assert(metrics.bodyWidth <= metrics.pageWidth + 1,'wide data tables must not widen the page');
      for (const table of metrics.wide) {
        assert.equal(table.border,'solid'); assert.equal(table.rows,2); assert.equal(table.cells,12);
        assert.equal(table.overflow,'auto');
        if(width===420) assert(table.scrollLeft>0 && table.scrollWidth>table.width,'all columns remain reachable by horizontal scrolling');
      }
      await page.screenshot({path:path.join(output,`tables-${width}.png`),fullPage:true});
      fs.writeFileSync(path.join(output,`metrics-${width}.json`),JSON.stringify(metrics,null,2));
    }
    console.log('Question tables browser checks passed at 1100px and 420px; screenshots saved in '+output);
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
