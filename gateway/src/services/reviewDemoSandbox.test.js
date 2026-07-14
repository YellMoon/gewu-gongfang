'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { strFromU8, unzipSync } = require('fflate');
const pdfParse = require('pdf-parse');
const gatewayPackage = require('../../package.json');
const {
  ANSWER_POSITIONS,
  FORMULA_MODES,
  TASK_TYPES,
  createReviewDemoSandbox,
  normalizedRequest,
} = require('./reviewDemoSandbox');

let now = Date.parse('2026-07-14T12:00:00.000Z');
const sandbox = createReviewDemoSandbox({ now: () => now, ttlMs: 1_000, maxTasks: 4, maxArtifactBytes: 4 * 1024 * 1024 });
const base = {
  questionIds: ['review-q-1', 'review-q-2'],
  title: 'Review Sample Paper',
  answerPosition: 'end',
  formulaMode: 'word-native',
};

function documentXml(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  assert.ok(files['word/document.xml'], 'DOCX must contain word/document.xml');
  return strFromU8(files['word/document.xml']);
}

function assertXml10Characters(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const valid = codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    assert.ok(valid, `DOCX XML contains forbidden XML 1.0 code point U+${codePoint.toString(16)}`);
  }
}

function pdfVisibleAscii(buffer) {
  return [...buffer.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1], 'hex').toString('latin1'))
    .join('');
}

