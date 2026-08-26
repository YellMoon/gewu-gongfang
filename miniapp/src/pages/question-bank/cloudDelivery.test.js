'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const display = source => source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const source = display(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'));
const paperSource = display(fs.readFileSync(path.join(__dirname, '..', 'question-paper', 'index.tsx'), 'utf8'));

assert.match(source, /miniappCloudBusinessApi\.listQuestionPreviews/, 'question previews must read from the cloud authority');
assert.match(source, /question\.answer/, 'limited question browsing must render the cloud-provided answer');
assert.match(source, /question\.explanation/, 'limited question browsing must render the cloud-provided explanation');
assert.match(source, /expandedQuestionId/, 'limited question browsing must reuse the desktop-style answer drawer state');
assert.match(source, /expandedQuestionId === question\.id/, 'only a selected question may reveal its answer and explanation');
assert.match(source, /expanded \? <View className='question-preview-answer'>/, 'answers must be conditional on the selected question drawer');
assert.match(source, /question\.source/, 'question cards must show the cloud-provided source label');
assert.match(source, /question\.knowledgeLabels/, 'question cards must show cloud-resolved knowledge labels');
assert.match(source, /requestQuestionAssetDelivery/, 'question cards must fetch NAS-backed media only through the cloud delivery boundary');
assert.match(source, /<RichText/, 'question cards must render resolved rich-media content instead of raw asset references');
assert.match(source, /createQuestionBasketRuntime/, 'question selection must use a scoped basket rather than an unscoped local array');
assert.match(source, /pages\/question-paper\/index/, 'the basket entry must open the dedicated paper editor');
assert.match(paperSource, /miniappCloudBusinessApi\.createPaperExportTask/, 'Word and PDF tasks must use the limited cloud export route');
assert.match(paperSource, /miniappCloudBusinessApi\.requestPaperExportDelivery/, 'completed exports must request the NAS-backed delivery through cloud');
assert.match(paperSource, /miniappCloudBusinessApi\.downloadPaperExportDelivery/, 'downloads must use the scoped cloud delivery route');
assert.match(paperSource, /miniappCloudBusinessApi\.cancelPaperExportTask/, 'queued cloud exports must expose cancellation just as the desktop editor does');
assert.match(paperSource, /sectionTitle/, 'the paper editor must keep desktop-equivalent section grouping');
assert.match(paperSource, /sectionOptions/, 'the paper editor must offer the same reusable section choices as the desktop editor');
assert.match(paperSource, /自定义分组/, 'the paper editor must make creating a custom section explicit instead of relying on an unlabeled field');
assert.match(paperSource, /score/, 'the paper editor must keep desktop-equivalent question scores');
assert.match(paperSource, /moveItem/, 'the paper editor must support question ordering');
assert.match(paperSource, /item\.options/, 'the paper editor must retain the selected question options, not only its stem');
assert.match(paperSource, /answerPosition === 'after'/, 'the paper editor must render answers immediately after questions when that option is selected');
assert.match(paperSource, /参考答案与解析/, 'the paper editor must render the desktop-equivalent answer sheet when answers are placed at the end');
assert.match(paperSource, /knowledgeLabels/, 'the paper editor must retain the selected question knowledge labels');
assert.match(paperSource, /requestQuestionAssetDelivery/, 'the paper editor must fetch the same cloud-backed media as the question bank');
assert.match(paperSource, /<RichText/, 'the paper editor must render resolved question media');
assert.match(paperSource, /layout/, 'the edited layout must be submitted with the cloud export task');
for (const retired of ['authorityProjectionApi', 'createPaperTaskV2', 'getMiniappTaskResult', 'cancelMiniappTask', 'readQuestionPreview', 'hostBaseUrl', 'targetHostDeviceId']) {
  assert.ok(!source.includes(retired) && !paperSource.includes(retired), `question workflow must not retain the retired host-dependent ${retired}`);
}

console.log('miniapp question bank cloud delivery checks passed');
