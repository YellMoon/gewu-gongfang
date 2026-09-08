// UTF-8: execute original delete methods and retain only local review metadata.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { describeAuthorityDraft } = require('../components/authorityDraftPresentation');
(async () => {
  const { createAuthorityDraftFromLocalMutation } = await import('./authorityDraftAdapter.mjs');
  const pairs = [['Room','rooms'],['School','schools'],['Institution','institutions'],['Student','students'],['Course','courses'],
    ['Schedule','schedules'],['Teacher','teachers'],['Payment','payments'],['Consumption','consumptions'],
    ['AssetRecord','assetRecords'],['AssetCategory','assetCategories'],['Grade','grades']];
  const ast = ts.createSourceFile('browserDatabase.ts', fs.readFileSync(path.join(__dirname,'browserDatabase.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const methods = [];
  function visit(n) { if (ts.isMethodDeclaration(n) && pairs.some(([name]) => n.name.getText(ast) === 'delete'+name)) methods.push(n.getText(ast)); ts.forEachChild(n,visit); }
  visit(ast); assert.equal(methods.length,pairs.length);
  const Cache = new Function(ts.transpileModule(`class Cache {${methods.join('\n')}}; return Cache;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
  for (const [method,collection] of pairs) {
    const row = {id:'target',name:'待删除对象',display_name:'原课程名称',course_id:'course',student_id:'student',
      amount:180,score:95,subject:'物理',start_time:'2026-09-08T06:00:00Z',end_time:'2026-09-08T07:00:00Z',
      room:'湖畔教室',updated_at:'2026-09-08T00:00:00.000Z',phone:'must-not-copy',secret:'must-not-copy'};
    // UTF-8: financial and schedule rows have references, not invented name columns.
    if (['Schedule','Payment','Consumption','AssetRecord','Grade'].includes(method)) { delete row.name; delete row.display_name; }
    const cache = new Cache(); cache.data = {[collection]:[structuredClone(row)]};
    let draft; cache.saveData=()=>{}; cache.createBusinessDataSafetyBackup=()=>{};
    cache.recordAuthorityDraft=(collection,action,recordId,value,baseVersion)=>{draft=createAuthorityDraftFromLocalMutation({collection,action,recordId,value,baseVersion});};
    cache['delete'+method](row.id);
    assert.deepEqual(cache.data[collection],[]);
    assert.deepEqual(draft.payload,{id:'target',expectedVersion:row.updated_at},'display metadata must never expand the cloud delete command');
    assert.equal(draft.preview.record.name,row.name,'deleting from the derived cache must not erase the object shown for confirmation');
    assert(!JSON.stringify(draft).includes('must-not-copy'));
    const shown = describeAuthorityDraft(draft,{courses:[{id:'course',name:'原课程名称'}],students:[{id:'student',name:'林小禾'}]});
    assert(shown.details.some(d=>['原课程名称','待删除对象','林小禾'].includes(d.value)));
  }
  console.log('business delete review metadata and unchanged command checks passed (12 original methods)');
})().catch(error=>{console.error(error);process.exitCode=1;});
