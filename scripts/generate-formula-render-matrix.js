const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writePaperArtifact } = require('../backend/src/services/paperArtifactService');

const MODES = ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector'];
const ANSWER_POSITIONS = ['end', 'after-each'];
const FORMATS = ['word', 'pdf'];

const doc = nodes => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] });
const text = value => ({ type: 'text', text: value });
const formula = (value, displayMode = 'inline') => ({ type: 'formula', attrs: { canonicalLatex: value, displayMode } });
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function matrixCases() {
  return MODES.flatMap(formulaMode => ANSWER_POSITIONS.flatMap(answerPosition => FORMATS.map(format => ({ formulaMode, answerPosition, format }))));
}

function buildQuestions(imageUrl = pixel) {
  return [
    {
      id: 'matrix-choice-rich', type: '\u5355\u9009\u9898', subject: '\u7269\u7406', knowledge_point_names: ['\u8fd0\u52a8\u5b66', '\u51fd\u6570'],
      assets: [{ mime_type: 'image/png', oss_url: imageUrl, width: 160 }],
      rich_content: { version: 1, type: 'question-document', sections: {
        stem: doc([text('\u8ba1\u7b97\u7269\u7406\u91cf '), formula('\\frac{v_0^2}{2g}'), text('\uff0c\u5e76\u5206\u6790\u6839\u5f0f '), formula('\\sqrt{a^2+b^2}'), text('\u3002')]),
        options: [
          { id: 'a', label: 'A', isCorrect: false, content: doc([formula('\\alpha+\\beta')]) },
          { id: 'b', label: 'B', isCorrect: true, content: doc([formula('\\int_0^t v\\,dt')]) },
        ],
        subQuestions: [{ id: 'sub', label: '(1)', content: doc([text('\u5206\u6bb5\u51fd\u6570\uff1a'), formula('f(x)=\\begin{cases}x^2,&x\\ge0\\\\-x,&x<0\\end{cases}', 'block')]), answer: doc([formula('f(2)=4')]) }],
        answer: doc([text('\u7b54\u6848\u4e3a B\uff0c'), formula('\\frac{v_0^2}{2g}')]),
        analysis: doc([text('\u5229\u7528\u8fd0\u52a8\u5b66\u516c\u5f0f\u5316\u7b80\uff0c\u518d\u6838\u5bf9\u91cf\u7eb2\u3002')]),
      } },
    },
    { id: 'matrix-multiple', type: '\u591a\u9009\u9898', subject: '\u7269\u7406', stem: '\u9009\u51fa\u6b63\u786e\u7684\u6ce2\u52a8\u73b0\u8c61\u3002', options: ['A', 'B', 'C'], answer: 'AC', explanation: '\u6839\u636e\u6ce2\u52a8\u89c4\u5f8b\u5224\u65ad\u3002', knowledge_point_names: ['\u6ce2\u52a8'] },
    { id: 'matrix-solution', type: '\u89e3\u7b54\u9898', subject: '\u7269\u7406', stem: '\u8bf7\u8ba1\u7b97\u673a\u68b0\u80fd E=mc^2 \u5e76\u8bf4\u660e\u8fc7\u7a0b\u3002', answer: '42 J', explanation: '\u7531\u673a\u68b0\u80fd\u5b88\u6052\u5f97\u5230\u3002', knowledge_point_names: ['\u673a\u68b0\u80fd\u5b88\u6052'] },
  ];
}

async function generateMatrix(options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join('output', 'task13-formula-matrix'));
  const storeRoot = path.join(outputDir, 'store');
  fs.mkdirSync(outputDir, { recursive: true });
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" rx="8" fill="#dbeafe"/><circle cx="42" cy="40" r="22" fill="#2563eb"/><text x="76" y="47" font-family="Arial" font-size="20" fill="#1e3a8a">IMAGE</text></svg>')).png().toBuffer();
  const questions = buildQuestions(`data:image/png;base64,${image.toString('base64')}`);
  const results = [];
  for (const row of matrixCases()) {
    const artifact = await writePaperArtifact(row.format, {
      title: `matrix-${row.formulaMode}-${row.answerPosition}`,
      subject: '\u7269\u7406', formulaMode: row.formulaMode, answerPosition: row.answerPosition,
    }, questions, { root: storeRoot });
    const extension = row.format === 'word' ? 'docx' : 'pdf';
    const fileName = `${row.formulaMode}__${row.answerPosition}.${extension}`;
    const target = path.join(outputDir, fileName);
    fs.copyFileSync(artifact.filePath, target);
    results.push({ ...row, fileName, target, sha256: artifact.sha256, pageCount: artifact.pageCount, formulaCount: artifact.formulaCount, fallbackCount: artifact.fallbackCount, effectiveFormulaModes: artifact.effectiveFormulaModes });
  }
  const reportPath = path.join(outputDir, 'matrix-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return { outputDir, reportPath, results };
}

module.exports = { matrixCases, buildQuestions, generateMatrix };

if (require.main === module) {
  generateMatrix().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exit(1); });
}
