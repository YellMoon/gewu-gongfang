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
    testFn(service.db);
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

    const committed = questionBank.commitImportBatch(db, batch.id, 'default');
    assert.strictEqual(committed.commit_result.imported_items, 2);
    assert.strictEqual(committed.items.filter(item => item.status === 'imported').length, 2);
    assert.strictEqual(questionBank.listQuestions(db, { limit: 10 }, 'default').length, 2);
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
      knowledge_point_ids: ['kp-motion', 'kp-force'],
    }, 'default');
    assert.deepStrictEqual(question.knowledge_point_ids.sort(), ['kp-force', 'kp-motion']);

    question = questionBank.removeQuestionKnowledgePoints(db, created.id, {
      knowledge_point_ids: ['kp-motion'],
    }, 'default');
    assert.deepStrictEqual(question.knowledge_point_ids, ['kp-force']);

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

function main() {
  testImportValidationPrecedesDuplicateDetection();
  testImportTaskRecordsAndDetails();
  testCommitImportBatchCreatesAcceptedQuestions();
  testQuestionHtmlSanitization();
  testQuestionKnowledgePointCrud();
  console.log('questionBankService tests passed');
}

main();
