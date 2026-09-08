'use strict';
// UTF-8: preserve the real history transitions; cloud persistence is checked by desktop UI tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/pages/ScheduleCalendar.tsx','utf8');
const ast = ts.createSourceFile('ScheduleCalendar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['undo','redo'].includes(node.name.getText(ast))) {
    assert(ts.isCallExpression(node.initializer));
    callbacks.set(node.name.getText(ast),node.initializer.arguments[0].getText(ast));
  }
  ts.forEachChild(node,visit);
}
visit(ast);
const original=[{id:'lesson',end_time:'18:00',calculated_tuition:360}];
const resized=[{id:'lesson',end_time:'18:30',calculated_tuition:450}];
for(const action of ['undo','redo']) {
  assert(callbacks.has(action));
  for(const empty of [true,false]) {
    let schedules=action==='undo'?resized:original;
    let history={past:action==='undo'&&!empty?[original]:[],future:action==='redo'&&!empty?[resized]:[]};
    const dirty={current:false};
    let scheduleUpdates=0;
    let batch;
    const compiled=ts.transpileModule('return ('+callbacks.get(action)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const execute=new Function('pastRef','futureRef','setSchedules','setHistory','setBatchSchedules','schedulesDirtyRef',compiled)(
      {current:history.past},{current:history.future},updater=>{scheduleUpdates++;schedules=updater(schedules);},
      updater=>{history=updater(history);},value=>{batch=value;},dirty);
    execute();
    assert.equal(scheduleUpdates,empty?0:1,action+' must change state only when history is available');
    assert.equal(dirty.current,!empty,action+' must persist the same restored state through the existing draft gate');
    if(empty) assert.equal(batch,undefined);
    else {
      assert.deepEqual(schedules,action==='undo'?original:resized);
      assert.deepEqual(batch,schedules);
      assert.deepEqual(action==='undo'?history.future:history.past,[action==='undo'?resized:original]);
    }
  }
}
console.log('original calendar undo/redo state transition checks passed');
