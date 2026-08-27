'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function assertPdfArtifact(value) {
  const bytes = Buffer.isBuffer(value) ? value : null;
  if (!bytes || bytes.length < 32 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  }
  const tailStart = Math.max(0, bytes.length - 4096);
  const tail = bytes.subarray(tailStart).toString('latin1');
  const match = /startxref\s*\r?\n?([0-9]+)\s*\r?\n?%%EOF\s*$/.exec(tail);
  if (!match) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length
    || !bytes.subarray(offset, Math.min(bytes.length, offset + 64)).toString('latin1').startsWith('xref')) {
    throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  }
  if (!/\r?\ntrailer\r?\n/.test(tail) || !bytes.includes(Buffer.from('/Type /Page'))) {
    throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  }
  return bytes;
}

module.exports = Object.freeze({ assertPdfArtifact });
