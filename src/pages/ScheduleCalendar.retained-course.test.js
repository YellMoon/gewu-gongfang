'use strict';
// UTF-8: actual original/current handlers with a deleted parent, not rewritten business rules.
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),ts=require('typescript'),path=require('node:path'),dayjs=require('dayjs');
const root=path.resolve(__dirname,'../..');
function source(file,old){return old?cp.execFileSync('git',['show','8118419f:'+file],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');}
function load(code,req){const module={exports:{}};new Function('require','module','exports',ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(req,module,module.exports);return module.exports;}
function named(code,name){const ast=ts.createSourceFile('calendar.tsx',code,99,true,4);let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert(found,name);return found.getText(ast);}
const versions=[true,false].map(old=>{
  const types=load(source('src/types/index.ts',old),require);
  const financial=load(source('src/utils/financialDetails.ts',old),name=>name==='../types'?types:require(name));
  return {calendar:source('src/pages/ScheduleCalendar.tsx',old),financial,types,compiled:new Map()};
});
function execute(action,schedule,old,confirm=true,overlap=false,options={}){
  const v=versions[old?0:1],unaffected={...schedule,id:'unaffected'},state={rows:[schedule,unaffected],writes:0,editorOpened:false};
  const env={schedule,newDay:dayjs('2026-09-15'),newSlot:120,courses:options.courseDeleted===false?[{id:schedule.course_id,name:'Original course',teacher_id:'teacher-1',student_pricings:schedule.student_pricings}]:[],students:options.studentDeleted?[]:[{id:'student-1',name:'Original student'}],teachers:[{id:'teacher-1',name:'Original teacher'}],rooms:[],dayjs,
    schedules:state.rows,window:{confirm:()=>confirm},message:{success:()=>{},warning:()=>{}},uuidv4:()=> 'copy',
    slotToTime:slot=>({hour:Math.floor(slot/12),minute:(slot%12)*5}),formatTime:(h,m)=>String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'),GLOBAL_MAX_SLOT:287,
    checkOverlap:()=>overlap?schedule:null,resolveScheduleRoomDisplay:s=>s.room,resolveCalendarRoomDisplay:s=>s.room,
    setSchedulesWithHistory:fn=>{state.rows=fn(state.rows);state.writes++;},
    studentEditForm:{setFieldsValue:()=>{throw Error('deleted course must not open original editor');}},setStudentEditModal:()=>{state.editorOpened=true;},
    buildScheduleFinancialSnapshot:v.financial.buildScheduleFinancialSnapshot,...v.types};
  const calls={move:'handleDragSchedule(schedule,newDay,newSlot,false)',copy:'handleDragSchedule(schedule,newDay,newSlot,true)',resize:'handleResizeSchedule(schedule,null,132)',delete:'handleDeleteSchedule(schedule.id)',attendance:'handleOpenStudentEdit(schedule)'};
  const handler={move:'handleDragSchedule',copy:'handleDragSchedule',resize:'handleResizeSchedule',delete:'handleDeleteSchedule',attendance:'handleOpenStudentEdit'}[action];
  if(!v.compiled.has(action)){
    const code=named(v.calendar,'buildFinancialFieldsForSchedule')+'\n'+named(v.calendar,handler)+'\n'+calls[action];
    v.compiled.set(action,new Function(...Object.keys(env),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText));
  }
  v.compiled.get(action)(...Object.values(env));
  assert.deepEqual(state.rows.find(s=>s.id==='unaffected'),unaffected);
  state.rows=state.rows.map(s=>({...s,start_time:dayjs(s.start_time).toISOString(),end_time:dayjs(s.end_time).toISOString()}));
  return state;
}
function verify(options={}){
  // UTF-8: execute the original deletion, proving it retains course/lesson relationships.
  if(options.studentDeleted){
    const code=source('src/services/browserDatabase.ts',true),ast=ts.createSourceFile('database.ts',code,99,true);let method;
    function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='deleteStudent')method=n;ts.forEachChild(n,visit);}visit(ast);assert(method);
    const state={data:{students:[{id:'student-1'}],courses:[{id:'course-1',student_pricings:[{student_id:'student-1'}]}],schedules:[{id:'lesson',student_pricings:[{student_id:'student-1',tuition:180,teacher_fee:120}]}]},saveData(){},recordSyncChange(){}};
    const expected=structuredClone(state.data);expected.students=[];
    const run=load('module.exports=function(id:string)'+method.body.getText(ast),require);assert.equal(run.call(state,'student-1'),true);assert.deepEqual(state.data,expected);
  }
  const previous=process.env.TZ;process.env.TZ='Asia/Shanghai';const cases=[];
  try{
    for(const billing_unit of [1,2])for(const teacher_fee_mode of [1,2])for(const status of [1,3,4]){
      const schedule={id:'lesson',course_id:'course-1',course_name:'Original course',room:'Original room',start_time:'2026-09-14 09:00',end_time:'2026-09-14 10:30',status:1,
        billing_unit,teacher_fee_mode,teacher_id:'teacher-1',teacher_name:'Original teacher',source_type:1,service_type:1,
        student_pricings:[{student_id:'student-1',tuition:180,teacher_fee:120,status}],calculated_tuition:270,calculated_teacher_fee:180};
      for(const action of (options.courseDeleted===false?['move','copy','resize','delete']:['move','copy','resize','delete','attendance'])){
        const before=JSON.stringify(schedule),original=execute(action,schedule,true,true,false,options),current=execute(action,schedule,false,true,false,options);
        assert.deepEqual(current,original,action+' with deleted course');assert.equal(JSON.stringify(schedule),before);
        if(action==='attendance'){assert.equal(current.editorOpened,false);assert.equal(current.writes,0);}else assert.equal(current.writes,1);
        cases.push({action,schedule,result:current.rows.find(s=>s.id===(action==='copy'?'copy':'lesson'))});
      }
      for(const old of [true,false]){
        assert.equal(execute('delete',schedule,old,false,false,options).writes,0);
        assert.equal(execute('move',schedule,old,true,true,options).writes,0);
        assert.equal(execute('resize',schedule,old,true,true,options).writes,0);
      }
    }
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  return cases;
}
function verifyAttendance(){
  // UTF-8: execute original open/save handlers with no live student profile.
  let count=0;
  for(const billing_unit of [1,2])for(const teacher_fee_mode of [1,2])for(const status of [1,3,4]){
    const schedule={id:'lesson',course_id:'course-1',start_time:'2026-09-14 09:00',end_time:'2026-09-14 10:30',status:1,billing_unit,teacher_fee_mode,teacher_id:'teacher-1',teacher_name:'Original teacher',student_pricings:[{student_id:'deleted-student',tuition:180,teacher_fee:120,status:1}]};
    const outcomes=versions.map(v=>{
      const course={id:'course-1',course_type:1,student_pricings:schedule.student_pricings},modal={open:false,schedule:null};let fields,writes=0,rows=[schedule];
      const env={schedule,courses:[course],allStudents:[],students:[],teachers:[],studentEditModal:modal,
        studentEditForm:{setFieldsValue:value=>{fields=value;},getFieldsValue:()=>({students:fields.students.map(p=>({...p,status}))})},
        setStudentEditModal:value=>Object.assign(modal,value),setSchedulesWithHistory:fn=>{rows=fn(rows);writes++;},message:{success(){}},
        buildScheduleFinancialSnapshot:v.financial.buildScheduleFinancialSnapshot,...v.types};
      const code=['getSchedulePricingsForEdit','buildFinancialFieldsForSchedule','isPureInstitutionSchedule','getInstitutionSchedulePricing','handleOpenStudentEdit','handleSaveStudentEdit'].map(name=>named(v.calendar,name)).join('\n')+'\nhandleOpenStudentEdit(schedule);handleSaveStudentEdit();';
      new Function(...Object.keys(env),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(env));
      assert.equal(writes,1);assert.equal(modal.open,false);assert.equal(rows[0].student_pricings[0].student_id,'deleted-student');
      assert.equal(rows[0].student_pricings[0].status,status);assert.equal(rows[0].student_pricings[0].tuition,180);assert.equal(rows[0].student_pricings[0].teacher_fee,120);
      assert.equal(rows[0].calculated_tuition,status===1?180*(billing_unit===1?1.5:1):0);
      assert.equal(rows[0].calculated_teacher_fee,status===1?120*(billing_unit===1?1.5:1):0);
      return rows;
    });
    assert.deepEqual(outcomes[0],outcomes[1]);count++;
  }
  return count;
}
module.exports={verify,verifyAttendance};
if(require.main===module){const cases=verify();console.log('original/current retained-course handlers passed: '+cases.length+' cases, cancellation and overlap boundaries');}
