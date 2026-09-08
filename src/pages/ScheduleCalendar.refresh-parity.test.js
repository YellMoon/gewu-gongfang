'use strict';
// UTF-8: original refresh handler and financial implementation, with equivalent local/cloud instants.
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),ts=require('typescript'),dayjs=require('dayjs');
const source=(file,old)=>old?cp.execFileSync('git',['show','8118419f:'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
function load(code,req=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(req,m,m.exports);return m.exports;}
function named(code,name){const ast=ts.createSourceFile('calendar.tsx',code,99,true,4);let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert(found,name);return found.getText(ast);}
async function verify(){
 const {normalizeRefreshDateRange}=await import('../utils/scheduleRefreshRange.mjs');
 const previous=process.env.TZ;process.env.TZ='Asia/Shanghai';let count=0;
 try{
  const versions=[true,false].map(old=>{const types=load(source('src/types/index.ts',old));const financial=load(source('src/utils/financialDetails.ts',old),name=>name==='../types'?types:require(name));return {code:source('src/pages/ScheduleCalendar.tsx',old),financial};});
  function run(v,rows,courses,range,accept=true){
   const state={rows,writes:0,warnings:[],notices:[],prompts:[]};
   const env={schedules:rows,refreshDateRange:range,dayjs,normalizeRefreshDateRange,window:{confirm:text=>{state.prompts.push(text);return accept;},dbService:{getAllCourses:()=>courses}},
    buildCourseRefreshFinancialSnapshot:v.financial.buildCourseRefreshFinancialSnapshot,setSchedulesWithHistory:next=>{state.rows=next;state.writes++;},message:{warning:text=>state.warnings.push(text),success:text=>state.notices.push(text)}};
   if(!v.fn)v.fn=new Function(...Object.keys(env),ts.transpileModule(['stripCourseSystemPrefix','getCourseDisplayName','handleRefreshCourseInfo'].map(name=>named(v.code,name)).join('\n')+'\nhandleRefreshCourseInfo();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
   v.fn(...Object.values(env));return state;
  }
  // UTF-8: refresh replaces the teacher name from course defaults even when it is null.
  for(const teacher_name of ['Teacher',null])for(const billing_unit of [1,2])for(const teacher_fee_mode of [1,2])for(const statuses of [[1,1],[3,1],[4,3]])for(const reversed of [false,true]){
   const course={id:'course',name:'New name',display_name:'New display',room_name:'New address',type:2,year:2026,semester:'autumn',teacher_id:'teacher',teacher_name,billing_unit,teacher_fee_mode,
    student_pricings:[{student_id:'a',tuition:220,teacher_fee:160,status:statuses[0]},{student_id:'b',tuition:130,teacher_fee:90,status:statuses[1]}]};
   const times=['2026-09-06 23:55','2026-09-07 00:00','2026-09-08 09:00','2026-09-20 23:55','2026-09-21 00:00'];
   const oldRows=times.map((start,i)=>({id:'lesson-'+i,course_id:'course',course_name:'Old name',room:'Old address',start_time:start,end_time:dayjs(start).add(30,'minute').format('YYYY-MM-DD HH:mm'),status:1,notes:'Preserve note',billing_unit:1,teacher_fee_mode:1,student_pricings:[{student_id:'a',tuition:180,teacher_fee:120,status:4}],calculated_tuition:0,calculated_teacher_fee:0}));
   oldRows.forEach(row=>{row.teacher_name='Original teacher snapshot';});
   oldRows.push({...oldRows[2],id:'missing-course',course_id:'missing'});
   const cloudRows=oldRows.map(s=>({...s,start_time:dayjs(s.start_time).toISOString(),end_time:dayjs(s.end_time).toISOString()}));
   let range=[dayjs('2026-09-07'),dayjs('2026-09-20')];if(reversed)range.reverse();
   const before=JSON.stringify({oldRows,cloudRows,course}),old=run(versions[0],oldRows,[course],range),current=run(versions[1],cloudRows,[course],range);
   const normalize=state=>({...state,rows:state.rows.map(s=>({...s,start_time:dayjs(s.start_time).toISOString(),end_time:dayjs(s.end_time).toISOString()}))});
   assert.deepEqual(normalize(current),normalize(old));assert.equal(current.writes,1);assert.match(current.notices[0],/3/);
   for(const index of [0,4,5])assert.deepEqual(current.rows[index],cloudRows[index]);
   for(const index of [1,2,3]){const row=current.rows[index];assert.equal(row.room,course.room_name);assert.equal(row.billing_unit,billing_unit);assert.equal(row.teacher_fee_mode,teacher_fee_mode);assert.deepEqual(row.student_pricings,course.student_pricings);assert.equal(row.notes,'Preserve note');assert.equal(row.start_time,cloudRows[index].start_time);}
   for(const index of [1,2,3])assert.equal(current.rows[index].teacher_name,teacher_name);
   assert.equal(JSON.stringify({oldRows,cloudRows,course}),before);
   for(const [v,rows] of [[versions[0],oldRows],[versions[1],cloudRows]]){assert.equal(run(v,rows,[course],range,false).writes,0);assert.equal(run(v,rows,[course],null).writes,0);assert.equal(run(v,rows,[course],[range[0],null]).writes,0);}
   // Verify this test detects a return of the cloud end-date exclusion bug.
   const mutant={...versions[1],fn:null,code:versions[1].code.replace("dayjs(s.start_time).startOf('day')","dayjs(s.start_time)")};
   assert.notDeepEqual(normalize(run(mutant,cloudRows,[course],range)),normalize(old));count++;
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 return count;
}
module.exports={verify};
if(require.main===module)verify().then(count=>console.log('original/current refresh parity passed: '+count+' fee/status/range combinations, boundary preservation, cancellation and mutation detection')).catch(error=>{console.error(error);process.exitCode=1;});
