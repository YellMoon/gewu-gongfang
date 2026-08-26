'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const paperSource = fs.readFileSync(path.join(__dirname, '..', 'question-paper', 'index.tsx'), 'utf8');

assert.match(source, /miniappCloudBusinessApi\.listQuestionPreviews/, 'question previews must read from the cloud authority');
assert.match(source, /question\.answer/, 'limited question browsing must render the cloud-provided answer');
assert.match(source, /question\.explanation/, 'limited question browsing must render the cloud-provided explanation');
assert.match(source, /expandedQuestionId/, 'limited question browsing must reuse the desktop-style answer drawer state');
assert.match(source, /expandedQuestionId === question\.id/, 'only a selected question may reveal its answer and explanation');
assert.match(source, /expanded \? <View className='question-preview-answer'>/, 'answers must be conditional on the selected question drawer');
assert.match(source, /question\.source/, 'question cards must show the cloud-provided source label');
assert.match(source, /question\.knowledgeLabels/, 'question cards must show cloud-resolved knowledge labels');
assert.match(source, /createQuestionBasketRuntime/, 'question selection must use a scoped basket rather than an unscoped local array');
assert.match(source, /pages\/question-paper\/index/, 'the basket entry must open the dedicated paper editor');
assert.match(paperSource, /miniappCloudBusinessApi\.createPaperExportTask/, 'Word and PDF tasks must use the limited cloud export route');
assert.match(paperSource, /miniappCloudBusinessApi\.requestPaperExportDelivery/, 'completed exports must request the NAS-backed delivery through cloud');
assert.match(paperSource, /miniappCloudBusinessApi\.downloadPaperExportDelivery/, 'downloads must use the scoped cloud delivery route');
assert.match(paperSource, /miniappCloudBusinessApi\.cancelPaperExportTask/, 'queued cloud exports must expose cancellation just as the desktop editor does');
assert.match(paperSource, /sectionTitle/, 'the paper editor must keep desktop-equivalent section grouping');
assert.match(paperSource, /score/, 'the paper editor must keep desktop-equivalent question scores');
assert.match(paperSource, /moveItem/, 'the paper editor must support question ordering');
assert.match(paperSource, /layout/, 'the edited layout must be submitted with the cloud export task');
for (const retired of ['authorityProjectionApi', 'createPaperTaskV2', 'getMiniappTaskResult', 'cancelMiniappTask', 'readQuestionPreview', 'hostBaseUrl', 'targetHostDeviceId']) {
  assert.ok(!source.includes(retired) && !paperSource.includes(retired), `question workflow must not retain the retired host-dependent ${retired}`);
}

console.log('miniapp question bank cloud delivery checks passed');
