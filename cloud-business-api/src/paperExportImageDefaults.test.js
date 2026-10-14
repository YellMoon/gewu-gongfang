'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const sharp = require('sharp');
const { renderPaperExport } = require('./paperExportRenderer');
const { questionXml } = require('./paperExportTestContent');
const { paperImageSize } = require('./paperImageSize');

async function verifyImageDefaults() {
  for (const [width, height, displayWidth, displayHeight, expected] of [
    [1200, 600, undefined, undefined, [420, 210]],
    [1200, 600, 800, 100, [200, 100]],
    [600, 1200, 100, 800, [100, 200]],
    [600, 1200, undefined, undefined, [140, 280]],
    [80, 40, 800, 400, [80, 40]],
    [1200, 600, 160, undefined, [160, 80]],
    [1200, 600, undefined, 80, [160, 80]],
  ]) assert.deepEqual(paperImageSize({ width, height, displayWidth, displayHeight }), { width: expected[0], height: expected[1] });

  const assetKey = 'a'.repeat(64);
  const bytes = await sharp(Buffer.from('<svg width="1200" height="600"><rect width="1200" height="600" fill="white" stroke="black" stroke-width="12"/><circle cx="300" cy="300" r="200" fill="none" stroke="#237480" stroke-width="12"/><rect x="650" y="100" width="400" height="400" fill="none" stroke="#237480" stroke-width="12"/></svg>', 'utf8')).png().toBuffer();
  const assets = [{ assetKey, fileName: 'diagram.png', mimeType: 'image/png' }];
  const doc = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const text = value => ({ type: 'text', text: value });
  const input = { title: '试题图片与选项排版校验', answerPosition: 'end', snapshot: [
    { id: 'legacy', stem: '选择题：下图中的圆和正方形应保持原比例，图片位于选项前。', options: ['A. 圆形', 'B． 正方形', { label: 'C', content: '  矩形' }, { label: 'D．', content: '以上均是' }], assets },
    { id: 'structured', stem: '有位置的图片', options: [], assets, richContent: { version: 1, type: 'question-document', sections: {
      stem: doc(text('题干前半段'), { type: 'image', attrs: { assetKey, width: 800, height: 100 } }, text('题干后半段')),
      options: [], subQuestions: [{ label: '(1)', content: doc(text('求解第一小题')) }],
    } } },
  ] };
  const resolveQuestionAsset = async () => bytes;
  const word = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset });
  const xml = await questionXml(await JSZip.loadAsync(word.bytes));
  assert(xml.indexOf('<w:drawing>') < xml.indexOf('A．圆形'), 'legacy image must precede options');
  for (const option of ['A．圆形', 'B．正方形', 'C．矩形', 'D．以上均是']) assert(xml.includes(option), option);
  assert(!/[A-D][.．] +/.test(xml), 'no halfwidth-dot/space option prefixes');
  const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
  assert.equal(extents.length, 2);
  assert(xml.indexOf('题干前半段') < extents[1].index && extents[1].index < xml.indexOf('题干后半段'), 'explicit placement remains intact');
  assert(extents[1].index < xml.indexOf('求解第一小题'), 'stem image precedes subquestions');
  const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset });
  const draws = [...pdf.bytes.toString('latin1').matchAll(/([\d.]+) 0 0 (-?[\d.]+) [\d.-]+ [\d.-]+ cm\s*\/I\d+ Do/g)];
  assert.equal(draws.length, extents.length);
  for (let i = 0; i < draws.length; i++) {
    const width = Number(extents[i][1]) / 9525, height = Number(extents[i][2]) / 9525;
    assert(Math.abs(width / height - 2) < 0.001, 'natural aspect ratio');
    assert(Math.abs(Number(draws[i][1]) - width * 0.75) < 0.001, 'equal Word/PDF physical width');
    assert(Math.abs(Math.abs(Number(draws[i][2])) - height * 0.75) < 0.001, 'equal Word/PDF physical height');
  }
  if (process.env.PAPER_LAYOUT_EVIDENCE_DIR) {
    const fs = require('node:fs'), path = require('node:path');
    fs.mkdirSync(process.env.PAPER_LAYOUT_EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PAPER_LAYOUT_EVIDENCE_DIR, 'image-defaults.docx'), word.bytes, { encoding: 'utf8' });
    fs.writeFileSync(path.join(process.env.PAPER_LAYOUT_EVIDENCE_DIR, 'image-defaults.pdf'), pdf.bytes, { encoding: 'utf8' });
  }
  console.log('paper image defaults and fullwidth option labels passed');
}
module.exports = verifyImageDefaults;
if (require.main === module) verifyImageDefaults().catch(error => { console.error(error); process.exitCode = 1; });
