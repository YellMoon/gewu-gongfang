'use strict';
// UTF-8: compare the actual original and current save handlers; no replacement business implementation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const ts=require('typescript');
const dayjs=require('dayjs');
const baseline='8118419f';
const calendarPath='src/pages/ScheduleCalendar.tsx';
const oldCalendar=cp.execFileSync('git',['show',baseline+':'+calendarPath],{encoding:'utf8'});
const currentCalendar=fs.readFileSync(calendarPath,'utf8');
function moduleFrom(source,localRequire){
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(localRequire,module,module.exports);return module.exports;
}
const types=moduleFrom(fs.readFileSync('src/types/index.ts','utf8'),require);
const financial=moduleFrom(fs.readFileSync('src/utils/financialDetails.ts','utf8'),name=>name==='../types'?types:require(name));
const oldFinancial=moduleFrom(cp.execFileSync('git',['show',baseline+':src/utils/financialDetails.ts'],{encoding:'utf8'}),name=>name==='../types'?types:require(name));
const handlers=new Map();
function namedFunction(source,name){
  const ast=ts.createSourceFile(calendarPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);};visit(ast);assert(found,name);
  return ts.transpileModule(found.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
async function saveWith(source,course,financialRules){
  const dates=['2026-09-14','2026-09-16','2026-09-18'].map(date=>dayjs(date));
  const values={startTime:dayjs('2026-09-14T10:00:00'),duration:1.5,teacherId:'teacher',courseId:course.id,room:'room',notes:'原批量排课'};
  const state={schedules:[],warnings:[],modal:true,historyWrites:0};let validation;
  const env={form:{getFieldsValue:()=>values,validateFields:()=>({then:callback=>validation=Promise.resolve().then(()=>callback(values))})},
    courses:[course],rooms:[{id:'room',name:'东湖上课点'}],teachers:[{id:'teacher',name:'教师'}],dayjs,
    getCourseDisplayName:c=>c.display_name,batchDates:dates,editingSchedule:null,
    checkOverlap:(_id,start)=>dayjs(start).format('YYYY-MM-DD')==='2026-09-16'?{course_name:'已排课程',start_time:'2026-09-16 10:00',end_time:'2026-09-16 11:30'}:null,
    setSchedulesWithHistory:updater=>{state.schedules=updater(state.schedules);state.historyWrites++;},
    setModalVisible:value=>{state.modal=value;},pendingSaveNoticeRef:{current:null},
    uuidv4:()=> 'created-'+state.generated++,message:{warning:text=>state.warnings.push(text),success:()=>{}},
    window:{},console:{error:error=>{throw error;}},DEFAULT_DURATION_HOURS:1.5,...types,
    buildScheduleFinancialSnapshot:financialRules.buildScheduleFinancialSnapshot};
  state.generated=0;
  if(!handlers.has(source))handlers.set(source,new Function(...Object.keys(env),namedFunction(source,'buildFinancialFieldsForSchedule')+namedFunction(source,'handleSave')+';handleSave();'));
  const execute=handlers.get(source);
  execute(...Object.values(env));await validation;
  return state;
}
(async()=>{
  const previousTimezone=process.env.TZ;process.env.TZ='Asia/Shanghai';
  const {createAuthorityDraftFromLocalMutation}=await import('../services/authorityDraftAdapter.mjs');
  const {createDesktopCloudBusinessDraftAdapter}=await import('../services/desktopCloudBusinessDraft.mjs');
  try{
    let cases=0;
    for(const source_type of [1,2,3])for(const type of [1,2,3,4])for(const billing_unit of [1,2])for(const teacher_fee_mode of [1,2])for(const attendance of [[1,1],[1,3],[4,1]]){
      const course={id:'course',display_name:'双人课程',type,source_type,billing_unit,teacher_fee_mode,teacher_id:'teacher',year:2026,semester:'秋学期',
        student_pricings:[{student_id:'student-a',tuition:180,teacher_fee:120,status:attendance[0]},{student_id:'student-b',tuition:130,teacher_fee:80,status:attendance[1]}]};
      const before=JSON.stringify(course),old=await saveWith(oldCalendar,course,oldFinancial),current=await saveWith(currentCalendar,course,financial);
      const normalize=rows=>rows.map(row=>({...row,start_time:dayjs(row.start_time).toISOString(),end_time:dayjs(row.end_time).toISOString()}));
      assert.deepEqual(normalize(current.schedules),normalize(old.schedules),'original/new batch save must agree');
      assert.equal(current.schedules.length,2,'retain original per-date conflict skipping');
      assert.equal(current.warnings.length,1);assert.equal(current.historyWrites,1);assert.equal(current.modal,false);
      const multiplier=billing_unit===1?1.5:1;
      const tuition=(attendance[0]===1?180:0)+(attendance[1]===1?130:0);
      const teacherFee=(attendance[0]===1?120:0)+(attendance[1]===1?80:0);
      for(const record of current.schedules){
        assert.equal(record.calculated_tuition,tuition*multiplier);assert.equal(record.calculated_teacher_fee,teacherFee*multiplier);
        assert.deepEqual(record.student_pricings.map(p=>p.status),attendance);
        const draft=createAuthorityDraftFromLocalMutation({collection:'schedules',action:'create',recordId:record.id,value:record});
        let submitted;
        const adapter=createDesktopCloudBusinessDraftAdapter({baseUrl:'https://business.example',sha256:value=>'hash:'+value,
          cloudClient:{createCloudSchedule:async input=>{submitted=input;return {id:record.id};}}});
        await adapter.submit(adapter.createCommand({...draft,id:'draft-'+record.id}),{sessionToken:'test-session'});
        assert.equal(submitted.tuition,record.calculated_tuition);assert.equal(submitted.teacherFee,record.calculated_teacher_fee);
        assert.equal(submitted.billingUnit,billing_unit);assert.equal(submitted.teacherFeeMode,teacher_fee_mode);
        assert.deepEqual(submitted.pricings.map(p=>p.attendanceStatus),attendance);
        assert.deepEqual(submitted.pricings.map(p=>p.studentId),['student-a','student-b']);
      }
      assert.equal(JSON.stringify(course),before);cases++;
    }
    console.log('original/current batch save and two-student draft parity checks passed: '+cases+' combinations');
  }finally{if(previousTimezone===undefined)delete process.env.TZ;else process.env.TZ=previousTimezone;}
})().catch(error=>{console.error(error);process.exitCode=1;});
