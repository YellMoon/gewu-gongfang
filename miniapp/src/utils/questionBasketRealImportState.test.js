'use strict';

const assert = require('assert');
const { fetchQuestionPreviewsByIds } = require('./questionBasketHydrationRuntime');
const { createQuestionBasketStore } = require('./questionBasketStoreRuntime');

const importedQuestionIds = [
  'question-import-216770d7c4084d5433c00c67760f113c901a75d0',
  'question-import-d96c1cecfaff1e23ee6a0590da79ec2b716abc92',
];
const importedPreviews = [
  {
    id: importedQuestionIds[0],
    subject: 'physics',
    type: 'single_choice',
    stemPreview: '\u6c7d\u8f66\u7acb\u5373\u505c\u6b62\u65f6\u7684\u8fd0\u52a8\u5b66\u9009\u62e9\u9898',
    options: ['A. 24 m', 'B. 45.5 m', 'C. 78 m', 'D. 120 m'],
    answer: 'B',
    explanation: '\u6839\u636e\u5206\u6bb5\u8fd0\u52a8\u8ba1\u7b97\u5236\u52a8\u8ddd\u79bb\u3002',
    source: '2026\u5c4a\u6d59\u6c5f\u7ecd\u5174\u5e02\u9ad8\u4e09\u4e0b\u5b66\u671f4\u6708\u9002\u5e94\u6027\u8003\u8bd5\u7269\u7406\u8bd5\u5377.docx',
    knowledgeLabels: ['\u76f4\u7ebf\u8fd0\u52a8'],
    status: 'published',
  },
  {
    id: importedQuestionIds[1],
    subject: 'physics',
    type: 'calculation',
    stemPreview: '\u8fd0\u52a8\u5b66\u8bb2\u4e49\u4e2d\u7684\u7efc\u5408\u8ba1\u7b97\u9898',
    options: [],
    answer: '\u89c1\u8fc7\u7a0b',
    explanation: '\u5efa\u7acb\u8fd0\u52a8\u6a21\u578b\u540e\u5206\u6bb5\u6c42\u89e3\u3002',
    source: '2026\u5c4a\u9ad8\u4e09\u590d\u4e60\u8bb2\u4e49-\u4e13\u989801-\u8fd0\u52a8\u5b66.docx',
    knowledgeLabels: ['\u8fd0\u52a8\u5b66'],
    status: 'published',
  },
];

(async () => {
  let page = 0;
  const hydrated = await fetchQuestionPreviewsByIds(importedQuestionIds, {
    pageSize: 200,
    fetchPage: async () => {
      page += 1;
      if (page === 1) return { success: true, data: { questions: Array.from({ length: 200 }, (_value, index) => ({ id: `other-${index}` })), hasMore: true, nextCursor: 'real-import-page' } };
      return { success: true, data: { questions: importedPreviews, hasMore: false, nextCursor: null } };
    },
  });
  assert.strictEqual(hydrated.success, true);
  assert.deepStrictEqual(hydrated.questions.map(question => question.id), importedQuestionIds, 'the published paper and handout representatives must survive a later-page lookup in basket order');
  assert.ok(hydrated.questions.every(question => question.status === 'published' && question.source && question.answer && question.explanation), 'real import page state must retain source, answer and explanation fields');

  const identity = { id: 'real-import-teacher', role: 'teacher', tenant_id: 'tenant-real', teacher_id: 'teacher-real' };
  const persisted = new Map();
  const createStore = () => createQuestionBasketStore({
    readIdentity: () => identity,
    read: key => persisted.get(key),
    write: (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value))),
  });
  const firstRun = createStore();
  firstRun.replace(importedQuestionIds, firstRun.snapshot().scopeKey);
  const restarted = createStore();
  assert.deepStrictEqual(restarted.snapshot().ids, importedQuestionIds, 'both real imported representatives must restore after app restart');
  restarted.seedQuestions(hydrated.questions);
  const paper = restarted.beginPaper(importedQuestionIds);
  assert.strictEqual(paper.written, true);
  assert.deepStrictEqual(paper.selection.selectedIds, importedQuestionIds, 'paper composition must receive the complete recovered real selection');

  console.log('miniapp real imported question basket/page-state checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
