const QUESTION_PAPER_TEMPLATE = {
  page: {
    // A4, margins copied from the lecture-format reference document.
    width: 11906,
    height: 16838,
    margin: {
      top: 1418,
      bottom: 1134,
      left: 1134,
      right: 1134,
      header: 454,
      footer: 850,
    },
  },
  font: {
    chinese: 'SimSun',
    latin: 'Times New Roman',
  },
  size: {
    title: 30,
    body: 21,
    meta: 20,
    answer: 20,
  },
  paragraph: {
    after: 0,
    line: 360,
    lineRule: 'auto',
  },
  option: {
    // Two Chinese characters at 10.5 pt = 21 pt = 420 twips.
    leftIndent: 420,
  },
  footer: {
    leftText: '《试卷》第',
    rightText: '林老师：13732250653',
  },
};

function isChoiceOptionText(value) {
  return /^[A-G][．.、]/.test(String(value || '').trim());
}

module.exports = {
  QUESTION_PAPER_TEMPLATE,
  isChoiceOptionText,
};
