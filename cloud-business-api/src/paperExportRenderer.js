'use strict';

const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun } = require('docx');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function stripMarkup(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function request(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['word', 'pdf'].includes(value.format) || typeof value.title !== 'string' || !value.title.trim()) {
    throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
  }
  return { format: value.format, title: value.title.trim(), answerPosition: value.answerPosition || 'end' };
}

function questions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.stem !== 'string') {
      throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
    }
    return { number: index + 1, stem: stripMarkup(item.stem), answer: stripMarkup(item.answer), explanation: stripMarkup(item.explanation) };
  });
}

function bodyRows(items, answerPosition) {
  const rows = [new Paragraph({ children: [new TextRun({ text: 'Questions', bold: true })] })];
  for (const item of items) {
    rows.push(new Paragraph({ children: [new TextRun({ text: String(item.number) + '. ' + item.stem })] }));
    if (answerPosition === 'after' && item.answer) rows.push(new Paragraph({ children: [new TextRun({ text: 'Answer: ' + item.answer })] }));
  }
  if (answerPosition !== 'after') {
    rows.push(new Paragraph({ children: [new TextRun({ text: 'Answers', bold: true })] }));
    for (const item of items) if (item.answer) rows.push(new Paragraph({ children: [new TextRun({ text: String(item.number) + '. ' + item.answer })] }));
  }
  return rows;
}

async function wordBytes(input, items) {
  const document = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: input.title, bold: true, size: 32 })] }),
    ...bodyRows(items, input.answerPosition),
  ] }] });
  return Buffer.from(await Packer.toBuffer(document));
}

function pdfBytes(input, items) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.fontSize(18).text(input.title);
    document.moveDown();
    for (const item of items) document.fontSize(11).text(String(item.number) + '. ' + item.stem).moveDown(0.5);
    if (input.answerPosition === 'after') {
      document.moveDown().fontSize(13).text('Answers');
      for (const item of items) if (item.answer) document.fontSize(10).text(String(item.number) + '. ' + item.answer);
    }
    document.end();
  });
}

async function renderPaperExport(input) {
  const current = request(input);
  const items = questions(input.snapshot);
  const bytes = current.format === 'word' ? await wordBytes(current, items) : await pdfBytes(current, items);
  return { bytes, mimeType: current.format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', extension: current.format === 'word' ? 'docx' : 'pdf' };
}

module.exports = Object.freeze({ renderPaperExport });
