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
  const invalidObjects = [
    '1 0 obj\nNOT_A_DICTIONARY /Type /Catalog /Pages 2 0 R\nendobj\n',
    '2 0 obj\nNOT_A_DICTIONARY /Type /Pages /Kids [3 0 R]\nendobj\n',
    '3 0 obj\nNOT_A_DICTIONARY /Type /Page /Parent 2 0 R\nendobj\n',
  ];
  let invalidPdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of invalidObjects) { offsets.push(Buffer.byteLength(invalidPdf, 'latin1')); invalidPdf += object; }
  const xrefOffset = Buffer.byteLength(invalidPdf, 'latin1');
  invalidPdf += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  assert.throws(
    () => assertPdfArtifact(Buffer.from(invalidPdf, 'latin1')),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
    'xref offsets alone must not make non-dictionary page-tree objects a valid PDF',
  );
  const incompleteObjects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page >>\nendobj\n',
  ];
  let incompletePdf = '%PDF-1.4\n';
  const incompleteOffsets = [0];
  for (const object of incompleteObjects) { incompleteOffsets.push(Buffer.byteLength(incompletePdf, 'latin1')); incompletePdf += object; }
  const incompleteXrefOffset = Buffer.byteLength(incompletePdf, 'latin1');
  incompletePdf += `xref\n0 4\n0000000000 65535 f \n${incompleteOffsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R >>\nstartxref\n${incompleteXrefOffset}\n%%EOF\n`;
  assert.throws(
    () => assertPdfArtifact(Buffer.from(incompletePdf, 'latin1')),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
    'a dictionary-shaped tree without a page count or page parent must be rejected',
  );
  const noMediaBoxObjects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n',
  ];
  let noMediaBoxPdf = '%PDF-1.4\n';
  const noMediaBoxOffsets = [0];
  for (const object of noMediaBoxObjects) { noMediaBoxOffsets.push(Buffer.byteLength(noMediaBoxPdf, 'latin1')); noMediaBoxPdf += object; }
  const noMediaBoxXrefOffset = Buffer.byteLength(noMediaBoxPdf, 'latin1');
  noMediaBoxPdf += `xref\n0 4\n0000000000 65535 f \n${noMediaBoxOffsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R >>\nstartxref\n${noMediaBoxXrefOffset}\n%%EOF\n`;
  assert.throws(
    () => assertPdfArtifact(Buffer.from(noMediaBoxPdf, 'latin1')),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
    'a complete-looking page tree without an effective MediaBox must be rejected',
  );
  const rendered = await renderPaperExport({
    format: 'pdf', title: 'PDF artifact validation', answerPosition: 'end', formulaMode: 'word-native',
    snapshot: [{ id: 'q1', stem: 'Question', options: ['A. choice'], answer: 'A', explanation: 'Explanation' }],
  });
  assert.strictEqual(assertPdfArtifact(rendered.bytes), rendered.bytes, 'the renderer output must include a usable xref and trailer');
  console.log('PDF artifact validation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
