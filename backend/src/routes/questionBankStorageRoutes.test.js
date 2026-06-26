const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/routes/questionBank.js', 'utf-8');

assert.ok(
  source.includes("require('../services/questionBankStorageService')"),
  'question bank routes should use questionBankStorageService'
);
assert.ok(
  source.includes("router.get('/storage/status'"),
  'question bank routes should expose removable storage status'
);
assert.ok(
  source.includes("router.post('/storage/init'"),
  'question bank routes should expose primary-host storage initialization'
);
assert.ok(
  source.includes('findQuestionBankStore') && source.includes('QUESTION_BANK_CANDIDATE_ROOTS'),
  'question bank routes should scan candidate roots for hotplug/path changes'
);

console.log('question bank storage route checks passed');
