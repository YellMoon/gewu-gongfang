'use strict';

const crypto = require('crypto');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { reviewQuestionById } = require('./reviewDemoData');

const CJK_PDF_FONT_PATH = path.join(__dirname, '../../assets/fonts/NotoSansCJKsc-Regular.otf');
const CJK_TITLE_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;

const TASK_TYPES = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);
const ANSWER_POSITIONS = new Set(['end', 'after-each']);
const FORMULA_MODES = new Set(['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);

function sandboxError(code, statusCode, message = code) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isXml10Text(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const valid = codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    if (!valid) return false;
  }
  return true;
}

function normalizedRequest(input = {}) {
  const taskType = String(input.taskType || '');
  if (!TASK_TYPES.has(taskType)) throw sandboxError('REVIEW_DEMO_TASK_TYPE_INVALID', 400);
  const rawTitle = String(input.title || '');
  if (!isXml10Text(rawTitle)) throw sandboxError('REVIEW_DEMO_TITLE_INVALID', 400);
  const title = rawTitle.normalize('NFC').trim();
  if (!title || title.length > 80) throw sandboxError('REVIEW_DEMO_TITLE_INVALID', 400);
  const requestedQuestionIds = Array.isArray(input.questionIds) ? input.questionIds.map(String) : [];
  if (requestedQuestionIds.length < 1 || requestedQuestionIds.length > 20) throw sandboxError('REVIEW_DEMO_QUESTION_COUNT_INVALID', 400);
  const questionIds = Array.from(new Set(requestedQuestionIds));
  const questions = questionIds.map(reviewQuestionById);
  if (questions.some(question => !question)) throw sandboxError('REVIEW_DEMO_QUESTION_INVALID', 400);
  const answerPosition = String(input.answerPosition || 'end');
  if (!ANSWER_POSITIONS.has(answerPosition)) throw sandboxError('REVIEW_DEMO_ANSWER_POSITION_INVALID', 400);
  const formulaMode = String(input.formulaMode || 'word-native');
  if (!FORMULA_MODES.has(formulaMode)) throw sandboxError('REVIEW_DEMO_FORMULA_MODE_INVALID', 400);
  return { taskType, title, questionIds, questions, answerPosition, formulaMode };
}

function sanitizeFileBase(title) {
  const safe = String(title || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || 'review-demo-paper';
}

function optionText(question) {
  return Array.isArray(question.options) ? question.options.map((value, index) => `${String.fromCharCode(65 + index)}. ${value}`) : [];
}

function answerLines(question, options = {}) {
  const knowledgePoint = options.exportSafe ? question.exportKnowledgePoint : question.knowledgePoint;
  const explanation = options.exportSafe ? question.exportExplanation : question.explanation;
  return [
    `Answer: ${question.answer}`,
    `Knowledge point: ${knowledgePoint}`,
    `Explanation: ${explanation}`,
  ];
}

function questionLines(question, index, options = {}) {
  const stem = options.exportSafe ? question.exportStem : question.stemPreview;
  return [`${index + 1}. ${stem}`, ...optionText(question)];
}

async function docxBuffer(request) {
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: request.title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Review sandbox / ${request.formulaMode} / ${request.answerPosition}` })] }),
  ];
  request.questions.forEach((question, index) => {
    questionLines(question, index).forEach((line, lineIndex) => children.push(new Paragraph({
      children: [new TextRun({ text: line, bold: lineIndex === 0 })],
    })));
    if (request.answerPosition === 'after-each') {
      answerLines(question).forEach(line => children.push(new Paragraph({ children: [new TextRun({ text: line })] })));
    }
  });
  if (request.answerPosition === 'end') {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Reference answers', bold: true })] }));
    request.questions.forEach((question, index) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${index + 1}. ${question.answer}`, bold: true })] }));
      answerLines(question).slice(1).forEach(line => children.push(new Paragraph({ children: [new TextRun({ text: line })] })));
    });
  }
  return Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
}

function pdfBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 54, compress: false });
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('NotoSansSC', CJK_PDF_FONT_PATH);
    doc.font(CJK_TITLE_PATTERN.test(request.title) ? 'NotoSansSC' : 'Helvetica-Bold')
      .fontSize(18)
      .text(request.title, { align: 'center' });
    doc.moveDown(0.5).font('Helvetica').fontSize(9).text(`Review sandbox / ${request.formulaMode} / ${request.answerPosition}`, { align: 'center' });
    doc.moveDown();
    request.questions.forEach((question, index) => {
      doc.font('Helvetica-Bold').fontSize(11).text(questionLines(question, index, { exportSafe: true })[0]);
      optionText(question).forEach(line => doc.font('Helvetica').fontSize(10).text(line, { indent: 16 }));
      if (request.answerPosition === 'after-each') {
        answerLines(question, { exportSafe: true }).forEach(line => doc.font('Helvetica').fontSize(9).text(line, { indent: 16 }));
      }
      doc.moveDown(0.5);
    });
    if (request.answerPosition === 'end') {
      doc.addPage().font('Helvetica-Bold').fontSize(16).text('Reference answers', { align: 'center' }).moveDown();
      request.questions.forEach((question, index) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${index + 1}. ${question.answer}`);
        answerLines(question, { exportSafe: true }).slice(1).forEach(line => doc.font('Helvetica').fontSize(9).text(line, { indent: 16 }));
      });
    }
    doc.end();
  });
}

function createReviewDemoSandbox(options = {}) {
  const now = options.now || Date.now;
  const ttlMs = Number(options.ttlMs ?? 30 * 60 * 1000);
  const maxTasks = Number(options.maxTasks ?? 50);
  const maxArtifactBytes = Number(options.maxArtifactBytes ?? 16 * 1024 * 1024);
  const maxConcurrentGenerations = Number(options.maxConcurrentGenerations ?? 2);
  if (!Number.isSafeInteger(maxConcurrentGenerations) || maxConcurrentGenerations < 1) {
    throw new RangeError('maxConcurrentGenerations must be a positive integer');
  }
  const artifactGenerators = {
    'paper-export-word': docxBuffer,
    'paper-export-pdf': pdfBuffer,
    ...(options.artifactGenerators || {}),
  };
  const tasks = new Map();
  const artifacts = new Map();
  const expiredTaskOwners = new Map();
  const expiredArtifactOwners = new Map();
  let reservedTasks = 0;
  let activeGenerations = 0;
  const generationWaiters = [];

  function artifactBytes() {
    return [...artifacts.values()].reduce((sum, artifact) => (
      sum + (Buffer.isBuffer(artifact.buffer) ? artifact.buffer.length : 0)
    ), 0);
  }

  function requireSession(sessionId) {
    const value = String(sessionId || '');
    if (!value) throw sandboxError('REVIEW_DEMO_SESSION_REQUIRED', 401);
    return value;
  }

  function clearTaskArtifact(task, artifact) {
    if (!task) return;
    if (task.artifact === artifact || task.result?.artifactId === artifact.id) {
      task.artifact = null;
      task.result = {
        ...task.result,
        artifactId: null,
        fileName: null,
        mimeType: null,
        downloadPath: null,
      };
    }
  }

  function rememberExpired(map, id, ownerSessionId) {
    map.delete(id);
    map.set(id, ownerSessionId);
    while (map.size > maxTasks) map.delete(map.keys().next().value);
  }

  function releaseArtifact(artifact, expired = false) {
    if (!artifact) return;
    artifacts.delete(artifact.id);
    if (expired) rememberExpired(expiredArtifactOwners, artifact.id, artifact.ownerSessionId);
    clearTaskArtifact(tasks.get(artifact.taskId), artifact);
    artifact.buffer = null;
  }

  function releaseTask(task, expired = false) {
    if (!task) return;
    const artifact = task.artifact || [...artifacts.values()].find(item => item.taskId === task.id);
    if (artifact) releaseArtifact(artifact, expired);
    tasks.delete(task.id);
    if (expired) rememberExpired(expiredTaskOwners, task.id, task.ownerSessionId);
    task.artifact = null;
  }

  function releaseArtifactAndTask(artifact, expired = false) {
    const task = artifact ? tasks.get(artifact.taskId) : null;
    if (task) releaseTask(task, expired);
    else releaseArtifact(artifact, expired);
  }

  function cleanup() {
    const current = now();
    for (const task of tasks.values()) if (task.expiresAtMs <= current) releaseTask(task, true);
    for (const artifact of artifacts.values()) {
      if (artifact.expiresAtMs <= current) releaseArtifactAndTask(artifact, true);
    }
  }

  function acquireGenerationSlot() {
    return new Promise(resolve => {
      const start = () => {
        activeGenerations += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeGenerations -= 1;
          const next = generationWaiters.shift();
          if (next) next();
        });
      };
      if (activeGenerations < maxConcurrentGenerations) start();
      else generationWaiters.push(start);
    });
  }

  async function create(sessionId, input) {
    cleanup();
    const ownerSessionId = requireSession(sessionId);
    if (tasks.size + reservedTasks >= maxTasks) throw sandboxError('REVIEW_DEMO_SANDBOX_BUSY', 429);
    reservedTasks += 1;
    try {
      const request = normalizedRequest(input);
      const taskId = `review-task-${crypto.randomUUID()}`;
      const expiresAtMs = now() + ttlMs;
      let artifact = null;
      if (request.taskType !== 'question-paper') {
        const word = request.taskType === 'paper-export-word';
        const generator = artifactGenerators[request.taskType];
        if (typeof generator !== 'function') throw new TypeError(`Missing artifact generator for ${request.taskType}`);
        const releaseGenerationSlot = await acquireGenerationSlot();
        let buffer;
        try {
          buffer = await generator(request);
        } finally {
          releaseGenerationSlot();
        }
        if (!Buffer.isBuffer(buffer)) throw new TypeError('Artifact generator must return a Buffer');
        if (buffer.length > maxArtifactBytes) throw sandboxError('REVIEW_DEMO_ARTIFACT_TOO_LARGE', 413);
        if (artifactBytes() + buffer.length > maxArtifactBytes) {
          throw sandboxError('REVIEW_DEMO_ARTIFACT_CAPACITY_EXCEEDED', 429);
        }
        artifact = {
          id: `review-artifact-${crypto.randomUUID()}`,
          ownerSessionId,
          taskId,
          fileName: `${sanitizeFileBase(request.title)}-${taskId.slice(-8)}.${word ? 'docx' : 'pdf'}`,
          mimeType: word ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
          buffer,
          expiresAtMs,
        };
        artifacts.set(artifact.id, artifact);
      }
      const task = {
        id: taskId,
        ownerSessionId,
        status: 'completed',
        phase: 'completed',
        progress: 100,
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        request: { ...request, questions: undefined },
        result: {
          questionCount: request.questions.length,
          artifactId: artifact?.id || null,
          fileName: artifact?.fileName || null,
          mimeType: artifact?.mimeType || null,
          downloadPath: artifact ? `/api/review-demo/artifacts/${artifact.id}` : null,
        },
        artifact,
      };
      tasks.set(task.id, task);
      return task;
    } finally {
      reservedTasks -= 1;
    }
  }

  function getTask(sessionId, taskId) {
    const ownerSessionId = requireSession(sessionId);
    const id = String(taskId);
    const task = tasks.get(id);
    if (!task) {
      if (expiredTaskOwners.get(id) === ownerSessionId) throw sandboxError('REVIEW_DEMO_TASK_EXPIRED', 410);
      throw sandboxError('REVIEW_DEMO_TASK_NOT_FOUND', 404);
    }
    if (task.ownerSessionId !== ownerSessionId) throw sandboxError('REVIEW_DEMO_TASK_NOT_FOUND', 404);
    if (task.expiresAtMs <= now()) { releaseTask(task, true); throw sandboxError('REVIEW_DEMO_TASK_EXPIRED', 410); }
    return task;
  }

  function getArtifact(sessionId, artifactId) {
    const ownerSessionId = requireSession(sessionId);
    const id = String(artifactId);
    const artifact = artifacts.get(id);
    if (!artifact) {
      if (expiredArtifactOwners.get(id) === ownerSessionId) throw sandboxError('REVIEW_DEMO_ARTIFACT_EXPIRED', 410);
      throw sandboxError('REVIEW_DEMO_ARTIFACT_NOT_FOUND', 404);
    }
    if (artifact.ownerSessionId !== ownerSessionId) throw sandboxError('REVIEW_DEMO_ARTIFACT_NOT_FOUND', 404);
    if (artifact.expiresAtMs <= now()) { releaseArtifactAndTask(artifact, true); throw sandboxError('REVIEW_DEMO_ARTIFACT_EXPIRED', 410); }
    return artifact;
  }

  function cancel(sessionId, taskId) {
    const task = getTask(sessionId, taskId);
    task.status = 'cancelled';
    task.phase = 'cancelled';
    task.progress = 100;
    if (task.artifact) releaseArtifact(task.artifact);
    return task;
  }

  function stats() {
    cleanup();
    return { tasks: tasks.size, artifacts: artifacts.size, bytes: artifactBytes() };
  }

  return { cancel, create, getArtifact, getTask, stats };
}

module.exports = { ANSWER_POSITIONS, FORMULA_MODES, TASK_TYPES, createReviewDemoSandbox, normalizedRequest, sandboxError, sanitizeFileBase };
