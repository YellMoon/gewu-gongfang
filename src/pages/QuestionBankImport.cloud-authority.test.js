'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'QuestionBankImport.tsx'), 'utf8');
assert.ok(source.includes("desktopQuestionImportClient.mjs") && source.includes('startCloudImport') && source.includes('prepareCloudImportDrafts'),
  'the import page must use the cloud task client for source intake and draft preparation');
assert.ok(source.includes('createFromWord') && source.includes('prepareDrafts') && source.includes('createNativeQuestionDraft'),
  'the import page must create cloud import tasks then create only native local drafts after explicit confirmation');
assert.ok(!source.includes('/parse-word') && !source.includes('/imports/check') && !source.includes('/commit`'),
  'the retired parser and direct legacy import endpoints must not remain in the active import page');
assert.ok(!source.includes('prepareQuestionAssetsForStorage') && !source.includes('reconcileQuestionLocalStore'),
  'the import page must not write assets or reconcile a local question bank as an import authority');
assert.ok(!source.includes('if (questionBankStorageUnavailable)'),
  'a removable disk status must not block the cloud and NAS import architecture');
console.log('question bank import cloud authority checks passed');
