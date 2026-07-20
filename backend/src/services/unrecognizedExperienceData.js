'use strict';

const SOURCE_LABEL = '\u793a\u4f8b\u9898\uff08\u4e0d\u5c5e\u4e8e\u6b63\u5f0f\u9898\u5e93\uff09';

function text(value) {
  return { type: 'text', text: value };
}

function formula(id, canonicalLatex) {
  return {
    type: 'formula',
    attrs: {
      id,
      canonicalLatex,
      displayMode: 'inline',
      conversionStatus: 'complete',
      sourceFormat: 'omml',
    },
  };
}

function rich(...content) {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function option(key, ...content) {
  return { key, contentRichContent: rich(...content) };
}

const QUESTIONS = [
  {
    id: 'experience-physics-2026-nb2-01',
    number: 1,
    type: 'single-choice',
    stemRichContent: rich(text('\u6258\u5c14\uff08Torr\uff09\u662f\u771f\u7a7a\u6280\u672f\u9886\u57df\u5e7f\u6cdb\u5e94\u7528\u7684\u8ba1\u91cf\u5355\u4f4d\uff0c\u5176\u5b9a\u4e49\u4e3a1\u6beb\u7c73\u6c5e\u67f1\u4ea7\u751f\u7684\u538b\u5f3a\uff0c\u7cbe\u786e\u503c\u4e3a133.322 Pa\u3002\u73b0\u7528\u56fd\u9645\u5355\u4f4d\u5236\u7684\u57fa\u672c\u5355\u4f4d\u8868\u793a\u6258\u5c14\uff0c\u4e0b\u5217\u5355\u4f4d\u6b63\u786e\u7684\u662f\uff08\u3000\u3000\uff09')),
    options: [
      option('A', formula('experience-01-option-a', '\\mathrm{kg}\\cdot\\mathrm{m}^{-1}\\cdot\\mathrm{s}^{-2}')),
      option('B', formula('experience-01-option-b', '\\mathrm{kg}\\cdot\\mathrm{m}^{-2}\\cdot\\mathrm{s}^{-2}')),
      option('C', formula('experience-01-option-c', '\\mathrm{N}\\cdot\\mathrm{m}^{-2}')),
      option('D', formula('experience-01-option-d', '\\mathrm{J}\\cdot\\mathrm{m}^{-3}')),
    ],
    answer: 'A',
    explanationRichContent: rich(
      text('\u538b\u5f3a\u5b9a\u4e49\u5f0f\u4e3a'),
      formula('experience-01-explanation-1', 'p=\\frac{F}{S}'),
      text('\uff0c\u7ed3\u5408'),
      formula('experience-01-explanation-2', 'F=ma'),
      text('\u53ef\u77e5\u538b\u5f3a\u7684\u56fd\u9645\u57fa\u672c\u5355\u4f4d\u4e3a'),
      formula('experience-01-explanation-3', '\\mathrm{kg}\\cdot\\mathrm{m}^{-1}\\cdot\\mathrm{s}^{-2}'),
      text('\uff0c\u6545\u9009A\u3002'),
    ),
    sourceLabel: SOURCE_LABEL,
  },
  {
    id: 'experience-physics-2026-nb2-02',
    number: 2,
    type: 'single-choice',
    stemRichContent: rich(text('\u7ed3\u5408\u4ee5\u4e0b\u56db\u4e2a\u51ac\u5965\u8fd0\u52a8\u60c5\u5883\uff0c\u4e0b\u5217\u8bf4\u6cd5\u6b63\u786e\u7684\u662f\uff08\u3000\u3000\uff09')),
    options: [
      option('A', text('\u88c1\u5224\u4e3a\u817e\u7a7a\u5b8c\u6210\u6280\u5de7\u52a8\u4f5c\u7684\u82cf\u7fca\u9e23\u6253\u5206\u65f6\uff0c\u53ef\u5c06\u5176\u89c6\u4e3a\u8d28\u70b9')),
      option('B', text('\u5f90\u68a6\u6843\u4ece\u8df3\u53f0\u659c\u5411\u4e0a\u98de\u51fa\u540e\uff0c\u5148\u5904\u4e8e\u8d85\u91cd\u72b6\u6001\uff0c\u540e\u5904\u4e8e\u5931\u91cd\u72b6\u6001')),
      option('C', text('\u8c37\u7231\u51cc\u5728U\u5f62\u6c60\u4e2d\u6ed1\u884c\u65f6\uff0c\u6c60\u5bf9\u5979\u7684\u652f\u6301\u529b\u5927\u5c0f\u7b49\u4e8e\u5979\u5bf9\u6c60\u7684\u538b\u529b\u5927\u5c0f')),
      option('D', text('\u5b81\u5fe0\u5ca9\u4ee51\u520641\u79d298\u7684\u6210\u7ee9\u5b8c\u6210\u901f\u5ea6\u6ed1\u51b01500\u7c73\u6bd4\u8d5b\uff0c\u5176\u5168\u7a0b\u5e73\u5747\u901f\u5ea6\u7ea6\u4e3a14.7 m/s')),
    ],
    answer: 'C',
    explanationRichContent: rich(
      text('A\uff0e\u6253\u5206\u9700\u8981\u5173\u6ce8\u8fd0\u52a8\u5458\u7684\u52a8\u4f5c\u7ec6\u8282\uff0c\u4e0d\u80fd\u5c06\u5176\u89c6\u4e3a\u8d28\u70b9\uff1bB\uff0e\u79bb\u53f0\u540e\u5168\u7a0b\u5904\u4e8e\u5931\u91cd\u72b6\u6001\uff1bC\uff0e\u652f\u6301\u529b\u4e0e\u538b\u529b\u662f\u4f5c\u7528\u529b\u4e0e\u53cd\u4f5c\u7528\u529b\uff0c\u5927\u5c0f\u76f8\u7b49\uff1bD\uff0e1500 m\u662f\u8def\u7a0b\uff0c14.7 m/s\u662f\u5e73\u5747\u901f\u7387\uff0c\u4e0d\u662f\u5e73\u5747\u901f\u5ea6\u3002\u6545\u9009C\u3002'),
    ),
    sourceLabel: SOURCE_LABEL,
  },
  {
    id: 'experience-physics-2026-nb2-04',
    number: 4,
    type: 'single-choice',
    stemRichContent: rich(
      text('\u6211\u56fd\u8ba1\u5212\u5229\u7528\u6708\u7403\u571f\u58e4\u4e2d\u4e30\u5bcc\u7684\u949b\u8d44\u6e90\u5efa\u9020\u5c0f\u578b\u6838\u53cd\u5e94\u5806\uff0c\u4e3a\u672a\u6765\u7684\u6708\u7403\u57fa\u5730\u63d0\u4f9b\u6301\u7eed\u80fd\u6e90\u3002\u8be5\u53cd\u5e94\u5806\u4e2d\u6d89\u53ca\u7684\u90e8\u5206\u6838\u53cd\u5e94\u65b9\u7a0b\u5982\u4e0b\uff1a\u2460'),
      formula('experience-04-stem-1', '\\mathrm{X}+_{90}^{232}\\mathrm{Th}\\to_{90}^{233}\\mathrm{Th}'),
      text('\uff0c\u2461'),
      formula('experience-04-stem-2', '_{90}^{233}\\mathrm{Th}\\to_{91}^{233}\\mathrm{Pa}+_{-1}^{0}\\mathrm{e}'),
      text('\uff0c\u2462'),
      formula('experience-04-stem-3', '_{91}^{233}\\mathrm{Pa}\\to_{92}^{233}\\mathrm{U}+_{-1}^{0}\\mathrm{e}'),
      text('\u3002\u4e0b\u5217\u8bf4\u6cd5\u6b63\u786e\u7684\u662f\uff08\u3000\u3000\uff09'),
    ),
    options: [
      option('A', text('\u65b9\u7a0b\u2460\u4e2d\u7684X\u662f\u8d28\u5b50')),
      option('B', text('\u94c0-233\u6bd4\u948d-232\u5c111\u4e2a\u4e2d\u5b50')),
      option('C', text('\u65b9\u7a0b\u2462\u4e2d\u7684\u7535\u5b50\u6765\u81ea\u539f\u5b50\u7684\u5185\u5c42\u7535\u5b50')),
      option('D', text('\u6708\u7403\u4e0a\u7684\u771f\u7a7a\u53ca\u4f4e\u6e29\u73af\u5883\u4f7f\u948d\u7684\u534a\u8870\u671f\u53d8\u957f')),
    ],
    answer: 'B',
    explanationRichContent: rich(
      text('A\uff0e\u6839\u636e\u7535\u8377\u6570\u548c\u8d28\u91cf\u6570\u5b88\u6052\uff0cX\u662f\u4e2d\u5b50\uff1bB\uff0e\u94c0-233\u7684\u4e2d\u5b50\u6570\u4e3a141\uff0c\u948d-232\u7684\u4e2d\u5b50\u6570\u4e3a142\uff0c\u524d\u8005\u5c111\u4e2a\u4e2d\u5b50\uff1bC\uff0e\u03b2\u8870\u53d8\u7535\u5b50\u6765\u81ea\u539f\u5b50\u6838\u5185\u90e8\uff1bD\uff0e\u534a\u8870\u671f\u4e0d\u53d7\u5916\u754c\u6e29\u5ea6\u3001\u538b\u5f3a\u6216\u771f\u7a7a\u73af\u5883\u5f71\u54cd\u3002\u6545\u9009B\u3002'),
    ),
    sourceLabel: SOURCE_LABEL,
  },
  {
    id: 'experience-physics-2026-nb2-11',
    number: 11,
    type: 'multiple-choice',
    stemRichContent: rich(text('\u4e0b\u5217\u8bf4\u6cd5\u6b63\u786e\u7684\u662f\uff08\u3000\u3000\uff09')),
    options: [
      option('A', text('\u673a\u68b0\u6ce2\u548c\u7535\u78c1\u6ce2\u90fd\u6709\u591a\u666e\u52d2\u6548\u5e94')),
      option('B', text('\u7269\u4f53\u53d1\u751f\u5171\u632f\u65f6\uff0c\u5176\u4f4d\u79fb\u59cb\u7ec8\u6700\u5927')),
      option('C', text('6G\uff08\u9891\u7387\u9ad8\u4e8e5G\uff09\u6280\u672f\u4f7f\u7528\u7684\u7535\u78c1\u6ce2\u4e0e5G\u76f8\u6bd4\uff0c\u7c92\u5b50\u6027\u66f4\u663e\u8457')),
      option('D', text('\u6839\u636e\u76f8\u5bf9\u8bba\uff0c\u4e24\u4e8b\u4ef6\u5728\u4e00\u4e2a\u53c2\u8003\u7cfb\u4e2d\u662f\u540c\u65f6\u7684\uff0c\u5728\u53e6\u4e00\u4e2a\u53c2\u8003\u7cfb\u4e2d\u4e00\u5b9a\u4e5f\u540c\u65f6')),
    ],
    answer: 'AC',
    explanationRichContent: rich(text('A\uff0e\u673a\u68b0\u6ce2\u548c\u7535\u78c1\u6ce2\u90fd\u6709\u591a\u666e\u52d2\u6548\u5e94\uff1bB\uff0e\u5171\u632f\u65f6\u632f\u5e45\u6700\u5927\uff0c\u4f4d\u79fb\u5e76\u975e\u59cb\u7ec8\u6700\u5927\uff1bC\uff0e\u9891\u7387\u8d8a\u9ad8\uff0c\u7c92\u5b50\u6027\u8d8a\u663e\u8457\uff1bD\uff0e\u540c\u65f6\u6027\u4e0e\u53c2\u8003\u7cfb\u6709\u5173\u3002\u6545\u9009AC\u3002')),
    sourceLabel: SOURCE_LABEL,
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

deepFreeze(QUESTIONS);

const EXPERIENCE_QUESTION_IDS = Object.freeze(QUESTIONS.map(item => item.id));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listUnrecognizedExperienceQuestions() {
  return clone(QUESTIONS);
}

function unrecognizedExperienceQuestionById(id) {
  const found = QUESTIONS.find(item => item.id === String(id || ''));
  return found ? clone(found) : null;
}

module.exports = {
  EXPERIENCE_QUESTION_IDS,
  SOURCE_LABEL,
  listUnrecognizedExperienceQuestions,
  unrecognizedExperienceQuestionById,
};
