const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-access-http-'));
const qbRoot = path.join(tempRoot, 'question-bank');
fs.mkdirSync(path.join(qbRoot, 'assets', 'exports'), { recursive: true });
fs.writeFileSync(path.join(qbRoot, 'manifest.json'), JSON.stringify({ storeId: 'paper-access-store', schemaVersion: 1, authorityDatabaseId: 'paper-access-authority' }));
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'paper-access-http-jwt';
process.env.DB_PATH = path.join(tempRoot, 'test.db'); process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.QUESTION_BANK_ROOT = qbRoot; process.env.GEWU_NODE_ROLE = 'primary-host'; process.env.WRITE_ROLES = 'super_admin,admin,teacher';
process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET = 'paper-access-current-secret-with-entropy-2026!';
process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_KID = 'current'; process.env.GEWU_ARTIFACT_DOWNLOAD_TTL_SECONDS = '2';

const { DatabaseService } = require('../database');
const { ensurePaperJobSchema } = require('../services/paperJobRepository');
const questionBank = require('../services/questionBankService');
const service = new DatabaseService(); ensurePaperJobSchema(service.db);
const now = new Date().toISOString();
service.db.prepare('INSERT INTO authority_metadata (key,value,updated_at) VALUES (?,?,?)').run('database_authority_id', 'paper-access-authority', now);
service.db.prepare("INSERT INTO question_bank_store_bindings (store_id,db_authority_id,root_path,bound_by,bound_at,status) VALUES (?,?,?,?,?,'active')")
  .run('paper-access-store', 'paper-access-authority', qbRoot, 'owner-a', now);
for (const [id, role] of [['owner-a','student'],['admin-a','admin'],['other-a','student']]) service.db.prepare(`INSERT INTO users
  (id,phone,name,role,status,login_enabled,review_status,deleted,created_at,updated_at) VALUES(?,?,?, ?,1,1,'approved',0,?,?)`)
  .run(id, `139${Math.random().toString().slice(2,10)}`, id, role, now, now);
const filePath = path.join(qbRoot, 'assets', 'exports', 'physical.pdf'); fs.writeFileSync(filePath, 'physical-artifact');
service.db.prepare(`INSERT INTO paper_artifacts(artifact_id,task_id,job_key,owner_user_id,tenant_id,snapshot_hash,format,mime_type,size_bytes,sha256,page_count,formula_count,fallback_count,effective_modes_json,file_path,created_at,expires_at,storage_status)
 VALUES('artifact-http','task-http','job-http','owner-a','default','snapshot','pdf','application/pdf',17,'hash',1,0,0,'[]',?,?,?,'verified')`).run(filePath, now, new Date(Date.now()+60000).toISOString());
questionBank.createQuestion(service.db, { id: 'q-direct', stem: '1+1=?', type: 'fill', answer: '2', analysis: 'basic arithmetic', storage_state: 'host_committed' }, 'default');
const databaseModule = require('../database'); databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')]; const { createApp } = require('../app');
const token = id => jwt.sign({ id }, process.env.JWT_SECRET, { algorithm: 'HS256' });

