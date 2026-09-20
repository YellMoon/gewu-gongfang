'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { questionXml } = require('./paperExportTestContent');
const sharp = require('sharp');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyAttachmentPlacement() {
  const diagramKey = 'a'.repeat(64), previewKey = 'b'.repeat(64);
  const bytes = await sharp({ create: { width: 80, height: 30, channels: 3, background: '#28635b' } }).png().toBuffer();
  const picture = { type: 'image', attrs: { assetKey: diagramKey, width: 80, height: 30 } };
  const formula = { type: 'formula', attrs: { canonicalLatex: 'a-x', previewRef: 'word/media/image67.wmf' } };
  const doc = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const assets = [
    { assetKey: diagramKey, fileName: 'image68.png', mimeType: 'image/png', assetType: 'image' },
    // Real imported MathType previews may be labelled image, not formula_preview.
    { assetKey: previewKey, fileName: 'image67.png', mimeType: 'image/png', assetType: 'image' },
  ];
  const input = { title: 'Attachment placement', formulaMode: 'word-native', answerPosition: 'end', snapshot: [{
    id: 'source', stem: 'Fallback', options: [], assets,
    richContent: { type: 'question-document', version: 1, sections: {
      stem: doc(formula, picture), answer: doc(picture), options: [], subQuestions: [],
    } },
  }] };
  const resolveQuestionAsset = async () => bytes;
  const wordXml = async value => questionXml(await JSZip.loadAsync((await renderPaperExport({ ...value, format: 'word' }, { resolveQuestionAsset })).bytes));
  const xml = await wordXml(input);
  assert.equal((xml.match(/<m:oMath>/g) || []).length, 1, 'the formula remains native and editable');
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 2,
    'structured content controls placement: draw the two explicit diagram occurrences, not the detached old formula preview');
  const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset });
  assert.equal((pdf.bytes.toString('latin1').match(/\/I\d+ Do/g) || []).length, 2,
    'PDF must not append unattached asset inventory either');
  const explicitPreview = structuredClone(input);
  explicitPreview.snapshot[0].richContent.sections.stem.content[0].content.push({ type: 'image', attrs: { assetKey: previewKey } });
  assert.equal(((await wordXml(explicitPreview)).match(/<w:drawing>/g) || []).length, 3,
    'an explicitly placed image is preserved, regardless of its filename or resemblance to a formula');
  const legacy = structuredClone(input);
  legacy.snapshot[0].richContent = null;
  assert.equal(((await wordXml(legacy)).match(/<w:drawing>/g) || []).length, 2,
    'legacy questions without structured sections retain their attachments');
  legacy.snapshot[0].richContent = { blocks: [formula] };
  assert.equal(((await wordXml(legacy)).match(/<w:drawing>/g) || []).length, 2,
    'old formula-only metadata does not count as authoritative structured placement');
  console.log('Word/PDF structured attachment placement and legacy preservation checks passed');
}
module.exports = verifyAttachmentPlacement;
if (require.main === module) verifyAttachmentPlacement().catch(error => { console.error(error); process.exitCode = 1; });
