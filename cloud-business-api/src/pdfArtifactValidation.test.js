'use strict';

const assert = require('assert');
const { assertPdfArtifact } = require('./pdfArtifactValidation');
const { renderPaperExport } = require('./paperExportRenderer');

(async () => {
  assert.throws(
    () => assertPdfArtifact(Buffer.from('%PDF-1.4\n% fixture paper\n')),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
    'a PDF header alone must never be treated as a downloadable PDF',
  );
  const rendered = await renderPaperExport({
    format: 'pdf', title: 'PDF artifact validation', answerPosition: 'end', formulaMode: 'word-native',
    snapshot: [{ id: 'q1', stem: 'Question', options: ['A. choice'], answer: 'A', explanation: 'Explanation' }],
  });
  assert.strictEqual(assertPdfArtifact(rendered.bytes), rendered.bytes, 'the renderer output must include a usable xref and trailer');
  console.log('PDF artifact validation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
