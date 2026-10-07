'use strict';
// Review fixture only: starts and disposes an isolated, synthetic PostgreSQL 17.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const fromRoot = file => require(path.join(root, file));
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQ } = fromRoot('shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = fromRoot('shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = fromRoot('shared/vnext-pg17/businessFoundationCatalogAssertion');
const names = ['vnext_update_question_taxonomy_system_v1', 'vnext_update_question_taxonomy_node_v1', 'vnext_delete_question_taxonomy_system_v1', 'vnext_delete_question_taxonomy_node_v1'];
const sqlDirectory = path.join(root, 'cloud-business-api/sql');
const lastDefinition = Object.fromEntries(names.map(name => [name, fs.readdirSync(sqlDirectory).filter(file => file.endsWith('.sql') && new RegExp('CREATE OR REPLACE FUNCTION business\\.' + name + '\\(').test(fs.readFileSync(path.join(sqlDirectory, file), 'utf8'))).sort().at(-1)]));

(async () => {
  const rt = createDisposablePg17Runtime(); let h;
  try {
    await rt.start(); h = await rt.createIsolatedHandle();
    const apply = { appliedAt: '2026-10-07T00:00:00.000Z', appliedBy: 'project-review' };
    await createVNextPg17CatalogBoundary(rt).apply(h, apply);
    await createBusinessFoundationCatalogBoundary(rt).apply(h, apply);
    await withQ(h, 'fixture-provisioner', async q => {
      await q.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const f of ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql', '20260824-question-taxonomy-authority.sql', '20260906-question-taxonomy-version-fence.sql']) {
        let sql = fs.readFileSync(path.join(sqlDirectory, f), 'utf8');
        if (f.startsWith('20260823')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
        await q.query(sql);
      }
      // Verify these are the final definitions in the current full migration list.
      console.log('Last migrations defining inspected functions:', JSON.stringify(lastDefinition));
      if (lastDefinition.vnext_update_question_taxonomy_system_v1 !== '20260824-question-taxonomy-authority.sql'
        || lastDefinition.vnext_update_question_taxonomy_node_v1 !== '20260824-question-taxonomy-authority.sql'
        || lastDefinition.vnext_delete_question_taxonomy_system_v1 !== '20260906-question-taxonomy-version-fence.sql'
        || lastDefinition.vnext_delete_question_taxonomy_node_v1 !== '20260906-question-taxonomy-version-fence.sql') throw new Error('Latest migration changed: review fixture must be updated.');
      const defs = await q.query("SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='business' AND p.proname=ANY($1::text[]) ORDER BY p.proname", [names]);
      for (const row of defs.rows) console.log('\nACTUAL FUNCTION ' + row.proname + '\n' + row.definition);
      await q.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES('t','Synthetic Review',false,now(),now())");
    });
    await withQ(h, 'writer', async a => {
      const old = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('t','s','physics','Original',0)")).rows[0].updated_at.toISOString();
      await a.query('BEGIN');
      const first = (await a.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','s',$1,'physics','First',1)", [old])).rows[0];
      await withQ(h, 'fixture-provisioner', async b => {
        await b.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
        const pending = b.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','s',$1,'physics','Second',2)", [old]);
        await new Promise(resolve => setTimeout(resolve, 250));
        await a.query('COMMIT');
        const second = (await pending).rows[0];
        await b.query('RESET SESSION AUTHORIZATION');
        console.log('LOST UPDATE:', JSON.stringify({ old, firstOutcome: first.outcome, secondOutcome: second.outcome }));
        if (first.outcome !== 'committed' || second.outcome !== 'committed') throw new Error('Lost-update reproduction changed.');
      });
      const av = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','a','s',NULL,'A',1)")).rows[0].updated_at.toISOString();
      const bv = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','b','s',NULL,'B',2)")).rows[0].updated_at.toISOString();
      await a.query('BEGIN');
      const firstMove = (await a.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','a',$1,'s','b','A',1)", [av])).rows[0];
      await withQ(h, 'fixture-provisioner', async b => {
        await b.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
        // The uncommitted A -> B is invisible to the second connection.
        const secondMove = (await b.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','b',$1,'s','a','B',2)", [bv])).rows[0];
        await a.query('COMMIT');
        await b.query('RESET SESSION AUTHORIZATION');
        console.log('TREE CYCLE:', JSON.stringify({ firstOutcome: firstMove.outcome, secondOutcome: secondMove.outcome }));
      });
    });
    await withQ(h, 'fixture-provisioner', async q => {
      console.log('FINAL SYSTEM:', JSON.stringify((await q.query("SELECT name,sort_order FROM business.question_taxonomy_systems WHERE tenant_id='t' AND id='s'")).rows));
      console.log('FINAL NODES:', JSON.stringify((await q.query("SELECT id,parent_id FROM business.question_taxonomy_nodes WHERE tenant_id='t' ORDER BY id")).rows));
      const nodeVersion = (await q.query("SELECT updated_at FROM business.question_taxonomy_nodes WHERE tenant_id='t' AND id='a'")).rows[0].updated_at.toISOString();
      await q.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
      await q.query("SET statement_timeout='500ms'");
      try {
        await q.query("SELECT * FROM business.vnext_delete_question_taxonomy_node_v1('t','a',$1,'s',0)", [nodeVersion]);
        throw new Error('Expected cyclic recursive deletion to time out.');
      } catch (error) {
        console.log('DELETE CYCLIC TREE:', JSON.stringify({ code: error.code, message: error.message }));
        if (error.code !== '57014') throw error;
      }
      await q.query('RESET SESSION AUTHORIZATION');
    });
  } finally {
    if (h) await rt.disposeHandle(h).catch(() => {});
    await rt.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
