'use strict';
// Execute the actual cloud command service against disposable PostgreSQL (UTF-8).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createQuestionAuthorityService } = require('../src/questionAuthorityService');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
let seq = 0;
const command = (type, payload) => ({ commandId: `metadata-${++seq}`, type, payload, payloadHash: crypto.createHash('sha256').update(stable({type, payload}), 'utf8').digest('hex') });
const metadata = { source: 'Original paper', year: '2026', grade: 'Grade 12', semester: 'spring', exam_type: 'mock', region: 'Zhejiang', school: 'Original school', subject_id: 'physics-id', chapter_id: 'chapter-id', edit_status: 'reviewed', has_image: true };
const record = { id: 'question-metadata', subject: 'physics', type: 'solution', difficulty: 3, content: 'Original stem', options: [], answer: 'Original answer', analysis: 'Original explanation', has_formula: false, ...metadata };
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-13T00:00:00.000Z', appliedBy: 'question-metadata-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql', '20260824-question-taxonomy-authority.sql']) {
        let sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
        if (file.startsWith('20260823-')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
        await db.query(sql);
      }
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now())");
      const service = createQuestionAuthorityService({query: (sql, args) => db.query(sql,args), transaction: async work => {
        await db.query('BEGIN'); try { const result = await work((sql,args) => db.query(sql,args)); await db.query('COMMIT'); return result; }
        catch (error) { await db.query('ROLLBACK'); throw error; }
      }});
      const context = {tenantId: 'tenant-1', actor: {accountId: 'teacher', roles: ['teacher']}};
      const send = (type,payload) => service.submitDesktopDraft({...context, command: command(type,payload)});
      const read = async () => (await service.list({...context,limit: 20})).questions[0];
      const subset = value => Object.fromEntries(Object.keys(metadata).map(key => [key,value[key]]));
      assert.equal((await send('question.create.v1',{record})).status,'committed');
      assert.deepEqual(subset(await read()), metadata, 'original metadata must survive create and cloud readback');
      const {id,...changes} = record;
      for (const key of Object.keys(metadata)) delete changes[key];
      assert.equal((await send('question.update.v1',{id,changes:{...changes,status:'published'},expectedVersion:1})).status,'committed');
      assert.deepEqual(subset(await read()), metadata, 'omitted metadata in older drafts must not clear original labels');
      const revised = {...metadata,source:'Reviewed source',year:'2025',has_image:false,edit_status:'unreviewed'};
      assert.equal((await send('question.update.v1',{id,changes:{...changes,...revised},expectedVersion:2})).status,'committed');
      assert.deepEqual(subset(await read()),revised);
      const stale = await send('question.update.v1',{id,changes:{...changes,source:'Stale overwrite'},expectedVersion:2});
      assert.equal(stale.status,'rejected'); assert.deepEqual(subset(await read()),revised);
      assert.equal((await send('question.update.v1',{id,changes:{...changes,source:null,year:null},expectedVersion:3})).status,'committed');
      assert.equal((await read()).source,''); assert.equal((await read()).year,null);
      for (const invalid of [{year:{}},{has_image:'false'},{edit_status:'anything'},{source:['not text']}]) {
        await assert.rejects(() => send('question.update.v1',{id,changes:{...changes,...invalid},expectedVersion:4}), e => e.code === 'CLOUD_QUESTION_INPUT_INVALID');
      }
      assert.equal((await read()).version,4);
    });
    console.log('actual cloud question metadata create/update/readback, omitted-field preservation, clear, conflict and invalid input passed');
  } finally { await runtime.disposeHandle(handle).catch(()=>{}); await runtime.stop().catch(()=>{}); }
})().catch(error => {console.error(error);process.exitCode=1;});
