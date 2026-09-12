'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { Document, Paragraph, Packer } = require('docx');
const { nativeFormulaComponent } = require('./wordNativeFormula');

(async () => {
  const cases = [
    [String.raw`\frac{kg\cdot m}{s^{2}}`, ['m:f','m:sSup']],
    [String.raw`x_i^2`, ['m:sSubSup']],
    [String.raw`\frac{T_{1}^{2}}{R^{3}}=\frac{T_{2}^{2}}{\left(2R)^{3}\right.}`, ['m:f', 'm:sSubSup']],
    [String.raw`\frac{1}{2}Mu_{1}^{2}=\frac{1}{2}M{u^{'}}_{1}^{2}+\frac{1}{2}Mu_{2}^{2}`, ['m:f', 'm:sSubSup']],
    [String.raw`\frac{1}{2}mv_{1}^{2}=\frac{1}{2}mv_{2}^{2}+\frac{1}{2}M{u^{'}}_{2}^{2}`, ['m:f', 'm:sSubSup']],
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
  assert.throws(()=>nativeFormulaComponent(String.raw`\left(2R)^{3}\right `), /cannot be represented safely/,
    'invalid imported delimiters must be repaired at the source, not silently guessed during export');
  assert.throws(()=>nativeFormulaComponent(String.raw`u^{'}_{1}^{2}`), /cannot be represented safely/,
    'ambiguous double superscripts must not be hidden by a raster fallback');
  assert.throws(()=>nativeFormulaComponent(String.raw`\enclose{circle}{x}`),/cannot be represented safely/);
  assert.throws(()=>nativeFormulaComponent('x'.repeat(32769)),/cannot be represented safely/);
  assert.throws(()=>nativeFormulaComponent(''),/cannot be represented safely/);
  console.log('native Word formula structure checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
