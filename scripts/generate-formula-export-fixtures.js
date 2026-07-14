const fs = require('fs');
const path = require('path');
const { writePaperArtifact } = require('../backend/src/services/paperArtifactService');

const doc = nodes => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] });
const text = value => ({ type: 'text', text: value });
const formula = (value, displayMode = 'inline') => ({ type: 'formula', attrs: { canonicalLatex: value, displayMode } });
const root = path.resolve('tmp', 'formula-export-qa');
fs.mkdirSync(root, { recursive: true });
const question = {
  id: 'qa-formulas',
  rich_content: { version: 1, type: 'question-document', sections: {
    stem: doc([text('\u8ba1\u7b97\u4e0b\u5217\u7269\u7406\u91cf\uff1a '), formula('\\frac{v_0^2}{2g}'), text('\uff0c\u5e76\u5206\u6790\u6839\u5f0f '), formula('\\sqrt{a^2+b^2}'), text('\u3002')]),
    options: [
      { id: 'a', label: 'A', isCorrect: false, content: doc([formula('\\alpha+\\beta')]) },
      { id: 'b', label: 'B', isCorrect: true, content: doc([formula('\\int_0^t v\\,dt')]) },
    ],
    subQuestions: [{ id: 'sub', label: '(1)', content: doc([text('\u5206\u6bb5\u51fd\u6570\uff1a'), formula('f(x)=\\begin{cases}x^2,&x\\ge0\\\\-x,&x<0\\end{cases}', 'block')]), answer: doc([formula('f(2)=4')]) }],
    answer: doc([text('\u7b54\u6848\u4e3a '), formula('\\frac{v_0^2}{2g}')]),
    analysis: doc([text('\u5229\u7528\u8fd0\u52a8\u5b66\u516c\u5f0f\u5316\u7b80\u3002')]),
  } },
};

(async () => {
  const outputs = [];
  for (const formulaMode of ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']) {
    outputs.push(await writePaperArtifact('word', { title: `formula-${formulaMode}`, subject: '\u7269\u7406', formulaMode }, [question], { root }));
  }
  outputs.push(await writePaperArtifact('pdf', { title: 'formula-pdf', subject: '\u7269\u7406', formulaMode: 'latex-vector' }, [question], { root }));
  console.log(JSON.stringify(outputs, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