(async () => {
  const logged = []; const originalLog = console.log; console.log = (...args) => { logged.push(args.join(' ')); originalLog(...args); };
  const listener = createApp().listen(0); const base = `http://127.0.0.1:${listener.address().port}`;
  const auth = id => ({ authorization: `Bearer ${token(id)}` });
  try {
    const issue = async id => {
      const response = await fetch(`${base}/api/cloud-relay-host/artifacts/artifact-http/access`, { method: 'GET', headers: auth(id) });
      return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
    };
    const first = await issue('owner-a'); assert.strictEqual(first.status, 200);
    assert.strictEqual(first.cacheControl, 'no-store');
    assert.strictEqual(first.body.data.fileUrl, '/api/cloud-relay-host/artifacts/artifact-http');
    assert.ok(first.body.data.token); assert.ok(!first.body.data.fileUrl.includes('token'));
    const firstDownload = await fetch(`${base}${first.body.data.fileUrl}`, { headers: { ...auth('owner-a'), 'x-gewu-artifact-token': first.body.data.token } });
    assert.strictEqual(firstDownload.status, 200); assert.strictEqual(await firstDownload.text(), 'physical-artifact');
    assert.strictEqual((await issue('admin-a')).status, 200, 'same-tenant admin may issue access');
    assert.strictEqual((await issue('other-a')).status, 403, 'non-owner must not issue access');
    assert.strictEqual((await fetch(`${base}/api/cloud-relay-host/heartbeat`, { method: 'POST', headers: auth('owner-a') })).status, 403, 'student must remain blocked from host write operations');
    await new Promise(resolve => setTimeout(resolve, 2500));
    const expiredDownload = await fetch(`${base}${first.body.data.fileUrl}`, { headers: { ...auth('owner-a'), 'x-gewu-artifact-token': first.body.data.token } });
    assert.strictEqual(expiredDownload.status, 410, 'old short token must expire');
    const refreshed = await issue('owner-a'); assert.strictEqual(refreshed.status, 200); assert.notStrictEqual(refreshed.body.data.token, first.body.data.token);
    assert.strictEqual((await fetch(`${base}${refreshed.body.data.fileUrl}`, { headers: { ...auth('owner-a'), 'x-gewu-artifact-token': refreshed.body.data.token } })).status, 200);
    assert.ok(logged.every(line => !line.includes(first.body.data.token) && !line.includes(refreshed.body.data.token)), 'request logs must never contain artifact tokens');

    process.env.GEWU_ARTIFACT_DOWNLOAD_TTL_SECONDS = '300';
    const directCall = async (idempotencyKey, extra = {}) => {
      const response = await fetch(`${base}/api/question-bank/paper-export`, { method: 'POST', headers: {
        ...auth('admin-a'), 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey,
      }, body: JSON.stringify({ title: 'Direct durable', format: 'pdf', formulaMode: 'latex-vector', answerPosition: 'end', questionIds: ['q-direct'], ...extra }) });
      return { status: response.status, body: await response.json() };
    };
    const direct = await directCall('direct-http-1'); assert.strictEqual(direct.status, 200);
    assert.ok(direct.body.data.artifactId); assert.match(direct.body.data.accessUrl, /\/access$/);
    assert.ok(!direct.body.data.fileUrl.includes('?')); assert.ok(direct.body.data.token);
    const directRow = service.db.prepare('SELECT * FROM paper_artifacts WHERE artifact_id=?').get(direct.body.data.artifactId);
    assert.strictEqual(directRow.storage_status, 'verified'); assert.ok(fs.existsSync(directRow.file_path), 'direct export must register a physical artifact');
    assert.strictEqual((await fetch(`${base}${direct.body.data.fileUrl}`, { headers: { ...auth('admin-a'), 'x-gewu-artifact-token': direct.body.data.token } })).status, 200);
    assert.strictEqual((await fetch(`${base}/api/cloud-relay-host/artifacts/${encodeURIComponent(path.basename(directRow.file_path))}`, { headers: auth('admin-a') })).status, 404, 'legacy filename lookup must not expose artifacts');
    assert.strictEqual((await fetch(`${base}${direct.body.data.accessUrl}`, { method: 'GET', headers: auth('other-a') })).status, 403);
    const repeated = await directCall('direct-http-1'); assert.strictEqual(repeated.status, 200); assert.strictEqual(repeated.body.data.artifactId, direct.body.data.artifactId);
    const savedSecret = process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET; delete process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET;
    const noSecret = await directCall('direct-http-no-secret'); assert.strictEqual(noSecret.status, 503); process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET = savedSecret;
    service.db.prepare("UPDATE question_bank_store_bindings SET status='inactive'").run();
    const noBinding = await directCall('direct-http-no-binding'); assert.notStrictEqual(noBinding.status, 200);
    service.db.prepare("UPDATE question_bank_store_bindings SET status='active'").run();
  } finally {
    console.log = originalLog; await new Promise(resolve => listener.close(resolve)); service.close(); fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('paper artifact access HTTP checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
