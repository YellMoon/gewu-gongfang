'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

assert.match(source, /miniappCloudBusinessApi\.listQuestionPreviews/, 'question previews must read from the cloud authority');
assert.match(source, /miniappCloudBusinessApi\.createPaperExportTask/, 'Word and PDF tasks must use the limited cloud export route');
assert.match(source, /miniappCloudBusinessApi\.requestPaperExportDelivery/, 'completed exports must request the NAS-backed delivery through cloud');
assert.match(source, /miniappCloudBusinessApi\.downloadPaperExportDelivery/, 'downloads must use the scoped cloud delivery route');
for (const retired of ['authorityProjectionApi', 'createPaperTaskV2', 'getMiniappTaskResult', 'cancelMiniappTask', 'readQuestionPreview', 'hostBaseUrl', 'targetHostDeviceId']) {
  assert.ok(!source.includes(retired), `question bank must not retain the retired host-dependent ${retired}`);
}

console.log('miniapp question bank cloud delivery checks passed');
