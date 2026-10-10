'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQ } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const files = ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql', '20260824-question-taxonomy-authority.sql', '20261010-question-difficulty-coefficient.sql', '20260906-question-taxonomy-version-fence.sql', '20261007-question-taxonomy-atomic-fence.sql'];
const APPLY = { appliedAt: '2026-10-07T00:00:00.000Z', appliedBy: 'taxonomy-atomic-test' };
const version = row => row.updated_at.toISOString();
(async () => {
  const rt = createDisposablePg17Runtime(); let h;
  try {
    await rt.start(); h = await rt.createIsolatedHandle();
    await createVNextPg17CatalogBoundary(rt).apply(h, APPLY); await createBusinessFoundationCatalogBoundary(rt).apply(h, APPLY);
    await withQ(h, 'fixture-provisioner', async q => {
      await q.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of files) {
        const source = path.join(__dirname, file); if (!fs.existsSync(source)) continue;
        let sql = fs.readFileSync(source, 'utf8'); if (file.startsWith('20260823')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;'); await q.query(sql);
      }
      await q.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES('t','Synthetic',false,now(),now())");
    });
    const inspect = (sql, values) => withQ(h, 'fixture-provisioner', q => q.query(sql, values));
    const waitBlocked = async pid => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const blocked = await withQ(h, 'runtime', async q => (await q.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked);
        if (blocked) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('second connection did not reach the system concurrency boundary');
    };
    await withQ(h, 'writer', async a => {
      const old = version((await a.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('t','s','physics','Original',0)")).rows[0]);
      await a.query('BEGIN');
      const first = (await a.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','s',$1,'physics','First',1)", [old])).rows[0];
      await withQ(h, 'fixture-provisioner', async b => {
        const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await b.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
        try {
          const pending = b.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','s',$1,'physics','Second',2)", [old]);
          await waitBlocked(pid);
          await a.query('COMMIT');
          const second = (await pending).rows[0];
          assert.equal(first.outcome, 'committed'); assert.equal(second.outcome, 'conflict', 'same baseline must not overwrite the first writer');
        } finally { await b.query('RESET SESSION AUTHORIZATION'); }
      });
      await a.query('BEGIN');
      const created = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('t','strict','physics','Strict',0)")).rows[0];
      const changed = (await a.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','strict',$1,'physics','Strict changed',1)", [version(created)])).rows[0];
      assert(changed.updated_at > created.updated_at, 'versions must advance even inside one transaction');
      assert.equal((await a.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('t','strict',$1,'physics','Overwrite',2)", [version(created)])).rows[0].outcome, 'conflict');
      await a.query('COMMIT');
      await a.query('BEGIN');
      const node = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','strict-node','strict',NULL,'Node',0)")).rows[0];
      const updatedNode = (await a.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','strict-node',$1,'strict',NULL,'Changed node',1)", [version(node)])).rows[0];
      assert(updatedNode.updated_at > node.updated_at, 'node versions must advance inside one transaction');
      assert.equal((await a.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','strict-node',$1,'strict',NULL,'Stale node',2)", [version(node)])).rows[0].outcome, 'conflict');
      await a.query('COMMIT');
      const race = (await a.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('t','race','physics','Race',0)")).rows[0];
      await a.query('BEGIN');
      assert.equal((await a.query("SELECT * FROM business.vnext_delete_question_taxonomy_system_v1('t','race',$1,0)", [version(race)])).rows[0].outcome, 'committed');
      await withQ(h, 'fixture-provisioner', async b => {
        const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await b.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
        try {
          const pending = b.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','race-node','race',NULL,'Race node',0)");
          await waitBlocked(pid); await a.query('COMMIT');
          assert.equal((await pending).rows[0].outcome, 'conflict', 'a waiting node creation must not survive deletion of its system');
        } finally { await b.query('RESET SESSION AUTHORIZATION'); }
      });
      const av = version((await a.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','a','s',NULL,'A',1)")).rows[0]);
      const bv = version((await a.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','b','s',NULL,'B',2)")).rows[0]);
      await a.query('BEGIN');
      assert.equal((await a.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','a',$1,'s','b','A',1)", [av])).rows[0].outcome, 'committed');
      await withQ(h, 'fixture-provisioner', async b => {
        const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await b.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
        try {
          const pending = b.query("SELECT * FROM business.vnext_update_question_taxonomy_node_v1('t','b',$1,'s','a','B',2)", [bv]);
          await waitBlocked(pid);
          await a.query('COMMIT'); assert.equal((await pending).rows[0].outcome, 'conflict', 'opposing moves must not create a cycle');
        } finally { await b.query('RESET SESSION AUTHORIZATION'); }
      });
    });
    assert.equal((await inspect("SELECT name FROM business.question_taxonomy_systems WHERE tenant_id='t' AND id='s'")).rows[0].name, 'First');
    await inspect("UPDATE business.question_taxonomy_nodes SET parent_id='a' WHERE tenant_id='t' AND id='b'");
    await inspect("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty,taxonomy_json) VALUES('q','t','physics','single',3,'{\"taxonomyIds\":{\"s\":[\"a\",\"b\"]}}'); INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,content_hash) VALUES('q','t','Synthetic','[]',repeat('a',64))");
    const av = version((await inspect("SELECT updated_at FROM business.question_taxonomy_nodes WHERE tenant_id='t' AND id='a'")).rows[0]);
    await withQ(h, 'writer', async q => {
      await q.query("SET statement_timeout='2s'");
      try {
        const changed = (await q.query("SELECT * FROM business.vnext_delete_question_taxonomy_node_v1('t','a',$1,'s',0)", [av])).rows[0];
        assert.equal(changed.outcome, 'impact_changed'); assert.equal(changed.affected_question_count, 1);
        const deleted = (await q.query("SELECT * FROM business.vnext_delete_question_taxonomy_node_v1('t','a',$1,'s',1)", [av])).rows[0];
        assert.equal(deleted.outcome, 'committed'); assert(deleted.updated_at > new Date(av));
        assert.equal((await q.query("SELECT * FROM business.vnext_delete_question_taxonomy_node_v1('t','a',$1,'s',1)", [av])).rows[0].outcome, 'conflict');
      } finally { await q.query('RESET statement_timeout'); }
    });
    const remaining = (await inspect("SELECT q.taxonomy_json,c.version FROM business.questions q JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id WHERE q.id='q'")).rows[0];
    assert.deepEqual(remaining.taxonomy_json.taxonomyIds.s, []); assert.equal(remaining.version, 2);
    const sv = version((await inspect("SELECT updated_at FROM business.question_taxonomy_systems WHERE tenant_id='t' AND id='s'")).rows[0]);
    await withQ(h, 'writer', async q => {
      assert.equal((await q.query("SELECT * FROM business.vnext_delete_question_taxonomy_system_v1('t','s',$1,0)", [sv])).rows[0].outcome, 'committed');
      assert.equal((await q.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','late','s',NULL,'Late',0)")).rows[0].outcome, 'conflict');
    });
    assert.equal((await inspect("SELECT version FROM business.question_contents WHERE tenant_id='t' AND question_id='q'")).rows[0].version, 3);
    const security = await inspect("SELECT p.proname,r.rolname AS owner,p.prosecdef,p.proconfig,has_function_privilege('public',p.oid,'EXECUTE') AS public_execute,has_function_privilege('vnext_pg17_writer',p.oid,'EXECUTE') AS writer_execute,has_function_privilege('gewu_cloud_schedule_reader',p.oid,'EXECUTE') AS reader_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='business' AND p.proname LIKE 'vnext_%_question_taxonomy_%_v1'");
    assert.equal(security.rows.length, 6);
    for (const row of security.rows) {
      assert.equal(row.owner, 'vnext_pg17_business_owner'); assert.equal(row.prosecdef, true);
      assert.deepEqual(row.proconfig, ['search_path=pg_catalog, pg_temp']);
      assert.equal(row.public_execute, false); assert.equal(row.writer_execute, true); assert.equal(row.reader_execute, true);
    }
    await withQ(h, 'verifier', q => assert.rejects(() => q.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('t','denied','strict',NULL,'Denied',0)"), error => error.code === '42501'));
    console.log('taxonomy PG17: atomic baseline fence, strict millisecond progress, two-connection opposing moves, bounded existing-cycle deletion, content-version bumps and writer boundary passed');
  } finally { if (h) await rt.disposeHandle(h).catch(() => {}); await rt.stop().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
