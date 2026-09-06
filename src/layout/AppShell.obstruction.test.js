'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const css = fs.readFileSync(path.join(__dirname,'../index.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const basketCss = fs.readFileSync(path.join(__dirname,'../components/QuestionBasket.css'),'utf8');
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [1200,1536]) {
      const page = await browser.newPage({viewport:{width,height:800}});
      await page.setContent(`<style>${css}\n${basketCss}</style><div class="app-shell app-shell--nav-pinned"><aside class="app-shell__sider app-shell__sider--open"><div class="app-shell__brand"><span class="app-shell__brand-mark">G</span></div></aside><main class="app-shell__main"><div class="app-shell__topbar">Library</div><section class="app-shell__content"><article style="height:1600px;background:white"><button id="action" style="float:right">Add</button></article><button class="question-basket-float">Basket</button></section></main></div>`);
      const result = await page.evaluate(() => {
        const sider=document.querySelector('.app-shell__sider');
        sider.scrollLeft=30;
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        return {scrollLeft:sider.scrollLeft,brandLeft:rect('.app-shell__brand-mark').left,actionRight:rect('#action').right,basketLeft:rect('.question-basket-float').left};
      });
      assert.equal(result.scrollLeft,0,'decorative sidebar overflow must not scroll/crop its contents');
      assert(result.brandLeft>=0);
      assert(result.actionRight+12<=result.basketLeft,'floating basket needs a clear lane outside page actions');
      await page.locator('.question-basket-float').evaluate(element=>element.remove());
      assert.equal(await page.locator('.app-shell__content').evaluate(element=>getComputedStyle(element).paddingRight),'18px','non-question pages must not inherit an empty basket lane');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('application shell obstruction browser checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
