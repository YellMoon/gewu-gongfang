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
  const fakeXrefOffset = '%PDF-1.4\n'.length;
  const fakeXref = Buffer.from(`%PDF-1.4\nxref\n0 1\nthis-is-not-an-xref\n1 0 obj\n<< /Type /Page >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n${fakeXrefOffset}\n%%EOF\n`);
  assert.throws(
    () => assertPdfArtifact(fakeXref),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
    'a fake xref and marker text must never be treated as a downloadable PDF',
  );
  const rendered = await renderPaperExport({
    format: 'pdf', title: 'PDF artifact validation', answerPosition: 'end', formulaMode: 'word-native',
    snapshot: [{ id: 'q1', stem: 'Question', options: ['A. choice'], answer: 'A', explanation: 'Explanation' }],
  });
  assert.strictEqual(assertPdfArtifact(rendered.bytes), rendered.bytes, 'the renderer output must include a usable xref and trailer');
  console.log('PDF artifact validation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
