'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { Document, Paragraph, Packer } = require('docx');
const { nativeFormulaComponent } = require('./wordNativeFormula');

(async () => {
  const cases = [
    [String.raw`\frac{kg\cdot m}{s^{2}}`, ['m:f','m:sSup']],
    [String.raw`x_i^2`, ['m:sSubSup']],
    [String.raw`x_i`, ['m:sSub']],
    [String.raw`\sqrt{x}+\sqrt[3]{y}`, ['m:rad','m:deg']],
    [String.raw`\left(\frac{x}{y}\right)`, ['m:d','m:f']],
    [String.raw`\vec{v}+\hat{x}`, ['m:acc']],
    [String.raw`\bar{x}+\dot{x}+\ddot{x}+\tilde{x}+\check{x}+\acute{x}+\grave{x}+\breve{x}`, ['m:acc']],
    [String.raw`\sum_{i=1}^{n}i`, ['m:limLow','m:limUpp']],
    [String.raw`\int_0^1x\,dx`, ['m:sSubSup']],
    [String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, ['m:m','m:mr']],
    [String.raw`\begin{cases}x&x>0\\-x&x<0\end{cases}`, ['m:m']],
    [String.raw`\mathrm{kg}\cdot\mathrm{m}^{-1}\cdot\mathrm{s}^{-2}`, ['m:sSup','m:rPr']],
    [String.raw`\frac{\frac{a}{b}}{c^{d^2}}`, ['m:f','m:sSup']],
    [String.raw`x<y\text{ \& safe }`, ['m:oMath']],
  ];
  for (const [latex,tags] of cases) {
    let component;
    assert.doesNotThrow(()=>{ component=nativeFormulaComponent(latex); },latex);
    const bytes = await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[component]})]}]}));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml').async('string');
    for(const tag of tags) assert.ok(xml.includes(`<${tag}>`),`${latex}: ${tag}`);
    assert.ok(!xml.includes('<w:drawing>'),`${latex}: native equations must not be images`);
    if (latex.includes('safe')) assert.ok(xml.includes('&amp;') && xml.includes('&lt;'));
    if (latex.includes('vec')) {
      assert.ok(xml.includes('m:val="\u20d7"'), 'Word vector accents require a combining arrow');
      assert.ok(xml.includes('m:val="\u0302"'), 'Word hats require a combining circumflex');
    }
  }
  assert.throws(()=>nativeFormulaComponent(String.raw`\unknownnativecommand{x}`));
  assert.throws(()=>nativeFormulaComponent(String.raw`\enclose{circle}{x}`),/cannot be represented safely/);
  assert.throws(()=>nativeFormulaComponent('x'.repeat(32769)),/cannot be represented safely/);
  assert.throws(()=>nativeFormulaComponent(''),/cannot be represented safely/);
  console.log('native Word formula structure checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
