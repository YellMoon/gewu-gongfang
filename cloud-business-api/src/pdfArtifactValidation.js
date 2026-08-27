'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function indirectObject(text, objectNumber, generation, start) {
  const marker = `${objectNumber} ${generation} obj`;
  if (!text.startsWith(marker, start)) return null;
  const end = text.indexOf('endobj', start + marker.length);
  return end < 0 ? null : text.slice(start, end + 'endobj'.length);
}

function parseXref(text, offset) {
  const lines = text.slice(offset).split(/\r?\n/);
  if (lines.shift() !== 'xref') return null;
  const entries = new Map();
  while (lines.length) {
    const header = lines.shift();
    if (header === 'trailer') break;
    const range = /^(\d+)\s+(\d+)$/.exec(String(header || '').trim());
    if (!range) return null;
    const first = Number(range[1]);
    const count = Number(range[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || count > 1000000) return null;
    for (let index = 0; index < count; index += 1) {
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])\s*$/.exec(String(lines.shift() || ''));
      if (!entry) return null;
      if (entry[3] === 'n') entries.set(first + index, { offset: Number(entry[1]), generation: Number(entry[2]) });
    }
  }
  const trailer = lines.join('\n');
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(trailer);
  return root ? { entries, root: { objectNumber: Number(root[1]), generation: Number(root[2]) } } : null;
}

function reference(value, key) {
  const found = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`).exec(value);
  return found ? { objectNumber: Number(found[1]), generation: Number(found[2]) } : null;
}

function assertPageTree(text, xref, root) {
  const load = ref => {
    const entry = xref.entries.get(ref.objectNumber);
    if (!entry || entry.generation !== ref.generation || entry.offset < 0 || entry.offset >= text.length) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    const marker = `${ref.objectNumber} ${ref.generation} obj`;
    if (!text.startsWith(marker, entry.offset)) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    const object = indirectObject(text, ref.objectNumber, ref.generation, entry.offset);
    if (!object) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    return object;
  };
  const catalog = load(root);
  if (!/\/Type\s*\/Catalog\b/.test(catalog)) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  const pages = reference(catalog, 'Pages');
  if (!pages) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  const seen = new Set();
  const walk = ref => {
    const key = `${ref.objectNumber}:${ref.generation}`;
    if (seen.has(key)) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    seen.add(key);
    const object = load(ref);
    if (/\/Type\s*\/Page\b/.test(object)) return 1;
    if (!/\/Type\s*\/Pages\b/.test(object)) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object);
    if (!kids) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    const refs = Array.from(kids[1].matchAll(/(\d+)\s+(\d+)\s+R\b/g), match => ({ objectNumber: Number(match[1]), generation: Number(match[2]) }));
    if (!refs.length) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
    return refs.reduce((total, child) => total + walk(child), 0);
  };
  if (walk(pages) < 1) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
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
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
    throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  }
  const text = bytes.toString('latin1');
  const xref = parseXref(text, offset);
  if (!xref) throw failure('CLOUD_PAPER_ARTIFACT_PDF_INVALID');
  assertPageTree(text, xref, xref.root);
  return bytes;
}

module.exports = Object.freeze({ assertPdfArtifact });
