'use strict';

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { reviewQuestionById } = require('./reviewDemoData');

const TASK_TYPES = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);
const ANSWER_POSITIONS = new Set(['end', 'after-each']);
const FORMULA_MODES = new Set(['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);

function sandboxError(code, statusCode, message = code) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalizedRequest(input = {}) {
  const taskType = String(input.taskType || '');
  if (!TASK_TYPES.has(taskType)) throw sandboxError('REVIEW_DEMO_TASK_TYPE_INVALID', 400);
  const title = String(input.title || '').trim();
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

function answerLines(question) {
  return [
    `Answer: ${question.answer}`,
    `Knowledge point: ${question.exportKnowledgePoint || question.knowledgePoint}`,
    `Explanation: ${question.exportExplanation || question.explanation}`,
  ];
}

function questionLines(question, index) {
  return [`${index + 1}. ${question.exportStem || question.stemPreview}`, ...optionText(question)];
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
    const doc = new PDFDocument({ size: 'A4', margin: 54, compress: true });
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(18).text(request.title, { align: 'center' });
    doc.moveDown(0.5).font('Helvetica').fontSize(9).text(`Review sandbox / ${request.formulaMode} / ${request.answerPosition}`, { align: 'center' });
    doc.moveDown();
    request.questions.forEach((question, index) => {
      doc.font('Helvetica-Bold').fontSize(11).text(`${index + 1}. ${question.exportStem || `Review question ${index + 1}`}`);
      optionText(question).forEach(line => doc.font('Helvetica').fontSize(10).text(line, { indent: 16 }));
      if (request.answerPosition === 'after-each') {
        answerLines(question).forEach(line => doc.font('Helvetica').fontSize(9).text(line, { indent: 16 }));
      }
      doc.moveDown(0.5);
    });
    if (request.answerPosition === 'end') {
      doc.addPage().font('Helvetica-Bold').fontSize(16).text('Reference answers', { align: 'center' }).moveDown();
      request.questions.forEach((question, index) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${index + 1}. ${question.answer}`);
        answerLines(question).slice(1).forEach(line => doc.font('Helvetica').fontSize(9).text(line, { indent: 16 }));
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
  const tasks = new Map();
  const artifacts = new Map();
  let reservedTasks = 0;

  function artifactBytes() {
    return [...artifacts.values()].reduce((sum, artifact) => sum + artifact.buffer.length, 0);
  }

  function requireSession(sessionId) {
    const value = String(sessionId || '');
    if (!value) throw sandboxError('REVIEW_DEMO_SESSION_REQUIRED', 401);
    return value;
  }

  function cleanup() {
    const current = now();
    for (const [id, task] of tasks) if (task.expiresAtMs <= current) tasks.delete(id);
    for (const [id, artifact] of artifacts) if (artifact.expiresAtMs <= current) artifacts.delete(id);
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
        const buffer = word ? await docxBuffer(request) : await pdfBuffer(request);
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
    const task = tasks.get(String(taskId));
    if (!task || task.ownerSessionId !== ownerSessionId) throw sandboxError('REVIEW_DEMO_TASK_NOT_FOUND', 404);
    if (task.expiresAtMs <= now()) { tasks.delete(task.id); throw sandboxError('REVIEW_DEMO_TASK_EXPIRED', 410); }
    return task;
  }

  function getArtifact(sessionId, artifactId) {
    const ownerSessionId = requireSession(sessionId);
    const artifact = artifacts.get(String(artifactId));
    if (!artifact || artifact.ownerSessionId !== ownerSessionId) throw sandboxError('REVIEW_DEMO_ARTIFACT_NOT_FOUND', 404);
    if (artifact.expiresAtMs <= now()) { artifacts.delete(artifact.id); throw sandboxError('REVIEW_DEMO_ARTIFACT_EXPIRED', 410); }
    return artifact;
  }

  function cancel(sessionId, taskId) {
    const task = getTask(sessionId, taskId);
    task.status = 'cancelled';
    task.phase = 'cancelled';
    task.progress = 100;
    if (task.artifact) artifacts.delete(task.artifact.id);
    task.artifact = null;
    task.result = { ...task.result, artifactId: null, downloadPath: null };
    return task;
  }

  function stats() {
    cleanup();
    return { tasks: tasks.size, artifacts: artifacts.size, bytes: artifactBytes() };
  }

  return { cancel, create, getArtifact, getTask, stats };
}

module.exports = { ANSWER_POSITIONS, FORMULA_MODES, TASK_TYPES, createReviewDemoSandbox, normalizedRequest, sandboxError, sanitizeFileBase };
