const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

function derive(seed, scope) {
  return crypto.createHmac('sha256', seed).update(`gewu-desktop-runtime:${scope}`).digest('hex');
}

async function exportArtifact(baseUrl, token, questionId, options) {
  const idempotencyKey = `installed-smoke-${options.format}-${options.formulaMode}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const response = await fetch(`${baseUrl}/api/question-bank/paper-export`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
    title: '5.14.4 本地安装版导出验收',
      questionIds: [questionId],
      answerPosition: options.answerPosition,
      formulaMode: options.formulaMode,
      format: options.format,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`export ${options.format} failed (${response.status}): ${JSON.stringify(body)}`);
  const download = await fetch(`${baseUrl}${body.data.fileUrl}`, {
    headers: { authorization: `Bearer ${token}`, 'x-gewu-artifact-token': body.data.token },
  });
  if (!download.ok) throw new Error(`artifact download failed (${download.status})`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const signatureOk = options.format === 'pdf'
    ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : bytes.subarray(0, 2).toString('ascii') === 'PK';
  if (!signatureOk || bytes.length < 500) throw new Error(`artifact signature invalid for ${options.format}`);
  return {
    format: options.format,
    formulaMode: options.formulaMode,
    answerPosition: options.answerPosition,
    artifactId: body.data.artifactId,
    fileName: body.data.fileName,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'gewu-gongfang', 'gewugongfang.config.json'), 'utf8'));
  if (!config.desktopSyncToken || Buffer.byteLength(config.desktopSyncToken, 'utf8') < 32) throw new Error('strong desktop sync token is required');
  const db = new Database(config.mainDbPath, { fileMustExist: true });
  const actor = db.prepare("SELECT id, role FROM users WHERE deleted=0 AND status=1 AND role IN ('super_admin','admin') ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1").get();
  if (!actor) throw new Error('no active admin actor is available for installed export smoke');
  let storeBindingCreated = false;
  if (!db.prepare("SELECT 1 FROM question_bank_store_bindings WHERE status='active' LIMIT 1").get()) {
    if (actor.role !== 'super_admin') throw new Error('super administrator is required to bind the local question bank store');
    const { bindQuestionBankStoreToDatabase } = require('../../backend/src/services/questionBankStorageService');
    bindQuestionBankStoreToDatabase({
      db,
      root: config.questionBankPath,
      authz: {
        role: 'super_admin', userId: actor.id, deviceTrusted: true, deviceActive: true,
        userApproved: true, deviceOwnerUserId: actor.id,
      },
      runtime: {
        nodeRole: 'primary-host', clientType: 'desktop', tokenUse: 'desktop-session',
        deviceId: config.deviceId, tokenDeviceId: config.deviceId,
      },
    });
    storeBindingCreated = true;
  }
  let questions = db.prepare('SELECT * FROM questions WHERE deleted=0 LIMIT 200').all();
  let temporaryQuestionId = null;
  if (!questions.length) {
    const questionBank = require('../../backend/src/services/questionBankService');
    temporaryQuestionId = `installed_smoke_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    questionBank.createQuestion(db, {
      id: temporaryQuestionId,
      type: 'fill',
      status: 'published',
      answer: 'x=\\frac{1}{2}',
      analysis: '使用分式公式验收。',
      rich_content: {
        version: 1,
        type: 'question-document',
        sections: {
          stem: { type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '计算：' },
            { type: 'formula', attrs: { id: 'installed-smoke-formula', canonicalLatex: '\\frac{1}{2}+x^2', displayMode: 'inline' } },
          ] }] },
          options: [],
          subQuestions: [],
          answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { id: 'installed-smoke-answer', canonicalLatex: 'x=\\frac{1}{2}', displayMode: 'inline' } }] }] },
          analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '公式渲染验收。' }] }] },
        },
      },
    }, 'default', { userId: actor.id, deviceId: config.deviceId });
    questions = db.prepare('SELECT * FROM questions WHERE id=?').all(temporaryQuestionId);
  }
  db.close();
  const formulaQuestion = questions.find(row => /formula|latex|math|\\\\frac|data-type[^\n]*formula/i.test(JSON.stringify(row))) || questions[0];
  const secret = derive(config.desktopSyncToken, 'jwt');
  const token = jwt.sign({ id: actor.id, role: actor.role }, secret, { algorithm: 'HS256', expiresIn: '10m' });
  const baseUrl = config.hostBaseUrl || 'http://127.0.0.1:3001';
  try {
    const results = [];
    results.push(await exportArtifact(baseUrl, token, formulaQuestion.id, {
      format: 'word', formulaMode: 'word-native', answerPosition: 'end',
    }));
    results.push(await exportArtifact(baseUrl, token, formulaQuestion.id, {
      format: 'pdf', formulaMode: 'latex-vector', answerPosition: 'after-each',
    }));
    console.log(JSON.stringify({ ok: true, appVersion: '5.14.4', storeBindingCreated, usedTemporaryQuestion: Boolean(temporaryQuestionId), results }, null, 2));
  } finally {
    if (temporaryQuestionId) {
      const cleanupDb = new Database(config.mainDbPath, { fileMustExist: true });
      cleanupDb.transaction(() => {
        cleanupDb.prepare('DELETE FROM question_knowledge_points WHERE question_id=?').run(temporaryQuestionId);
        cleanupDb.prepare('DELETE FROM question_model_points WHERE question_id=?').run(temporaryQuestionId);
        cleanupDb.prepare('DELETE FROM question_assets WHERE question_id=?').run(temporaryQuestionId);
        cleanupDb.prepare('DELETE FROM question_contents WHERE question_id=?').run(temporaryQuestionId);
        cleanupDb.prepare("DELETE FROM vector_embeddings WHERE entity_type='question' AND entity_id=?").run(temporaryQuestionId);
        cleanupDb.prepare("DELETE FROM search_index_jobs WHERE entity_type='question' AND entity_id=?").run(temporaryQuestionId);
        cleanupDb.prepare('DELETE FROM outbox_events WHERE aggregate_id=?').run(temporaryQuestionId);
        cleanupDb.prepare('DELETE FROM questions WHERE id=?').run(temporaryQuestionId);
      })();
      cleanupDb.close();
    }
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
