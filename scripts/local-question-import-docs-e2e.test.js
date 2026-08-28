'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { commandsForPreparedTask } = require('./real-question-import-submission');

const parser = path.join(__dirname, '..', 'modules', 'question-bank', 'parsers', 'parse_word.py');
const testRoot = path.join('D:\\', '\u9898\u5e93\u6d4b\u8bd5\u6587\u4ef6');
const fixtures = [
  {
    sourceType: 'exam',
    file: path.join(testRoot, '\u8bd5\u5377\u683c\u5f0f', '\u6d59\u6c5f\u7701\u91d1\u534e\u5341\u68212026\u5e744\u6708\u9ad8\u4e09\u6a21\u62df\u8003\u8bd5\u7269\u7406\u8bd5\u9898\u5377.docx'),
    expectedCount: 20,
    expectedFormulaCount: 306,
  },
  {
    sourceType: 'lecture',
    file: path.join(testRoot, '\u5904\u7406\u540e\u8bb2\u4e49', '2026\u5c4a\u9ad8\u4e09\u590d\u4e60\u8bb2\u4e49-\u5b9e\u9a8c\u4e13\u98983\uff1a\u5149\u5b66\u548c\u70ed\u5b66\u5b9e\u9a8c\uff08\u542b\u53c2\u8003\u7b54\u6848\uff09.docx'),
    expectedCount: 37,
    expectedFormulaCount: 91,
  },
];

function parseDocument(fixture) {
  assert.ok(fs.statSync(fixture.file).isFile(), `fixture source missing: ${fixture.sourceType}`);
  const result = spawnSync(process.env.PYTHON_BIN || 'python', [parser, fixture.file, fixture.sourceType], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 200 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr || `parser failed: ${fixture.sourceType}`);
  return JSON.parse(result.stdout);
}

function preparedTask(sourceType, questions) {
  const taskId = `question_import_task_local_${sourceType}_20260829`;
  return {
    taskId,
    status: 'drafts_prepared',
    items: questions.map((candidate, itemIndex) => ({
      itemId: `question_import_item_local_${sourceType}_${itemIndex}`,
      itemIndex,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(candidate), 'utf8').digest('hex'),
      status: 'draft_prepared',
      candidate,
    })),
  };
}

for (const fixture of fixtures) {
  const parsed = parseDocument(fixture);
  assert.strictEqual(parsed.success, true, `${fixture.sourceType} parse must report success`);
  assert.strictEqual(parsed.questions.length, fixture.expectedCount, `${fixture.sourceType} item count must remain stable`);
  assert.strictEqual(parsed.quality_report.formula_import.total, fixture.expectedFormulaCount, `${fixture.sourceType} formula count must remain stable`);
  assert.strictEqual(parsed.quality_report.formula_import.needs_review, 0, `${fixture.sourceType} must not have unresolved formulas`);

  const task = preparedTask(fixture.sourceType, parsed.questions);
  const prepared = commandsForPreparedTask({ task, taskId: task.taskId });
  assert.strictEqual(prepared.commands.length, fixture.expectedCount, `${fixture.sourceType} every parsed question must normalize into a cloud command`);
  assert.strictEqual(new Set(prepared.commands.map(command => command.commandId)).size, fixture.expectedCount, `${fixture.sourceType} cloud command IDs must be unique`);
  for (const command of prepared.commands) {
    assert.strictEqual(command.type, 'question.create.v1');
    assert.ok(command.payload.record.content.length > 0, `${fixture.sourceType} question command must retain its stem`);
    assert.ok(!JSON.stringify(command).includes('data:image'), `${fixture.sourceType} structured cloud command must not embed media data`);
  }
}

console.log('local real-doc question import normalization checks passed');
