'use strict';
// UTF-8: run the original rectangle-selection callback against real cloud time formats.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const dayjs=require('dayjs');
(async()=>{
  const geometry=await import('../utils/batchSelectionGeometry.mjs');
  const oldTimezone=process.env.TZ;process.env.TZ='Asia/Shanghai';
  try {
    const source=fs.readFileSync('src/pages/useBatchSelection.tsx','utf8');
    const ast=ts.createSourceFile('useBatchSelection.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let callback;
    function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='getCoursesInRect')callback=node.initializer.arguments[0];ts.forEachChild(node,visit);}
    visit(ast);assert(callback);
    const schedules=[{id:'iso',status:1,start_time:'2026-09-07T16:30:00Z',end_time:'2026-09-07T17:30:00Z'},
      {id:'old',status:1,start_time:'2026-09-08 02:00',end_time:'2026-09-08 03:00'},
      {id:'midnight',status:1,start_time:'2026-09-08T15:00:00Z',end_time:'2026-09-08T16:00:00Z'},
      {id:'cancelled',status:3,start_time:'2026-09-07T16:30:00Z',end_time:'2026-09-07T17:30:00Z'}];
    const before=JSON.stringify(schedules);
    const compiled=ts.transpileModule('return ('+callback.getText(ast)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const select=new Function('schedRef','twoWeeksRef','ScheduleStatus','slot','selectionIntersectsSchedule','splitScheduleTime',compiled)(
      {current:schedules},{current:['2026-09-07','2026-09-08'].map(x=>dayjs(x))},{PLANNED:1},geometry.timeToSlot,geometry.selectionIntersectsSchedule,geometry.splitScheduleTime);
    assert.deepEqual(select(1,1,geometry.timeToSlot(0,30),geometry.timeToSlot(1,30)),['iso']);
    assert.deepEqual(select(0,0,geometry.timeToSlot(0,0),geometry.timeToSlot(24,0)),[]);
    assert.deepEqual(select(1,1,geometry.timeToSlot(2,0),geometry.timeToSlot(3,0)),['old']);
    assert.deepEqual(select(1,1,geometry.timeToSlot(23,0),geometry.timeToSlot(24,0)),['midnight']);
    assert.equal(JSON.stringify(schedules),before);
    console.log('original batch rectangle cloud-time checks passed');
  } finally {if(oldTimezone===undefined)delete process.env.TZ;else process.env.TZ=oldTimezone;}
})().catch(error=>{console.error(error);process.exitCode=1;});
