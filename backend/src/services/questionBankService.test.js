const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('../database');
const questionBank = require('./questionBankService');

function withTempDatabase(testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-bank-'));
  const dbPath = path.join(dir, 'test.db');
  const previousDbPath = process.env.DB_PATH;
  const previousReadDbPath = process.env.READ_DB_PATH;
  process.env.DB_PATH = dbPath;
  process.env.READ_DB_PATH = dbPath;

  const service = new DatabaseService();
  try {
    testFn(service.db, service);
  } finally {
    service.close();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previousReadDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testImportValidationPrecedesDuplicateDetection() {
  withTempDatabase((db) => {
    const items = [];
    for (let i = 0; i < 993; i++) {
      items.push({ stem: `valid question ${i}`, answer: 'A', subject: 'physics' });
    }
    for (let i = 0; i < 4; i++) {
      items.push({ stem: '   ', answer: '', subject: 'physics' });
    }
    for (let i = 0; i < 3; i++) {
      items.push({ stem: 'duplicate valid', answer: 'B', subject: 'physics' });
    }

    const batch = questionBank.createImportBatch(db, {
      items,
      source_type: 'test',
      file_name: 'bulk.json',
    }, 'default');

    assert.strictEqual(batch.total_items, 1000);
    assert.strictEqual(batch.rejected_items, 4);
    assert.strictEqual(batch.duplicate_items, 2);
    assert.strictEqual(batch.quality_report.errors.missing_stem, 4);
  });
}

function testImportTaskRecordsAndDetails() {
  withTempDatabase((db) => {
    const first = questionBank.createImportTask(db, {
      source_type: 'lecture',
      file_name: 'first.docx',
      items: [
        { stem: 'first valid question', answer: 'A', type: 'single' },
        { stem: '', answer: '', type: 'single' },
      ],
    }, 'default');
    const second = questionBank.createImportTask(db, {
      source_type: 'paper',
      file_name: 'second.docx',
      items: [
        { stem: 'second valid question', answer: '', type: 'single' },
      ],
    }, 'default');

    const recent = questionBank.listImportTasks(db, { limit: 2 }, 'default');
    assert.strictEqual(recent.length, 2);
    assert.strictEqual(recent[0].id, second.id);
    assert.strictEqual(recent[1].id, first.id);
    assert.strictEqual(first.total_items, 2);
    assert.strictEqual(first.failed_items, 1);
    assert.strictEqual(second.warning_items, 1);

    const firstDetail = questionBank.getImportTask(db, first.id, 'default');
    assert.strictEqual(firstDetail.items.length, 2);
    assert.strictEqual(firstDetail.items.filter(item => item.status === 'failed').length, 1);
    assert.ok(firstDetail.items.some(item => item.errors.includes('missing_stem')));
  });
}

function testCommitImportBatchCreatesAcceptedQuestions() {
  withTempDatabase((db) => {
    const batch = questionBank.createImportBatch(db, {
      source_type: 'lecture',
      file_name: 'commit.docx',
      items: [
        { stem: 'committed question one', answer: 'A', type: 'single', subject: '物理' },
        { stem: 'committed question two', answer: 'B', type: 'single', subject: '物理' },
      ],
    }, 'default');

    assert.strictEqual(batch.accepted_items, 2);
    assert.strictEqual(batch.items.filter(item => item.status === 'success').length, 2);

    const committed = questionBank.commitImportBatch(db, batch.id, 'default', { userId:'test-user', deviceId:'test-device' });
    assert.strictEqual(committed.commit_result.imported_items, 2);
    assert.strictEqual(committed.items.filter(item => item.status === 'imported').length, 2);
    assert.strictEqual(questionBank.listQuestions(db, { limit: 10 }, 'default').length, 2);
    const importedRows = questionBank.listQuestions(db, { limit: 10 }, 'default');
    assert.ok(importedRows.every(row => row.source_device_id === 'test-device' && row.owner_user_id === 'test-user'));
  });
}

function testQuestionHtmlSanitization() {
  withTempDatabase((db) => {
    const created = questionBank.createQuestion(db, {
      type: 'single',
      difficulty: 3,
      stem: '<script>alert(1)</script><span class="keep" onclick="evil()" style="color:red;background-image:url(javascript:evil)">题干</span><img src="question-asset://asset-1" onerror="evil()" style="width:120px;height:60px" /><img src="javascript:evil" />',
      options: [
        {
          label: 'A',
          content: '<img src="data:image/png;base64,abc" onload="evil()" /><b>保留</b><iframe>drop</iframe>',
        },
      ],
      answer: '<span data-latex="x^2" onclick="evil()">A</span>',
    }, 'default');

    const question = questionBank.getQuestion(db, created.id, 'default');
    assert.ok(question.stem.includes('class="keep"'));
    assert.ok(question.stem.includes('question-asset://asset-1'));
    assert.ok(question.stem.includes('width:120px'));
    assert.ok(!/script|onclick|onerror|javascript:|background-image/i.test(question.stem));
    assert.ok(question.options[0].content.includes('data:image/png'));
    assert.ok(question.options[0].content.includes('<b>保留</b>'));
    assert.ok(!/onload|iframe|javascript:/i.test(question.options[0].content));
    assert.ok(question.answer.includes('data-latex="x^2"'));
    assert.ok(!/onclick/i.test(question.answer));
  });
}

function testClearQuestionBankData() {
  withTempDatabase((db) => {
    const created = questionBank.createQuestion(db, {
      type: 'single',
      difficulty: 3,
      stem: 'temporary debug question',
      answer: 'A',
      options: [{ label: 'A', content: 'alpha' }],
    }, 'default');
    const batch = questionBank.createImportBatch(db, {
      source_type: 'exam',
      file_name: 'debug.docx',
      items: [{ stem: 'batch question', answer: 'B', type: 'single' }],
    }, 'default');
    assert.ok(created.id);
    assert.ok(batch.id);

    const result = questionBank.clearQuestionBankData(db, 'default');
    assert.strictEqual(result.questions, 1);
    assert.strictEqual(result.import_batches, 1);
    assert.strictEqual(questionBank.listQuestions(db, { limit: 10 }, 'default').length, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM question_contents').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM import_batches').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM import_items').get().count, 0);
  });
}

function insertKnowledgePoint(db, id, tenantId, name) {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO tenants (id, name, status, plan, deleted, created_at, updated_at)
     VALUES (?, ?, 'active', 'standard', 0, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(tenantId, tenantId, ts, ts);
  db.prepare(
    `INSERT INTO knowledge_points (id, tenant_id, name, deleted, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run(id, tenantId, name, ts, ts);
}

function testQuestionKnowledgePointCrud() {
  withTempDatabase((db) => {
    insertKnowledgePoint(db, 'kp-motion', 'default', '运动学');
    insertKnowledgePoint(db, 'kp-force', 'default', '力与平衡');
    insertKnowledgePoint(db, 'kp-force-duplicate-name', 'default', '力与平衡');
    insertKnowledgePoint(db, 'kp-other-tenant', 'tenant-b', '隔离知识点');

    const created = questionBank.createQuestion(db, {
      type: 'single',
      difficulty: 3,
      stem: '物体做匀变速直线运动，下列说法正确的是',
      answer: 'A',
    }, 'default');

    let question = questionBank.addQuestionKnowledgePoints(db, created.id, {
      knowledge_point_ids: ['kp-motion'],
    }, 'default');
    assert.deepStrictEqual(question.knowledge_point_ids, ['kp-motion']);

    const tags = questionBank.listQuestionKnowledgePoints(db, created.id, 'default');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].name, '运动学');

    question = questionBank.setQuestionKnowledgePoints(db, created.id, {
      knowledge_point_ids: ['kp-motion', 'kp-force', 'kp-force-duplicate-name'],
    }, 'default');
    assert.deepStrictEqual(question.knowledge_point_ids.sort(), ['kp-force', 'kp-force-duplicate-name', 'kp-motion']);
    assert.deepStrictEqual(question.knowledge_point_names, ['力与平衡', '运动学'], 'export-facing knowledge names must be stable and human-readable');

    question = questionBank.removeQuestionKnowledgePoints(db, created.id, {
      knowledge_point_ids: ['kp-motion'],
    }, 'default');
    assert.deepStrictEqual(question.knowledge_point_ids.sort(), ['kp-force', 'kp-force-duplicate-name']);
    assert.deepStrictEqual(question.knowledge_point_names, ['\u529b\u4e0e\u5e73\u8861'], 'removing another ID must keep the deduplicated display name');

    assert.throws(() => {
      questionBank.addQuestionKnowledgePoints(db, created.id, {
        knowledge_point_ids: ['kp-other-tenant'],
      }, 'default');
    }, /knowledge point not found/);

    assert.strictEqual(questionBank.listQuestionKnowledgePoints(db, created.id, 'tenant-b'), null);

    const named = questionBank.createQuestion(db, {
      type: 'fill',
      difficulty: 2,
      stem: '平抛运动的水平分运动是',
      answer: '匀速直线运动',
      knowledge_points: ['抛体运动'],
    }, 'default');
    const namedQuestion = questionBank.getQuestion(db, named.id, 'default');
    assert.strictEqual(namedQuestion.knowledge_point_ids.length, 1);
    const namedTags = questionBank.listQuestionKnowledgePoints(db, named.id, 'default');
    assert.strictEqual(namedTags[0].name, '抛体运动');
  });
}

function testStructuredRichContentRoundTrip() {
  withTempDatabase((db) => {
    const richContent = {
      version: 1,
      type: 'question-document',
      sections: {
        stem: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            attrs: { textAlign: 'justify', lineHeight: 1.5 },
            content: [
              { type: 'text', text: 'find velocity', marks: [{ type: 'bold' }, { type: 'fontFamily', attrs: { fontFamily: 'SimSun' } }] },
              { type: 'formula', attrs: { id: 'f-1', canonicalLatex: '\\frac{s}{t}', displayMode: 'inline' } },
              { type: 'image', attrs: { assetKey: 'asset-1', alt: 'motion diagram', width: 240, align: 'center' } },
            ],
          }],
        },
        options: [{ id: 'option-a', label: 'A', isCorrect: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'option A' }] }] } }],
        subQuestions: [{ id: 'sub-1', label: '(1)', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'part one' }] }] }, answer: { type: 'doc', content: [] } }],
        answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'answer A' }] }] },
        analysis: { type: 'doc', content: [] },
      },
    };

    const created = questionBank.createQuestion(db, {
      type: 'single', stem: '<p>legacy stem</p>', answer: 'A',
      options: [{ label: 'A', content: 'option A' }], rich_content: richContent,
    }, 'default');
    const loaded = questionBank.getQuestion(db, created.id, 'default');

    assert.deepStrictEqual(loaded.rich_content, richContent);
    assert.strictEqual(loaded.rich_content.sections.stem.content[0].content[1].attrs.canonicalLatex, '\\frac{s}{t}');
    assert.ok(loaded.stem.includes('legacy stem'));

    const updatedRich = JSON.parse(JSON.stringify(richContent));
    updatedRich.sections.answer.content[0].content[0].text = 'updated answer';
    questionBank.updateQuestion(db, created.id, { rich_content: updatedRich, answer: 'updated answer' }, 'default');
    const updated = questionBank.getQuestion(db, created.id, 'default');
    assert.strictEqual(updated.rich_content.sections.answer.content[0].content[0].text, 'updated answer');
    assert.strictEqual(updated.answer, 'updated answer');
  });
}

function testRichContentPersistenceProjectionAndOldClientCompatibility() {
  withTempDatabase((db) => {
    const richContent = {
      version: 1, type: 'question-document', sections: {
        stem: { type: 'doc', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'projectile velocity ' },
          { type: 'formula', attrs: { id: 'f-velocity', canonicalLatex: 'v_x=v_0', displayMode: 'inline' } },
          { type: 'image', attrs: { assetKey: 'diagram-1', alt: 'trajectory diagram' } },
        ] }] },
        options: [{ id: 'option-a', label: 'A', isCorrect: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'constant' }] }] } }],
        subQuestions: [{ id: 'sub-1', label: '(1)', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'vertical component' }] }] }, answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gravity result' }] }] } }],
        answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A', marks: [{ type: 'bold' }] }, { type: 'formula', attrs: { id: 'answer-f', canonicalLatex: 'y', displayMode: 'inline' } }] }] },
        analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'horizontal motion' }] }] },
      },
    };

    const created = questionBank.createQuestion(db, { type: 'single', rich_content: richContent }, 'default');
    const reloaded = questionBank.getQuestion(db, created.id, 'default');
    assert.deepStrictEqual(reloaded.rich_content, richContent);
    assert.strictEqual(reloaded.stem, 'projectile velocity v_x=v_0 trajectory diagram');
    assert.deepStrictEqual(reloaded.options, [{ label: 'A', content: 'constant', is_correct: true }]);
    assert.strictEqual(reloaded.answer, 'A y');
    assert.strictEqual(reloaded.explanation, 'horizontal motion');
    assert.strictEqual(reloaded.has_formula, true);
    assert.strictEqual(reloaded.has_image, true);
    assert.strictEqual(questionBank.searchQuestionsFallback(db, { search: 'projectile velocity' }, 'default')[0].id, created.id);
    assert.strictEqual(questionBank.searchQuestionsFallback(db, { search: 'constant' }, 'default')[0].id, created.id);
    assert.strictEqual(questionBank.searchQuestionsFallback(db, { search: 'gravity result' }, 'default')[0].id, created.id);
    db.prepare('UPDATE question_contents SET search_text = NULL WHERE question_id = ? AND deleted = 0').run(created.id);
    assert.strictEqual(questionBank.searchQuestionsFallback(db, { search: 'gravity result' }, 'default')[0].id, created.id, 'pre-search_text rows remain searchable after restart/migration');

    questionBank.updateQuestion(db, created.id, { difficulty: 5 }, 'default');
    assert.deepStrictEqual(questionBank.getQuestion(db, created.id, 'default').rich_content, richContent);

    questionBank.updateQuestion(db, created.id, { stem: 'legacy client changed stem' }, 'default');
    const oldClientUpdated = questionBank.getQuestion(db, created.id, 'default');
    assert.strictEqual(oldClientUpdated.stem, 'legacy client changed stem');
    assert.strictEqual(oldClientUpdated.rich_content.sections.stem.content[0].content[0].text, 'legacy client changed stem');
    assert.strictEqual(oldClientUpdated.rich_content.sections.answer.content[0].content[0].text, 'A');
    assert.deepStrictEqual(oldClientUpdated.rich_content.sections.answer, richContent.sections.answer, 'partial legacy stem update preserves rich answer JSON');
  });
}

function testRichContentOptionalNullsUseCanonicalParity() {
  withTempDatabase((db) => {
    const payload = { version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'formula', attrs: { id: 'f-null', canonicalLatex: 'x', displayMode: 'inline', sourceRef: null, previewRef: null } },
        { type: 'image', attrs: { assetKey: 'asset-null', src: 'question-asset://asset-null', alt: 'diagram', width: null, height: null, title: null } },
      ] }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    } };
    const rich = questionBank.createQuestion(db, { type: 'single', rich_content: payload }, 'default').rich_content;
    const [formula, image] = rich.sections.stem.content[0].content;
    assert.strictEqual(Object.hasOwn(formula.attrs, 'sourceRef'), false);
    assert.strictEqual(Object.hasOwn(formula.attrs, 'previewRef'), false);
    for (const key of ['width', 'height', 'title']) assert.strictEqual(Object.hasOwn(image.attrs, key), false);
  });
}

function testRichContentStrictAttributeValidation() {
  withTempDatabase((db) => {
    const make = node => ({ version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [node] }, options: [], subQuestions: [],
      answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    } });
    for (const node of [
      { type: 'paragraph', attrs: { onclick: 'evil()' }, content: [] },
      { type: 'paragraph', attrs: { textAlign: 'sideways' }, content: [] },
      { type: 'heading', attrs: { level: 8 }, content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'image', attrs: { assetKey: 'asset-1', src: 'data:image/png;base64,AAAA' } },
      { type: 'image', attrs: { assetKey: 'asset-1', title: 42 } },
      { type: 'image', attrs: { assetKey: 'asset-1', title: 'x'.repeat(1001) } },
    ]) assert.throws(() => questionBank.createQuestion(db, { type: 'single', rich_content: make(node) }, 'default'), /rich_content/);
    const invalidOption = make({ type: 'paragraph', content: [] });
    invalidOption.sections.options = [{ id: 'bad-option', label: 'A', isCorrect: false, content: { type: 'paragraph', content: [] } }];
    assert.throws(() => questionBank.createQuestion(db, { type: 'single', rich_content: invalidOption }, 'default'), /option content must be a doc/);

    const valid = make({ type: 'codeBlock', attrs: { language: 'latex' }, content: [{ type: 'text', text: 'x^2' }] });
    assert.deepStrictEqual(questionBank.createQuestion(db, { type: 'single', rich_content: valid }, 'default').rich_content, valid);
  });
}

function testLegacySearchTextBackfillUsesCanonicalPlainText() {
  withTempDatabase((db, service) => {
    const created = questionBank.createQuestion(db, {
      type: 'single', stem: '<b>Legacy stem</b>', options: [{ label: 'D', content: '<i>Legacy choice</i>', is_correct: true }], answer: '<span>Legacy answer</span>',
    }, 'default');
    const second = questionBank.createQuestion(db, { type: 'single', stem: '<b>Second stem</b>' }, 'default');
    db.prepare('UPDATE question_contents SET search_text = NULL WHERE question_id IN (?, ?) AND deleted = 0').run(created.id, second.id);
    service._ensureQuestionContentColumns(1);
    const row = db.prepare('SELECT search_text FROM question_contents WHERE question_id = ? AND deleted = 0').get(created.id);
    assert.strictEqual(row.search_text, 'Legacy stem D Legacy choice Legacy answer');
    assert.ok(!/[{}\[\]"]|canonicalLatex|<b>|options_json/.test(row.search_text));
    assert.strictEqual(db.prepare('SELECT search_text FROM question_contents WHERE question_id = ? AND deleted = 0').get(second.id).search_text, 'Second stem');
    service._ensureQuestionContentColumns(1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM question_contents WHERE search_text IS NULL').get().count, 0);
  });
}

function testDynamicTaxonomyLifecycle() {
  withTempDatabase((db) => {
    const physics = questionBank.listTaxonomySystems(db, '\u7269\u7406', 'default');
    assert.deepStrictEqual(physics.map(system => system.id), ['knowledge', 'model']);
    assert.deepStrictEqual(questionBank.listTaxonomySystems(db, 'Chemistry', 'default'), []);

    const system = questionBank.createTaxonomySystem(db, { subject: 'Chemistry', name: 'Concepts' }, 'default');
    const root = questionBank.createTaxonomyNode(db, system.id, { name: 'Matter' }, 'default');
    const child = questionBank.createTaxonomyNode(db, system.id, { name: 'Atoms', parent_id: root.id }, 'default');
    const created = questionBank.createQuestion(db, {
      subject: 'Chemistry', type: 'single', stem: 'taxonomy test question', taxonomy_ids: { [system.id]: [child.id] },
    }, 'default');
    assert.deepStrictEqual(created.taxonomy_ids[system.id], [child.id]);
    assert.strictEqual(questionBank.listQuestions(db, { taxonomy_filters: JSON.stringify({ [system.id]: { includeGroups: [[child.id]], excludeIds: [] } }) }, 'default').length, 1);
    assert.strictEqual(questionBank.listQuestions(db, { taxonomy_filters: JSON.stringify({ [system.id]: { includeGroups: [], excludeIds: [child.id] } }) }, 'default').length, 0);

    const renamed = questionBank.updateTaxonomySystem(db, system.id, { name: 'Knowledge framework' }, 'default');
    assert.strictEqual(renamed.name, 'Knowledge framework');
    questionBank.updateTaxonomyNode(db, system.id, child.id, { name: 'Atomic structure' }, 'default');
    assert.deepStrictEqual(questionBank.getQuestion(db, created.id, 'default').taxonomy_ids[system.id], [child.id]);

    assert.strictEqual(questionBank.deleteTaxonomyNode(db, system.id, root.id, 'default'), true);
    assert.deepStrictEqual(questionBank.getQuestion(db, created.id, 'default').taxonomy_ids[system.id], []);
    assert.ok(questionBank.getQuestion(db, created.id, 'default'));

    const next = questionBank.createTaxonomyNode(db, system.id, { name: 'Reactions' }, 'default');
    questionBank.setQuestionTaxonomyNodes(db, created.id, system.id, [next.id], 'default');
    assert.strictEqual(questionBank.deleteTaxonomySystem(db, system.id, 'default'), true);
    const keptQuestion = questionBank.getQuestion(db, created.id, 'default');
    assert.ok(keptQuestion);
    assert.strictEqual(Object.hasOwn(keptQuestion.taxonomy_ids, system.id), false);
    assert.deepStrictEqual(questionBank.listTaxonomySystems(db, 'Chemistry', 'default'), []);
  });
}

function main() {
  testImportValidationPrecedesDuplicateDetection();
  testImportTaskRecordsAndDetails();
  testCommitImportBatchCreatesAcceptedQuestions();
  testQuestionHtmlSanitization();
  testClearQuestionBankData();
  testQuestionKnowledgePointCrud();
  testStructuredRichContentRoundTrip();
  testRichContentPersistenceProjectionAndOldClientCompatibility();
  testRichContentOptionalNullsUseCanonicalParity();
  testRichContentStrictAttributeValidation();
  testLegacySearchTextBackfillUsesCanonicalPlainText();
  testDynamicTaxonomyLifecycle();
  console.log('questionBankService tests passed');
}

main();
