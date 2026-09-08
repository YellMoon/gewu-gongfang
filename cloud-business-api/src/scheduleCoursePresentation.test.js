'use strict';
// UTF-8: derive display expectations from the actual original desktop functions.
const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript');
const {applyScheduleCourseContext,withScheduleCourseContextSql}=require('./scheduleCoursePresentation');
const root=path.resolve(__dirname,'../..');
const text=cp.execFileSync('git',['show','8118419f:src/pages/ScheduleCalendar.tsx'],{cwd:root,encoding:'utf8'});
const source=ts.createSourceFile('ScheduleCalendar.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&['stripCourseSystemPrefix','getCourseDisplayName'].includes(node.name?.getText(source)))functions.push(node.getText(source));ts.forEachChild(node,visit);}
visit(source);assert.equal(functions.length,2);
const originalName=new Function(ts.transpileModule(functions.join('\n')+'\nreturn getCourseDisplayName;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText)();
let count=0;
for(const name of ['2026 秋学期 初二物理','2026 秋季学期 物理','2026提高班-A01','\u00a0物理\u00a0','\t2026 秋学期 物理\n',''])for(const display_name of [null,'','  指定课程名  ']){
  const course={id:'course',name,display_name,type:2,year:2026,semester:'秋学期'},lesson={id:'lesson',course_id:'course',course_name:'原课次名称',room:'原上课地址',calculated_tuition:270,calculated_teacher_fee:180,updated_at:'unchanged',student_pricings:[{student_id:'student',tuition:180,teacher_fee:120,status:1}]};
  const input={courses:[],schedules:[lesson],_scheduleCourseContext:[course]},before=structuredClone(input);
  const result=applyScheduleCourseContext(input);
  assert.equal(result.schedules[0].course_name,originalName(course,lesson.course_name));
  assert.equal(result.schedules[0].course_type,2);assert.equal(result.schedules[0].course_year,'2026');
  assert.deepEqual({...result.schedules[0],course_name:lesson.course_name,course_type:undefined,course_year:undefined,course_semester:undefined},{...lesson,course_type:undefined,course_year:undefined,course_semester:undefined});
  assert.deepEqual(result.courses,[]);assert(!Object.hasOwn(result,'_scheduleCourseContext'));assert.deepEqual(input,before);count++;
}
assert.deepEqual(applyScheduleCourseContext({schedules:[],_scheduleCourseContext:[]}),{schedules:[]});
const unrelated={schedules:[{id:'lesson',course_id:'missing',course_name:'旧名称'}],_scheduleCourseContext:[{id:'other',name:'其他课程'}]};
assert.deepEqual(applyScheduleCourseContext(unrelated),{schedules:unrelated.schedules});
const sql=withScheduleCourseContextSql('SELECT $1::jsonb AS projection');
assert(sql.includes("c.tenant_id=$1 AND c.id IN (SELECT lesson->>'course_id'"));
assert(!sql.includes('price_teacher'));assert(!sql.includes('hourly_rate'));
require('../../miniapp/src/pages/schedule/courseHistory.test');
console.log(`original course display rules, immutable lesson fields and internal-context removal passed: ${count} cases`);
