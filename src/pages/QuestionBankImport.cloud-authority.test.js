'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'QuestionBankImport.tsx'), 'utf8');
assert.ok(source.includes("desktopQuestionImportClient.mjs") && source.includes('startLocalIntake') && source.includes('prepareCloudImportDrafts'),
  'the import page must use the cloud task client for source intake and draft preparation');
assert.ok(source.includes('parseFromWord') && source.includes('createFromParsed') && source.includes('withEditedCandidates') && source.includes('prepareDrafts') && source.includes('createNativeQuestionDraft'),
  'the import page must create cloud import tasks then create only native local drafts after explicit confirmation');
const localParse = source.slice(source.indexOf('const startLocalIntake'), source.indexOf('const refreshCloudImportTask'));
assert.ok(!localParse.includes('createFromParsed') && !localParse.includes('createFromWord'), 'local parsing and cleanup must not stage a cloud task');
assert.ok(source.includes('mediaStorageState') && source.includes('sourceStorageState') && source.includes('wordResult?.questions?.[item.itemIndex]'), 'draft creation must gate verified storage and bind the actual item index');
assert.ok(source.includes('if (localIntakeRef.current) return;'), 'cloud storage refresh must preserve local edits');
assert.ok(source.includes("item.status === 'draft_prepared'") && source.includes('preparedDraftItemsRef.current.has(item.itemId)') && source.includes('draft.import_item_id === item.itemId'), 'prepared batches resume only eligible items and do not duplicate already-created local drafts');
assert.ok(source.includes('stem: data.content, question_types: [data.type]') && source.includes('questionTypeFromParser(question.question_types)'), 'edited scalar aliases and initial parser question type stay consistent');
assert.ok(source.includes('epoch !== intakeEpochRef.current') && source.includes('if (!cloudImportTask || committingBatch) return;'), 'stale cloud reads cannot overwrite a new source or prepared batch');
assert.ok(source.includes('formatCloudImportValidationCode') && source.includes('formula_needs_review'),
  'cloud parser warnings must be shown as user-facing import review guidance');
assert.ok(source.includes('import_task_id: prepared.taskId') && source.includes('import_item_id: item.itemId')
  && source.includes('import_item_index: item.itemIndex') && source.includes('import_content_hash: item.contentHash'),
  'prepared native drafts must retain only immutable cloud import binding metadata, never media bytes');
assert.ok(!source.includes('/parse-word') && !source.includes('/imports/check') && !source.includes('/commit`'),
  'the retired parser and direct legacy import endpoints must not remain in the active import page');
assert.ok(!source.includes('prepareQuestionAssetsForStorage') && !source.includes('reconcileQuestionLocalStore'),
  'the import page must not write assets or reconcile a local question bank as an import authority');
assert.ok(!source.includes('if (questionBankStorageUnavailable)'),
  'a removable disk status must not block the cloud and NAS import architecture');
assert.ok(!source.includes("getApiBase('/api/question-bank')") && !source.includes('/storage/status'),
  'the import page must not read retired local question-bank or removable-disk storage state');
assert.ok(!source.includes('/imports/${task.id}') && !source.includes('getRecentImportTasks') && !source.includes('getImportTaskDetail'),
  'the import page must not fall back to retired local import history or task-detail endpoints');
console.log('question bank import cloud authority checks passed');
