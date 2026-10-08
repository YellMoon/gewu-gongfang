// UTF-8: execute the actual TypeScript mapping with representative room data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const dayjs = require('dayjs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React }
}).outputText, filename);
const { getTodayCourseRows } = require('./todayWorkbenchData.ts');
const schedules = [{ id:'lesson', course_id:'course', room:'modd15cxsum4hsh9s9', start_time:'2026-10-09 18:15', end_time:'2026-10-09 19:35', status:1 }];
const courses = [{ id:'course', room_id:'modd15cxsum4hsh9s9', name:'理9班' }];
const rooms = [{ id:'modd15cxsum4hsh9s9', name:'工坊教室' }];
const original = JSON.stringify({schedules,courses,rooms});
assert.equal(getTodayCourseRows(schedules,courses,[],dayjs('2026-10-09'),rooms)[0].room, '工坊教室');
assert.equal(getTodayCourseRows(schedules,courses,[],dayjs('2026-10-09'),[])[0].room, '');
assert.equal(getTodayCourseRows(schedules,[{...courses[0],room_name:'工坊教室'}],[],dayjs('2026-10-09'),[])[0].room, '工坊教室');
assert.equal(JSON.stringify({schedules,courses,rooms}),original,'display must not modify source records');
console.log('today workbench room name mapping passed');
