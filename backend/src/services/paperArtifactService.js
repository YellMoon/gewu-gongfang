const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
} = require('docx');
const { initQuestionBankStore, resolveQuestionAssetPath } = require('./questionBankStorageService');

function safeFileName(value) {
  return String(value || 'paper')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'paper';
}

function exportRoot(options = {}) {
  const root = options.root || process.env.QUESTION_BANK_ROOT || path.join(process.cwd(), 'data', 'GewuQuestionBank');
  initQuestionBankStore(root, { deviceId: options.deviceId || process.env.GEWU_DEVICE_ID || 'unknown' });
  return root;
}

function artifactUrl(fileName, options = {}) {
  const base = (options.hostBaseUrl || process.env.GEWU_HOST_BASE_URL || '').replace(/\/+$/, '');
  const pathPart = `/api/cloud-relay-host/artifacts/${encodeURIComponent(fileName)}`;
  return base ? `${base}${pathPart}` : pathPart;
}

function normalizeQuestion(question = {}, index = 0) {
  return {
    number: index + 1,
    id: question.id || '',
    stem: question.stem || question.content || question.title || '',
    answer: question.answer || '',
    explanation: question.explanation || question.analysis || '',
  };
}

function paperLines(payload = {}, questions = []) {
  const normalized = questions.map(normalizeQuestion);
  return [
    payload.title || '练习试卷',
    payload.subject ? `科目：${payload.subject}` : '',
    `题目数：${normalized.length}`,
    '',
    ...normalized.flatMap(question => [
      `${question.number}. ${question.stem || question.id}`,
      question.answer ? `答案：${question.answer}` : '',
      question.explanation ? `解析：${question.explanation}` : '',
      '',
    ]),
  ].filter(line => line !== undefined);
}

async function writeDocx(filePath, payload, questions) {
  const document = new Document({
    sections: [{
      children: paperLines(payload, questions).map((line, index) => new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: index === 0,
            size: index === 0 ? 32 : 22,
          }),
        ],
      })),
    }],
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
}

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function writePdf(filePath, payload, questions) {
  const lines = paperLines(payload, questions).map(escapePdfText).slice(0, 45);
  const textOps = lines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 50 ${780 - index * 16} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(textOps, 'utf-8')} >>\nstream\n${textOps}\nendstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'utf-8'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf-8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  fs.writeFileSync(filePath, body, 'binary');
}

async function writePaperArtifact(format, payload = {}, questions = [], options = {}) {
  const normalizedFormat = format === 'pdf' ? 'pdf' : 'word';
  const extension = normalizedFormat === 'pdf' ? 'pdf' : 'docx';
  const fileName = `${Date.now().toString(36)}_${safeFileName(payload.title || '练习试卷')}.${extension}`;
  const root = exportRoot(options);
  const filePath = resolveQuestionAssetPath(root, 'exports', fileName);

  if (normalizedFormat === 'pdf') {
    writePdf(filePath, payload, questions);
  } else {
    await writeDocx(filePath, payload, questions);
  }

  return {
    fileName,
    filePath,
    fileUrl: artifactUrl(fileName, options),
  };
}

module.exports = {
  writePaperArtifact,
};
