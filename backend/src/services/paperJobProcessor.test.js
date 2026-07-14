const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { processDurablePaperTask, replayPaperCompletionOutbox } = require('./paperJobProcessor');
const { paperJobKey } = require('./paperJobRepository');
const { runPaperArtifactWorker } = require('./paperArtifactWorker');
const cloudTaskService = require('./cloudRelayTaskService');

(async () => {
  const db = new Database(':memory:');
  const remoteDb = new Database(':memory:');
  remoteDb.exec(`CREATE TABLE miniapp_tasks (
    id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, result_payload TEXT,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, protocol_version INTEGER NOT NULL,
    phase TEXT, progress INTEGER NOT NULL DEFAULT 0, claim_token_hash TEXT, row_version INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, lease_expires_at TEXT, completion_operation_id TEXT, completion_result_hash TEXT
  )`);
  remoteDb.prepare(`INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at,protocol_version,phase,progress,claim_token_hash,row_version)
    VALUES('cloud-task-1','paper-export-pdf','processing','{}','owner-a','t','t',2,'processing',5,?,7)`).run(crypto.createHash('sha256').update('claim-1').digest('hex'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-processor-'));
  let writes = 0; let callbackAttempts = 0;
  const task = {
    id: 'cloud-task-1', task_type: 'paper-export-pdf', request_hash: 'r'.repeat(64), created_by: 'owner-a',
    selection_context: { tenantId: 'tenant-a' }, payload: { questionIds: ['q1'], formulaPolicy: { forged: true }, templateVersion: 'client-forged' },
  };
  const dependencies = {
    relayScope: 'relay-primary', resolveRoot: () => root,
    selectQuestions: () => [{ id: 'q1', stem: 'immutable' }],
    deriveExportContract: () => ({ formulaPolicy: { requestedMode: 'latex-vector', rendererVersion: 'server-renderer-v1' }, templateVersion: 'server-template-sha' }),
    freezeSnapshot: ({ selectQuestions, formulaPolicy, templateVersion }) => {
      assert.strictEqual(templateVersion, 'server-template-sha'); assert.strictEqual(formulaPolicy.rendererVersion, 'server-renderer-v1');
      return { snapshot: { questions: selectQuestions(), formulaPolicy, templateVersion, assets: [] } };
    },
    writePaperArtifact: async (_format, _payload, questions, options) => {
      writes += 1; assert.strictEqual(questions[0].stem, 'immutable');
      assert.strictEqual(db.prepare('SELECT storage_status FROM paper_artifacts WHERE artifact_id=?').get(options.artifactIdentity.artifactId)?.storage_status, 'staged', 'DB stage must precede artifact rename');
      fs.mkdirSync(path.join(root, 'assets', 'exports'), { recursive: true });
      const filePath = path.join(root, 'assets', 'exports', options.finalFileName); fs.writeFileSync(filePath, 'pdf');
      return { fileName: options.finalFileName, filePath, sha256: 'a'.repeat(64), pageCount: 1, formulaCount: 2, fallbackCount: 0, effectiveFormulaModes: ['latex-vector'] };
    },
    completionClaim: { claimToken: 'claim-1', expectedRowVersion: 7 },
    completeTask: async (_taskId, body) => {
      assert.strictEqual(body.claimToken, 'claim-1'); assert.strictEqual(body.expectedRowVersion, 7);
      assert.ok(body.operationId); assert.match(body.resultHash, /^[a-f0-9]{64}$/); assert.strictEqual(body.result.artifactId, 'artifact-1');
      const completed = cloudTaskService.completeV2Task(remoteDb, _taskId, body);
      callbackAttempts += 1; if (callbackAttempts === 1) throw new Error('ack lost after remote commit');
      return completed;
    },
    queryTaskState: async () => { throw new Error('state query unavailable during ACK loss'); },
    now: () => '2026-07-13T00:00:00.000Z', artifactIdFactory: () => 'artifact-1',
  };
  try {
    const first = await processDurablePaperTask(task, db, dependencies);
    assert.strictEqual(first.artifactReady, true);
    assert.strictEqual(first.callbackPending, true, 'callback loss must not mark a ready artifact failed');
    assert.strictEqual(first.accessEndpoint, '/api/cloud-relay-host/artifacts/artifact-1/access');
    assert.strictEqual(first.downloadToken, undefined);
    assert.strictEqual(first.downloadUrl, undefined);
    assert.strictEqual(writes, 1);
    assert.strictEqual(db.prepare("SELECT status FROM paper_jobs").get().status, 'completed');
    assert.strictEqual(db.prepare("SELECT status FROM paper_completion_outbox").get().status, 'pending');
    const pendingOutbox = db.prepare('SELECT claim_token,expected_row_version,operation_id,result_hash,payload_json FROM paper_completion_outbox').get();
    assert.strictEqual(pendingOutbox.claim_token, 'claim-1'); assert.strictEqual(pendingOutbox.expected_row_version, 7);
    assert.ok(pendingOutbox.operation_id); assert.match(pendingOutbox.result_hash, /^[a-f0-9]{64}$/);
    assert.strictEqual(pendingOutbox.payload_json, cloudTaskService.canonicalResultJson(JSON.parse(pendingOutbox.payload_json)), 'outbox must persist the same canonical result bytes accepted by cloud completion');
    const stableResult = JSON.parse(pendingOutbox.payload_json);
    assert.strictEqual(stableResult.accessEndpoint, '/api/cloud-relay-host/artifacts/artifact-1/access');
    assert.strictEqual(stableResult.downloadToken, undefined, 'outbox must never persist a short-lived signed token');
    assert.strictEqual(stableResult.downloadUrl, undefined, 'outbox must never persist a signed file URL');
    const committedRemote = remoteDb.prepare("SELECT status,completion_operation_id,completion_result_hash,row_version FROM miniapp_tasks WHERE id='cloud-task-1'").get();
    assert.deepStrictEqual([committedRemote.status, committedRemote.completion_operation_id, committedRemote.completion_result_hash, committedRemote.row_version],
      ['completed', pendingOutbox.operation_id, pendingOutbox.result_hash, 8], 'the first delivery must commit remotely before its ACK is lost');

    const second = await processDurablePaperTask(task, db, dependencies);
    assert.strictEqual(second.reusedArtifact, true);
    assert.strictEqual(writes, 1, 'double execution must reuse the verified artifact');
    assert.strictEqual(db.prepare("SELECT status FROM paper_completion_outbox").get().status, 'delivered');
    const replayedRemote = remoteDb.prepare("SELECT completion_operation_id,completion_result_hash,row_version FROM miniapp_tasks WHERE id='cloud-task-1'").get();
    assert.deepStrictEqual([replayedRemote.completion_operation_id, replayedRemote.completion_result_hash, replayedRemote.row_version],
      [pendingOutbox.operation_id, pendingOutbox.result_hash, 8], 'same operation/hash replay must deliver without advancing the remote row version');

    db.prepare("UPDATE paper_completion_outbox SET status='pending',next_attempt_at=NULL").run();
    const expectedRemoteResult = JSON.parse(db.prepare('SELECT payload_json FROM paper_completion_outbox').get().payload_json);
    const replayed = await replayPaperCompletionOutbox(db, { ...dependencies,
      completeTask: async () => { throw new Error('response lost after commit'); },
      queryTaskState: async () => ({ task: { status: 'completed', result_payload: expectedRemoteResult } }),
    });
    assert.strictEqual(replayed.delivered, 1, 'restart reconciliation must replay completion idempotently');

    db.prepare("UPDATE paper_completion_outbox SET status='pending',next_attempt_at=NULL").run();
    const cancelledReplay = await replayPaperCompletionOutbox(db, {
      ...dependencies, completeTask: async () => { throw new Error('cancel won'); }, queryTaskState: async () => ({ task: { status: 'cancelled' } }),
    });
    assert.strictEqual(cancelledReplay.cancelled, 1);
    assert.strictEqual(db.prepare("SELECT status FROM paper_completion_outbox").get().status, 'terminal_cancelled');
    assert.strictEqual(db.prepare("SELECT status FROM paper_jobs WHERE job_key=?").get(first.jobKey).status, 'cancelled');
    assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='artifact-1'").get().storage_status, 'revoked');

    db.prepare("UPDATE paper_completion_outbox SET status='pending',attempt=2,next_attempt_at=NULL").run();
    await replayPaperCompletionOutbox(db, { ...dependencies, now: () => '2026-07-13T00:00:00.000Z', outboxBaseDelayMs: 1000, outboxMaxDelayMs: 2000,
      outboxJitterRatio: 0.25, random: () => 0, completeTask: async () => { throw new Error('relay offline'); }, queryTaskState: async () => ({ task: { status: 'processing' } }) });
    assert.strictEqual(db.prepare('SELECT next_attempt_at FROM paper_completion_outbox').get().next_attempt_at, '2026-07-13T00:00:01.500Z', 'outbox retry must use capped injectable jitter');
    db.prepare("UPDATE paper_completion_outbox SET status='pending',attempt=9,next_attempt_at=NULL").run();
    await replayPaperCompletionOutbox(db, { ...dependencies, outboxMaxAttempts: 10, completeTask: async () => { throw new Error('relay permanently unavailable'); }, queryTaskState: async () => ({ task: { status: 'processing' } }) });
    const terminalOutbox = db.prepare('SELECT status,next_attempt_at,last_error FROM paper_completion_outbox').get();
    assert.strictEqual(terminalOutbox.status, 'terminal_failed'); assert.strictEqual(terminalOutbox.next_attempt_at, null); assert.match(terminalOutbox.last_error, /permanently unavailable/);

    const expiredTask = { ...task, id: 'cloud-task-expired', deadline_at: '2026-07-12T23:59:59.000Z' };
    await assert.rejects(() => processDurablePaperTask(expiredTask, db, dependencies), error => error.code === 'PAPER_JOB_DEADLINE_EXCEEDED');
    assert.strictEqual(db.prepare('SELECT status FROM paper_jobs WHERE job_key=?').get(paperJobKey('relay-primary', expiredTask.id)).status, 'failed');

    const cancelTask = { ...task, id: 'cloud-task-cancel', deadline_at: null };
    await assert.rejects(() => processDurablePaperTask(cancelTask, db, {
      ...dependencies, artifactIdFactory: () => 'artifact-cancel', completeTask: async () => {},
      writePaperArtifact: async (_format, _payload, _questions, options) => {
        db.prepare('UPDATE paper_jobs SET cancel_requested_at=? WHERE job_key=?').run('2026-07-13T00:00:00.000Z', paperJobKey('relay-primary', cancelTask.id));
        options.onProgress({ phase: 'rendering' });
        if (options.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
        throw new Error('signal was not aborted');
      },
    }), error => error.code === 'ABORT_ERR');
    assert.strictEqual(db.prepare('SELECT status FROM paper_jobs WHERE job_key=?').get(paperJobKey('relay-primary', cancelTask.id)).status, 'cancelled');

    const publishCancelTask = { ...task, id: 'cloud-task-publish-cancel', deadline_at: null };
    await assert.rejects(() => processDurablePaperTask(publishCancelTask, db, {
      ...dependencies, artifactIdFactory: () => 'artifact-publish-cancel', completeTask: async () => {},
      writePaperArtifact: async (_format, _payload, _questions, options) => {
        db.prepare('UPDATE paper_jobs SET cancel_requested_at=? WHERE job_key=?').run('2026-07-13T00:00:01.000Z', paperJobKey('relay-primary', publishCancelTask.id));
        assert.strictEqual(typeof options.beforePublish, 'function', 'publisher must receive a final DB-backed cancellation/deadline gate');
        await options.beforePublish();
        throw new Error('publish gate allowed a cancelled job');
      },
    }), error => error.code === 'ABORT_ERR');
    assert.strictEqual(db.prepare('SELECT status FROM paper_jobs WHERE job_key=?').get(paperJobKey('relay-primary', publishCancelTask.id)).status, 'cancelled');

    const busyCancelTask = { ...task, id: 'cloud-task-busy-cancel', deadline_at: null };
    const busyFinalPath = path.join(root, 'busy-worker-must-not-publish.pdf');
    await assert.rejects(() => processDurablePaperTask(busyCancelTask, db, {
      ...dependencies, cancelPollMs: 5, artifactIdFactory: () => 'artifact-busy-cancel', completeTask: async () => {},
      writePaperArtifact: async (_format, _payload, _questions, options) => {
        setTimeout(() => db.prepare('UPDATE paper_jobs SET cancel_requested_at=? WHERE job_key=?')
          .run(new Date().toISOString(), paperJobKey('relay-primary', busyCancelTask.id)), 20);
        return runPaperArtifactWorker({
          workerPath: path.join(__dirname, 'paperArtifactWorker.fixture.js'),
          workerData: { syncRenderMs: 100, finalPath: busyFinalPath }, signal: options.signal,
        });
      },
    }), error => error.code === 'ABORT_ERR');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.strictEqual(fs.existsSync(busyFinalPath), false, 'parent DB polling must terminate a busy renderer even without progress messages');

    const directTask = { ...task, id: 'direct-idempotent-1', task_type: 'paper-export-pdf' };
    const outboxBeforeDirect = db.prepare('SELECT COUNT(*) AS count FROM paper_completion_outbox').get().count;
    const directFirst = await processDurablePaperTask(directTask, db, {
      ...dependencies, relayScope: 'direct', skipCompletionOutbox: true, artifactIdFactory: () => 'artifact-direct',
    });
    const directSecond = await processDurablePaperTask(directTask, db, {
      ...dependencies, relayScope: 'direct', skipCompletionOutbox: true, artifactIdFactory: () => 'artifact-direct-duplicate',
    });
    assert.strictEqual(directFirst.artifact.artifact_id, 'artifact-direct');
    assert.strictEqual(directSecond.artifact.artifact_id, 'artifact-direct');
    assert.strictEqual(directSecond.reusedArtifact, true, 'direct idempotency must reuse the registered verified artifact');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM paper_completion_outbox').get().count, outboxBeforeDirect, 'direct durable export must not create a cloud completion outbox');

    const noSecretTask = { ...task, id: 'cloud-task-no-secret' };
    const writesBeforeNoSecret = writes;
    const savedSecret = process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET; delete process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET;
    try {
      await processDurablePaperTask(noSecretTask, db, { ...dependencies, artifactIdFactory: () => 'artifact-no-secret' });
      assert.strictEqual(writes, writesBeforeNoSecret + 1, 'durable generation must not depend on a short-lived access signature');
    } finally {
      if (savedSecret === undefined) delete process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET;
      else process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET = savedSecret;
    }
  } finally {
    db.close(); remoteDb.close(); fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('paper job processor checks passed');
})().catch(error => { console.error(error); process.exit(1); });
