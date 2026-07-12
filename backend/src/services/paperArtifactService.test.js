const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

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

  const formulaQuestion = {
    id: 'formula-q',
    rich_content: { version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v=' }, { type: 'formula', attrs: { canonicalLatex: '\\frac{s}{t}', displayMode: 'inline' } }] }] },
      options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    } },
  };
  for (const mode of ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']) {
    const artifact = await writePaperArtifact('word', { title: `formula-${mode}`, formulaMode: mode }, [formulaQuestion], { root });
    const files = unzipSync(fs.readFileSync(artifact.filePath));
    const documentXml = strFromU8(files['word/document.xml']);
    assert.ok(!documentXml.includes('[[GEWU_FORMULA_'), `${mode} must not leak placeholders`);
    if (mode === 'word-native') assert.ok(documentXml.includes('<m:oMath'), 'native mode must contain OMML');
    if (mode === 'eq-field') assert.ok(documentXml.includes('<w:fldSimple') && documentXml.includes('<m:oMath'), 'EQ mode must keep a visible OMML result');
    if (mode.endsWith('compatible') || mode.endsWith('vector')) assert.ok(Object.keys(files).some(name => name.endsWith('.svg')), `${mode} must embed SVG`);
    assert.strictEqual(artifact.formulaCount, 1);
  }

  console.log('paper artifact service checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
