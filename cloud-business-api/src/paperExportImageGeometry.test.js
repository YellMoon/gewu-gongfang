'use strict';

const assert = require('node:assert/strict');
const JSZip = require('jszip');
const sharp = require('sharp');
const { renderPaperExport } = require('./paperExportRenderer');

async function testImageGeometry() {
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
