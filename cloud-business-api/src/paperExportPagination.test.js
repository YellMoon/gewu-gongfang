'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { questionXml } = require('./paperExportTestContent');
const sharp = require('sharp');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyWordPagination() {
  const text = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  const key = 'd'.repeat(64);
  const bytes = await sharp({ create: { width: 200, height: 160, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const formula = { type: 'formula', attrs: { canonicalLatex: 'x^2', displayMode: 'block' } };
  for (const lastBlock of [text('Stem tail'), { type: 'image', attrs: { assetKey: key, width: 200, height: 160 } }, formula]) {
    for (const length of [1, 13, 30]) {
      const input = { format: 'word', title: 'Pagination', formulaMode: 'word-native', answerPosition: 'after', snapshot: [{
        id: 'q1', stem: 'Fallback', assets: lastBlock.type === 'image' ? [{ assetKey: key, fileName: 'source.png', mimeType: 'image/png' }] : [],
        richContent: { version: 1, type: 'question-document', sections: {
          stem: { type: 'doc', content: [text('Opening paragraph'), text('Middle paragraph'), lastBlock, text('')] },
          options: ['A', 'B', 'C', 'D'].map(label => ({ label, content: { type: 'doc', content: [text('x'.repeat(length))] } })),
          answer: { type: 'doc', content: [text('Final answer')] }, subQuestions: [],
        } },
      }, { id: 'q2', stem: 'Next independent question', answer: 'Independent answer', options: [] }] };
      const result = await renderPaperExport(input, { resolveQuestionAsset: async () => bytes });
      const archive = await JSZip.loadAsync(result.bytes);
      const xml = await questionXml(archive);
      const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
      const marker = lastBlock.type === 'image' ? '<w:drawing>' : lastBlock.type === 'formula' ? '<m:oMath>' : 'Stem tail';
      assert.match(paragraphs.find(p => p.includes(marker)), /<w:keepNext\/>/,
        `${lastBlock.type} at the stem end must remain with the first option row, including after trailing empty source paragraphs`);
      assert.match(paragraphs.find(p => p.includes('Opening paragraph')), /<w:widowControl\/>/,
        'explicit widow/orphan control must prevent a two-line stem splitting into one line per page without keeping all long lines together');
      for (const marker of ['Opening paragraph', 'Final answer', 'Next independent question', 'Independent answer']) {
        assert.doesNotMatch(paragraphs.find(p => p.includes(marker)), /<w:keepNext\/>/,
          'do not bind a whole long question or chain independent questions together');
      }
      assert.doesNotMatch(xml, /<w:keepLines\/>|<w:pageBreakBefore\/>/,
        'ordinary long paragraphs must still flow across pages without arbitrary forced page breaks');
      if (length === 13) {
        const optionRows = [...xml.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map(match => match[0]);
        assert.equal(optionRows.length, 2);
        assert.equal((optionRows[0].match(/<w:keepNext\/>/g) || []).length, 2,
          'both cells in the first compact option row must remain with the second row');
        assert.doesNotMatch(optionRows[1], /<w:keepNext\/>/,
          'the last compact option row must not chain into unrelated later questions');
      }
      if (length === 30) {
        for (const label of ['A. ', 'B. ', 'C. ']) assert.match(paragraphs.find(p => p.includes(label)), /<w:keepNext\/>/,
          'single-column options stay together instead of leaving the final option at the top of the next page');
        assert.doesNotMatch(paragraphs.find(p => p.includes('D. ')), /<w:keepNext\/>/);
      }
      if (lastBlock.type === 'formula') {
        assert.equal((xml.match(/<m:oMath>/g) || []).length, 1);
        assert(!Object.keys(archive.files).some(name => /^word\/media\/export-.+/.test(name)), 'pagination must not rasterize native equations');
      }
    }
  }
  console.log('Word stem/option pagination, long-flow and native formula checks passed');
}
module.exports = verifyWordPagination;
if (require.main === module) verifyWordPagination().catch(error => { console.error(error); process.exitCode = 1; });