const turn = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  assert.deepStrictEqual([...TASK_TYPES], ['question-paper', 'paper-export-word', 'paper-export-pdf']);
  assert.deepStrictEqual([...ANSWER_POSITIONS], ['end', 'after-each']);
  assert.deepStrictEqual([...FORMULA_MODES], ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);
  for (const taskType of TASK_TYPES) assert.strictEqual(normalizedRequest({ ...base, taskType }).taskType, taskType);
  for (const answerPosition of ANSWER_POSITIONS) assert.strictEqual(normalizedRequest({ ...base, taskType: 'question-paper', answerPosition }).answerPosition, answerPosition);
  for (const formulaMode of FORMULA_MODES) assert.strictEqual(normalizedRequest({ ...base, taskType: 'question-paper', formulaMode }).formulaMode, formulaMode);

  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', questionIds: ['real-question'] }),
    error => error.code === 'REVIEW_DEMO_QUESTION_INVALID' && error.statusCode === 400,
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', formulaMode: 'unsafe' }),
    error => error.code === 'REVIEW_DEMO_FORMULA_MODE_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', answerPosition: 'hidden' }),
    error => error.code === 'REVIEW_DEMO_ANSWER_POSITION_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'real-export' }),
    error => error.code === 'REVIEW_DEMO_TASK_TYPE_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'question-paper', questionIds: Array(21).fill('review-q-1') }),
    error => error.code === 'REVIEW_DEMO_QUESTION_COUNT_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'question-paper', title: 'x'.repeat(81) }),
    error => error.code === 'REVIEW_DEMO_TITLE_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-word', title: 'Unsafe\u0000Title' }),
    error => error.code === 'REVIEW_DEMO_TITLE_INVALID',
  );
  assert.strictEqual(
    normalizedRequest({ ...base, taskType: 'question-paper', title: '\u5ba1\u6838 Cafe\u0301' }).title,
    '\u5ba1\u6838 Caf\u00e9',
  );
  assert.strictEqual(gatewayPackage.dependencies['@fontsource/noto-sans-sc'], undefined, 'the gateway must deploy its vetted font asset without a runtime package dependency');
  const cjkFontPath = path.join(__dirname, '../../assets/fonts/NotoSansCJKsc-Regular.otf');
  const cjkFontLicense = fs.readFileSync(path.join(__dirname, '../../assets/fonts/OFL.txt'), 'utf8');
  const cjkFont = fs.readFileSync(cjkFontPath);
  assert.strictEqual(cjkFont.length, 16_437_364, 'the deployed CJK font must match the vetted upstream asset size');
  assert.strictEqual(
    crypto.createHash('sha256').update(cjkFont).digest('hex'),
    '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
    'the deployed CJK font must match the vetted upstream SHA-256',
  );
  assert.match(cjkFontLicense, /SIL OPEN FONT LICENSE Version 1\.1/i);

  const chinesePdfSandbox = createReviewDemoSandbox();
  const chinesePdf = await chinesePdfSandbox.create('chinese-pdf-session', {
    ...base,
    title: '\u7ec3\u4e60\u8bd5\u5377',
    taskType: 'paper-export-pdf',
    answerPosition: 'after-each',
  });
  const chinesePdfText = (await pdfParse(chinesePdf.artifact.buffer)).text;
  assert.ok(chinesePdfText.includes('\u7ec3\u4e60\u8bd5\u5377'), 'the miniapp default Chinese title must be extractable from the PDF');
  assert.ok(chinesePdfText.includes('Answer: C'), 'embedding a CJK title font must preserve the English answer content');

  const paper = await sandbox.create('session-a', { ...base, taskType: 'question-paper' });
  assert.strictEqual(paper.status, 'completed');
  assert.strictEqual(paper.result.questionCount, 2);
  assert.strictEqual(paper.artifact, null);

  const word = await sandbox.create('session-a', { ...base, title: '../../Review: Paper?\r\n', taskType: 'paper-export-word' });
  assert.strictEqual(word.artifact.buffer.subarray(0, 2).toString(), 'PK');
  assert.strictEqual(word.artifact.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(word.artifact.fileName, /^Review-Paper-[a-f0-9]{8}\.docx$/);
  assert.ok(!/[\\/\r\n]/.test(word.artifact.fileName));
  const endAnswerXml = documentXml(word.artifact.buffer);
  assertXml10Characters(endAnswerXml);
  assert.ok(endAnswerXml.includes('Reference answers'));
  assert.ok(endAnswerXml.indexOf('Reference answers') > endAnswerXml.indexOf('2.'));
  assert.ok(endAnswerXml.includes('Knowledge point:'));
  assert.ok(endAnswerXml.includes('Explanation:'));

  const pdf = await sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', answerPosition: 'after-each', formulaMode: 'latex-vector' });
  assert.strictEqual(pdf.artifact.buffer.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual(pdf.artifact.mimeType, 'application/pdf');
  assert.ok(pdf.artifact.fileName.endsWith('.pdf'));
  const visiblePdfText = pdfVisibleAscii(pdf.artifact.buffer);
  assert.ok(visiblePdfText.includes('Review Sample Paper'));
  assert.ok(visiblePdfText.includes('Answer: C'));

  const afterEachWord = await sandbox.create('session-a', {
    ...base,
    title: '\u5ba1\u6838\u4f53\u9a8c\u7269\u7406\u8bd5\u5377',
    taskType: 'paper-export-word',
    answerPosition: 'after-each',
  });
  const afterEachXml = documentXml(afterEachWord.artifact.buffer);
  assertXml10Characters(afterEachXml);
  assert.ok(afterEachXml.includes('\u5ba1\u6838\u4f53\u9a8c\u7269\u7406\u8bd5\u5377'));
  assert.ok(afterEachXml.includes('\u3010\u793a\u4f8b\u3011'));
  assert.ok(!afterEachXml.includes('Reference answers'));
  assert.ok(afterEachXml.indexOf('Answer: C') > afterEachXml.indexOf('1. \u3010\u793a\u4f8b\u3011'));
  assert.ok(afterEachXml.indexOf('Answer: C') < afterEachXml.indexOf('2. \u3010\u793a\u4f8b\u3011'));

  assert.strictEqual(sandbox.getTask('session-a', word.id).id, word.id);
  assert.throws(() => sandbox.getTask('session-b', word.id), error => error.code === 'REVIEW_DEMO_TASK_NOT_FOUND');
  assert.throws(() => sandbox.getArtifact('session-b', word.artifact.id), error => error.code === 'REVIEW_DEMO_ARTIFACT_NOT_FOUND');
  assert.strictEqual(sandbox.getArtifact('session-a', word.artifact.id).buffer.length, word.artifact.buffer.length);

  const cancelled = sandbox.cancel('session-a', paper.id);
  assert.strictEqual(cancelled.status, 'cancelled');

  const cancelSandbox = createReviewDemoSandbox();
  const cancelWord = await cancelSandbox.create('cancel-session', { ...base, taskType: 'paper-export-word' });
  const cancelledArtifactId = cancelWord.artifact.id;
  const cancelledArtifact = cancelWord.artifact;
  cancelSandbox.cancel('cancel-session', cancelWord.id);
  assert.throws(() => cancelSandbox.getArtifact('cancel-session', cancelledArtifactId), error => error.code === 'REVIEW_DEMO_ARTIFACT_NOT_FOUND');
  assert.strictEqual(cancelledArtifact.buffer, null);
  assert.deepStrictEqual(cancelSandbox.stats(), { tasks: 1, artifacts: 0, bytes: 0 });

  const boundedTasks = createReviewDemoSandbox({ maxTasks: 1 });
  await boundedTasks.create('session-a', { ...base, taskType: 'question-paper' });
  await assert.rejects(
    boundedTasks.create('session-a', { ...base, taskType: 'question-paper' }),
    error => error.code === 'REVIEW_DEMO_SANDBOX_BUSY' && error.statusCode === 429,
  );

  const concurrentTasks = createReviewDemoSandbox({ maxTasks: 1 });
  const concurrentResults = await Promise.allSettled([
    concurrentTasks.create('session-a', { ...base, taskType: 'paper-export-word' }),
    concurrentTasks.create('session-b', { ...base, taskType: 'paper-export-pdf' }),
  ]);
  assert.strictEqual(concurrentResults.filter(result => result.status === 'fulfilled').length, 1);
  assert.strictEqual(concurrentResults.filter(result => result.reason?.code === 'REVIEW_DEMO_SANDBOX_BUSY').length, 1);
  assert.strictEqual(concurrentTasks.stats().tasks, 1);

  let activeGenerators = 0;
  let peakGenerators = 0;
  const generationReleases = [];
  const slowWordGenerator = () => new Promise(resolve => {
    activeGenerators += 1;
    peakGenerators = Math.max(peakGenerators, activeGenerators);
    generationReleases.push(() => {
      activeGenerators -= 1;
      resolve(Buffer.from('PK bounded mock artifact'));
    });
  });
  const throttledGeneration = createReviewDemoSandbox({
    maxTasks: 3,
    maxConcurrentGenerations: 2,
    artifactGenerators: { 'paper-export-word': slowWordGenerator },
  });
  const pendingGenerations = [1, 2, 3].map(index => throttledGeneration.create(`session-${index}`, {
    ...base, taskType: 'paper-export-word', title: `Concurrent ${index}`,
  }));
  await turn();
  assert.strictEqual(activeGenerators, 2);
  assert.strictEqual(peakGenerators, 2);
  generationReleases.shift()();
  generationReleases.shift()();
  await turn();
  assert.strictEqual(activeGenerators, 1);
  generationReleases.shift()();
  await Promise.all(pendingGenerations);
  assert.strictEqual(activeGenerators, 0);

  let generatorAttempts = 0;
  const generatorRecovery = createReviewDemoSandbox({
    maxTasks: 1,
    maxConcurrentGenerations: 1,
    artifactGenerators: {
      'paper-export-word': async () => {
        generatorAttempts += 1;
        if (generatorAttempts === 1) throw new Error('injected generation failure');
        return Buffer.from('PK recovered artifact');
      },
    },
  });
  await assert.rejects(
    generatorRecovery.create('recovery-session', { ...base, taskType: 'paper-export-word' }),
    /injected generation failure/,
  );
  assert.strictEqual((await generatorRecovery.create('recovery-session', { ...base, taskType: 'paper-export-word' })).status, 'completed');

  const boundedArtifacts = createReviewDemoSandbox({
    maxArtifactBytes: 4,
    artifactGenerators: { 'paper-export-pdf': async () => Buffer.alloc(3) },
  });
  const firstSmallPdf = await boundedArtifacts.create('session-a', { ...base, taskType: 'paper-export-pdf' });
  assert.strictEqual(firstSmallPdf.artifact.buffer.length, 3);
  await assert.rejects(
    boundedArtifacts.create('session-a', { ...base, taskType: 'paper-export-pdf' }),
    error => error.code === 'REVIEW_DEMO_ARTIFACT_CAPACITY_EXCEEDED' && error.statusCode === 429,
  );

  let taskExpiryNow = 0;
  const taskExpirySandbox = createReviewDemoSandbox({ now: () => taskExpiryNow, ttlMs: 1 });
  const taskExpiry = await taskExpirySandbox.create('task-expiry-session', { ...base, taskType: 'paper-export-word' });
  const taskExpiryArtifact = taskExpiry.artifact;
  taskExpiryNow = 2;
  assert.throws(() => taskExpirySandbox.getTask('task-expiry-session', taskExpiry.id), error => error.code === 'REVIEW_DEMO_TASK_EXPIRED');
  assert.strictEqual(taskExpiryArtifact.buffer, null);
  assert.deepStrictEqual(taskExpirySandbox.stats(), { tasks: 0, artifacts: 0, bytes: 0 });

  let artifactExpiryNow = 0;
  const artifactExpirySandbox = createReviewDemoSandbox({ now: () => artifactExpiryNow, ttlMs: 1 });
  const artifactExpiry = await artifactExpirySandbox.create('artifact-expiry-session', { ...base, taskType: 'paper-export-pdf' });
  const artifactExpiryReference = artifactExpiry.artifact;
  artifactExpiryNow = 2;
  assert.throws(() => artifactExpirySandbox.getArtifact('artifact-expiry-session', artifactExpiryReference.id), error => error.code === 'REVIEW_DEMO_ARTIFACT_EXPIRED');
  assert.strictEqual(artifactExpiryReference.buffer, null);
  assert.strictEqual(artifactExpiry.artifact, null);
  assert.deepStrictEqual(artifactExpirySandbox.stats(), { tasks: 0, artifacts: 0, bytes: 0 });

  now += 2_000;
  assert.deepStrictEqual(sandbox.stats(), { tasks: 0, artifacts: 0, bytes: 0 });

  console.log('review demo sandbox checks passed');
})().catch(error => { console.error(error); process.exit(1); });
