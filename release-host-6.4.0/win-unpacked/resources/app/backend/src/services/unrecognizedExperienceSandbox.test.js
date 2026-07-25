'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createUnrecognizedExperienceSandbox,
  normalizedExperienceRequest,
} = require('./unrecognizedExperienceSandbox');
const { EXPERIENCE_QUESTION_IDS } = require('./unrecognizedExperienceData');

function expectCode(callback, code) {
  assert.throws(callback, error => error?.code === code, `expected ${code}`);
}

function fakeWriter(bytesFor = () => Buffer.from('artifact')) {
  return async (format, payload, _questions, options) => {
    if (payload.delayGate) await payload.delayGate(options.signal);
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
    const filePath = path.join(options.root, 'assets', 'exports', options.finalFileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const bytes = bytesFor(format, payload);
    fs.writeFileSync(filePath, bytes);
    fs.writeFileSync(`${filePath}.verified.json`, JSON.stringify({ sha256: 'a'.repeat(64), sizeBytes: bytes.length }));
    return {
      fileName: options.finalFileName,
      filePath,
      sha256: 'a'.repeat(64),
      sizeBytes: bytes.length,
      pageCount: 1,
      formulaCount: 0,
      fallbackCount: 0,
      effectiveFormulaModes: [],
    };
  };
}

(async () => {
  const request = normalizedExperienceRequest({
    taskType: 'paper-export-word',
    title: '\u56fa\u5b9a\u793a\u4f8b\u8bd5\u5377',
    questionIds: [EXPERIENCE_QUESTION_IDS[0], EXPERIENCE_QUESTION_IDS[0], EXPERIENCE_QUESTION_IDS[2]],
    answerPosition: 'end',
    formulaMode: 'word-native',
  });
  assert.deepStrictEqual(request.questionIds, [EXPERIENCE_QUESTION_IDS[0], EXPERIENCE_QUESTION_IDS[2]]);
  assert.strictEqual(request.questions.length, 2);
  expectCode(() => normalizedExperienceRequest({ taskType: 'not-allowed', title: 'x', questionIds: [EXPERIENCE_QUESTION_IDS[0]] }), 'UNRECOGNIZED_EXPERIENCE_TASK_TYPE_INVALID');
  expectCode(() => normalizedExperienceRequest({ taskType: 'question-paper', title: 'x', questionIds: ['real-question-id'] }), 'UNRECOGNIZED_EXPERIENCE_QUESTION_INVALID');
  expectCode(() => normalizedExperienceRequest({ taskType: 'question-paper', title: '', questionIds: [EXPERIENCE_QUESTION_IDS[0]] }), 'UNRECOGNIZED_EXPERIENCE_TITLE_INVALID');
  expectCode(() => normalizedExperienceRequest({ taskType: 'question-paper', title: '\u0001', questionIds: [EXPERIENCE_QUESTION_IDS[0]] }), 'UNRECOGNIZED_EXPERIENCE_TITLE_INVALID');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-experience-sandbox-test-'));
  let clock = Date.parse('2026-07-19T00:00:00.000Z');
  const sandbox = createUnrecognizedExperienceSandbox({
    root,
    now: () => clock,
    ttlMs: 1_000,
    maxArtifactBytes: 256,
    writeArtifact: fakeWriter((_format, payload) => (
      payload.title === 'oversize' ? Buffer.alloc(257, 1) : Buffer.from('fixed-artifact')
    )),
  });
  try {
    const paper = sandbox.create('session-a', {
      taskType: 'question-paper', title: 'paper', questionIds: EXPERIENCE_QUESTION_IDS,
    });
    assert.strictEqual(paper.status, 'completed');
    assert.strictEqual(paper.result.questionCount, 4);
    assert.strictEqual(paper.result.artifactId, null);
    expectCode(() => sandbox.getTask('session-b', paper.id), 'UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND');

    const word = sandbox.create('session-a', {
      taskType: 'paper-export-word', title: 'word', questionIds: [EXPERIENCE_QUESTION_IDS[0]],
      answerPosition: 'after-each', formulaMode: 'word-native',
    });
    assert.ok(['queued', 'running'].includes(word.status));
    await sandbox.waitForTask('session-a', word.id);
    assert.strictEqual(word.status, 'completed');
    const wordArtifact = sandbox.getArtifact('session-a', word.result.artifactId);
    assert.ok(fs.existsSync(wordArtifact.filePath));
    assert.ok(wordArtifact.filePath.startsWith(root));
    assert.strictEqual(wordArtifact.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.strictEqual(word.result.downloadPath, `/api/experience/artifacts/${wordArtifact.id}`);
    expectCode(() => sandbox.getArtifact('session-b', wordArtifact.id), 'UNRECOGNIZED_EXPERIENCE_ARTIFACT_NOT_FOUND');

    const cancelled = sandbox.cancel('session-a', word.id);
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.result.artifactId, null);
    assert.strictEqual(fs.existsSync(wordArtifact.filePath), false);

    const oversized = sandbox.create('session-a', {
      taskType: 'paper-export-pdf', title: 'oversize', questionIds: [EXPERIENCE_QUESTION_IDS[3]],
    });
    await sandbox.waitForTask('session-a', oversized.id);
    assert.strictEqual(oversized.status, 'failed');
    assert.strictEqual(oversized.error.code, 'UNRECOGNIZED_EXPERIENCE_ARTIFACT_TOO_LARGE');
    assert.strictEqual(sandbox.stats().artifacts, 0);

    clock += 1_001;
    expectCode(() => sandbox.getTask('session-a', paper.id), 'UNRECOGNIZED_EXPERIENCE_TASK_EXPIRED');
    expectCode(() => sandbox.getTask('session-b', paper.id), 'UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND');
    assert.strictEqual(sandbox.stats().tasks, 0);
  } finally {
    await sandbox.close();
  }
  assert.strictEqual(fs.existsSync(root), false, 'close must remove only the dedicated sandbox root');

  const cancelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-experience-cancel-test-'));
  let releaseDelay;
  const delayed = new Promise(resolve => { releaseDelay = resolve; });
  const cancelSandbox = createUnrecognizedExperienceSandbox({
    root: cancelRoot,
    maxTasks: 1,
    writeArtifact: async (format, payload, questions, options) => {
      await Promise.race([
        delayed,
        new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true })),
      ]);
      return fakeWriter()(format, payload, questions, options);
    },
  });
  try {
    const pending = cancelSandbox.create('session-a', {
      taskType: 'paper-export-pdf', title: 'pending', questionIds: [EXPERIENCE_QUESTION_IDS[3]],
    });
    expectCode(() => cancelSandbox.create('session-a', {
      taskType: 'question-paper', title: 'second', questionIds: [EXPERIENCE_QUESTION_IDS[0]],
    }), 'UNRECOGNIZED_EXPERIENCE_SANDBOX_BUSY');
    cancelSandbox.cancel('session-a', pending.id);
    releaseDelay();
    await cancelSandbox.waitForTask('session-a', pending.id);
    assert.strictEqual(pending.status, 'cancelled');
    assert.strictEqual(cancelSandbox.stats().artifacts, 0);
  } finally {
    releaseDelay();
    await cancelSandbox.close();
  }

  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-experience-real-test-'));
  const realSandbox = createUnrecognizedExperienceSandbox({ root: realRoot, maxArtifactBytes: 32 * 1024 * 1024 });
  try {
    const realWord = realSandbox.create('real-session', {
      taskType: 'paper-export-word', title: '\u683c\u7269\u5de5\u574a\u56fa\u5b9a\u793a\u4f8b\u9898', questionIds: EXPERIENCE_QUESTION_IDS,
      answerPosition: 'end', formulaMode: 'word-native',
    });
    const realPdf = realSandbox.create('real-session', {
      taskType: 'paper-export-pdf', title: '\u683c\u7269\u5de5\u574a\u56fa\u5b9a\u793a\u4f8b\u9898', questionIds: EXPERIENCE_QUESTION_IDS,
      answerPosition: 'end', formulaMode: 'latex-vector',
    });
    await Promise.all([
      realSandbox.waitForTask('real-session', realWord.id),
      realSandbox.waitForTask('real-session', realPdf.id),
    ]);
    assert.strictEqual(realWord.status, 'completed', realWord.error?.message);
    assert.strictEqual(realPdf.status, 'completed', realPdf.error?.message);
    const docx = realSandbox.getArtifact('real-session', realWord.result.artifactId);
    const pdf = realSandbox.getArtifact('real-session', realPdf.result.artifactId);
    assert.strictEqual(fs.readFileSync(docx.filePath).subarray(0, 2).toString('ascii'), 'PK');
    assert.strictEqual(fs.readFileSync(pdf.filePath).subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(fs.existsSync(`${docx.filePath}.verified.json`));
    assert.ok(fs.existsSync(`${pdf.filePath}.verified.json`));
    assert.ok(docx.formulaCount > 0, 'the real Word artifact must contain editable formula output');
    assert.ok(pdf.formulaCount > 0, 'the real PDF artifact must contain visible formula output');
    if (process.env.GEWU_TASK7_EVIDENCE_DIR) {
      const evidenceDir = path.resolve(process.env.GEWU_TASK7_EVIDENCE_DIR);
      fs.mkdirSync(evidenceDir, { recursive: true });
      for (const [artifact, fileName] of [[docx, 'fixed-experience.docx'], [pdf, 'fixed-experience.pdf']]) {
        const destination = path.join(evidenceDir, fileName);
        fs.copyFileSync(artifact.filePath, destination);
        fs.copyFileSync(`${artifact.filePath}.verified.json`, `${destination}.verified.json`);
      }
    }
  } finally {
    await realSandbox.close();
  }

  const source = fs.readFileSync(path.join(__dirname, 'unrecognizedExperienceSandbox.js'), 'utf8');
  assert.ok(!source.includes('D:\\'));
  assert.ok(!source.includes('readonly_snapshots'));
  assert.ok(!source.includes('miniapp_tasks'));
  const bundledFont = path.join(__dirname, '../../assets/fonts/NotoSansCJKsc-Regular.otf');
  assert.ok(fs.existsSync(bundledFont), 'Backend exports must bundle a server-safe CJK font');
  assert.ok(fs.statSync(bundledFont).size > 10 * 1024 * 1024);
  assert.match(fs.readFileSync(path.join(__dirname, '../../assets/fonts/OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i);
  const artifactServiceSource = fs.readFileSync(path.join(__dirname, 'paperArtifactService.js'), 'utf8');
  assert.ok(artifactServiceSource.includes("../../assets/fonts/NotoSansCJKsc-Regular.otf"));
  console.log('unrecognized experience sandbox checks passed');
})().catch(error => { console.error(error); process.exit(1); });
