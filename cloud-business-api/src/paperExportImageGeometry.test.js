'use strict';

const assert = require('node:assert/strict');
const JSZip = require('jszip');
const sharp = require('sharp');
const { renderPaperExport, drawPdfTokens } = require('./paperExportRenderer');

async function testSourceGeometryAndPlacement() {
  const assetKey = 'b'.repeat(64);
  const bytes = await sharp({ create: { width: 1200, height: 550, channels: 3, background: '#237480' } }).png().toBuffer();
  const text = value => ({ type: 'text', text: value });
  const picture = (width, height) => ({ type: 'image', attrs: { assetKey, width, height } });
  const doc = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const input = {
    title: 'Source geometry', formulaMode: 'word-native', answerPosition: 'end',
    snapshot: [{ id: 'source', stem: 'Fallback must not replace an image', answer: '', explanation: '', options: [],
      assets: [{ assetKey, fileName: 'source.png', mimeType: 'image/png' }],
      richContent: { version: 1, type: 'question-document', sections: {
        stem: doc(text('Before diagram'), picture(215, 98), text('After diagram')),
        options: [{ label: 'A', content: doc(picture(554, 152.6266666667)) }],
        subQuestions: [], answer: doc(picture(100, 45)), analysis: doc(),
      } },
    }],
  };
  let calls = 0;
  const resolveQuestionAsset = async () => { calls++; return bytes; };
  const word = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset });
  const archive = await JSZip.loadAsync(word.bytes);
  const xml = await archive.file('word/document.xml').async('string');
  const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
  const answerHeading = '\u53c2\u8003\u7b54\u6848';
  assert.equal(extents.length, 3, 'each placed image occurrence survives; no appended duplicate or early answer image');
  assert(xml.indexOf('Before diagram') < extents[0].index && extents[0].index < xml.indexOf('After diagram'), 'stem image keeps its source position');
  assert(xml.indexOf('A. ') < extents[1].index && extents[1].index < xml.indexOf(answerHeading), 'image-only option keeps its label and position');
  assert(xml.indexOf(answerHeading) < extents[2].index, 'answer image stays in the answer section');
  const diagramRows = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].filter(match => match[0].includes('<w:drawing>'));
  assert(diagramRows.every(match => !match[0].includes('Before diagram') && !match[0].includes('After diagram')),
    'match the desktop viewer: diagrams are blocks, not giant inline text lines');
  assert(diagramRows.every(match => match[0].includes('<w:jc w:val="center"')), 'default image alignment matches the desktop viewer');
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
  assert(paragraphs.find(row => row.includes('A. ')).includes('<w:keepNext/>'), 'an image-only option label must stay with its diagram');
  for (const [index, [width, height]] of [[215, 98], [554, 152.6266666667], [100, 45]].entries()) {
    assert(Math.abs(Number(extents[index][1]) / 9525 - width) < 0.001, 'use source display width, not raster pixels or an arbitrary 420px cap');
    assert(Math.abs(Number(extents[index][2]) / 9525 - height) < 0.001, 'use source display height, including intentional source scaling');
  }
  assert.equal(calls, 1, 'same asset at different source sizes is fetched once');
  const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset });
  const draws = [...pdf.bytes.toString('latin1').matchAll(/([\d.]+) 0 0 (-?[\d.]+) [\d.-]+ [\d.-]+ cm\s*\/I\d+ Do/g)];
  assert.equal(draws.length, 3, 'PDF places the same three occurrences, including the image-only answer');
  for (const [index, [width, height]] of [[161.25, 73.5], [415.5, 114.47], [75, 33.75]].entries()) {
    assert(Math.abs(Number(draws[index][1]) - width) < 0.001, 'CSS px must convert to physical PDF points');
    assert(Math.abs(Math.abs(Number(draws[index][2])) - height) < 0.001, 'PDF and Word must share source physical size');
  }
  for (const attrs of [{ assetKey: 'c'.repeat(64) }, { assetKey, width: -1 }, { assetKey, height: Infinity }]) {
    const invalid = structuredClone(input);
    invalid.snapshot[0].richContent.sections.stem = doc({ type: 'image', attrs });
    await assert.rejects(() => renderPaperExport({ ...invalid, format: 'word' }, { resolveQuestionAsset }), /CLOUD_PAPER_RENDER_MEDIA_INVALID/,
      'a missing asset or invalid size must fail visibly, not silently disappear');
  }
}

async function testImageGeometry() {
  const events = [];
  let page = 1;
  const probe = { x: 10, y: 110, page: { width: 200, height: 160, margins: { left: 10, right: 10, top: 10, bottom: 10 } },
    fontSize() { return this; }, currentLineHeight() { return 12; }, widthOfString(text) { return text.length * 5; },
    text(text) { events.push({ kind: 'text', text, page }); return this; }, image() { events.push({ kind: 'image', page }); return this; },
    addPage() { page++; this.x = 10; this.y = 10; return this; } };
  drawPdfTokens(probe, [{ kind: 'break' }, { kind: 'image', align: 'center', media: { kind: 'image', width: 100, height: 60, displayWidth: 100, displayHeight: 60, bytes: Buffer.from('fixture') } }], 'C. ');
  assert(events.every(event => event.page === 2), 'move the option label and image together instead of orphaning the label');
  events.length = 0; page = 1; probe.page.height = 200; probe.y = 110;
  drawPdfTokens(probe, [{ kind: 'text', text: 'x'.repeat(100) }, { kind: 'image', align: 'center', media: { kind: 'image', width: 100, height: 60, displayWidth: 100, displayHeight: 60, bytes: Buffer.from('fixture') } }]);
  assert.equal(events[0].page, 1, 'a long paragraph may split; do not create a large blank area by moving it wholesale');
  assert.equal(events.at(-1).page, 2);
  await testSourceGeometryAndPlacement();
  for (const [width, height] of [[600, 100], [100, 600], [80, 40]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#237480' } }).png().toBuffer();
    const result = await renderPaperExport({
      format: 'word', title: 'Image geometry regression', answerPosition: 'end', formulaMode: 'word-native',
      snapshot: [{ id: 'geometry', stem: 'Diagram', answer: '', explanation: '', options: [],
        assets: [{ assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png', assetType: 'image' }] }],
    }, { resolveQuestionAsset: async () => bytes });
    const archive = await JSZip.loadAsync(result.bytes);
    const xml = await archive.file('word/document.xml').async('string');
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
    assert.equal(extents.length, 1, 'the source diagram appears exactly once');
    const actualWidth = Number(extents[0][1]) / 9525;
    const actualHeight = Number(extents[0][2]) / 9525;
    const scale = Math.min(420 / width, 280 / height, 1);
    assert(Math.abs(actualWidth - width * scale) < 0.001, 'Word diagram width must preserve its natural aspect ratio without upscaling');
    assert(Math.abs(actualHeight - height * scale) < 0.001, 'Word diagram height must preserve its natural aspect ratio without upscaling');
    const media = Object.keys(archive.files).filter(name => /^word\/media\/.+\.png$/.test(name));
    assert.equal(media.length, 1);
    assert((await archive.file(media[0]).async('nodebuffer')).equals(bytes), 'sizing must not rewrite the original diagram bytes');
  }
  console.log('paper export image geometry checks passed');
}

module.exports = testImageGeometry;
if (require.main === module) testImageGeometry().catch(error => { console.error(error); process.exitCode = 1; });
