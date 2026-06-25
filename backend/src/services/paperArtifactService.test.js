const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writePaperArtifact } = require('./paperArtifactService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-artifacts-'));
  const questions = [
    { id: 'q1', stem: '第一题题干', answer: 'A', explanation: '解析内容' },
  ];

  const docx = await writePaperArtifact('word', { title: '测试试卷', subject: '物理' }, questions, {
    root,
    hostBaseUrl: 'http://127.0.0.1:3001',
  });
  const pdf = await writePaperArtifact('pdf', { title: '测试试卷', subject: '物理' }, questions, {
    root,
    hostBaseUrl: 'http://127.0.0.1:3001',
  });

  assert.ok(fs.existsSync(docx.filePath), 'docx artifact should exist');
  assert.ok(fs.existsSync(pdf.filePath), 'pdf artifact should exist');
  assert.strictEqual(fs.readFileSync(docx.filePath).subarray(0, 2).toString('utf-8'), 'PK', 'docx should be a zip package');
  assert.strictEqual(fs.readFileSync(pdf.filePath).subarray(0, 4).toString('utf-8'), '%PDF', 'pdf should be a PDF file');
  assert.ok(docx.fileUrl.includes('/api/cloud-relay-host/artifacts/'), 'docx should expose host artifact URL');
  assert.ok(pdf.fileUrl.includes('/api/cloud-relay-host/artifacts/'), 'pdf should expose host artifact URL');

  console.log('paper artifact service checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
