'use strict';
// UTF-8: exercise the actual page loader, including a deleted course's retained lesson.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=ts.createSourceFile('index.tsx',fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let loader;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='loadData')loader=node.initializer.getText(source);ts.forEachChild(node,visit);}
visit(source);assert(loader);
for(const visitor of [false,true])for(const courses of [[],[{id:'course',display_name:'原课程名',name:'内部课程名',type:2}]]){
  const schedule={id:'lesson',course_id:'course',course_name:'原课程名',course_type:2,room:'原地址',calculated_tuition:270,student_pricings:[{student_id:'student',tuition:180}]};
  const data={courses,schedules:[schedule],students:[{id:'student'}]},before=structuredClone(data);let result;
  const dependencies={isLimitedIdentity:visitor,getCachedList:key=>data[key],setSchedules:value=>{result=value;},setCourses(){},setStudents(){},setLoading(){}};
  new Function(...Object.keys(dependencies),ts.transpileModule(`(${loader})();`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText)(...Object.values(dependencies));
  assert.deepEqual(result,visitor?[]:[schedule],'existing lessons keep cloud-provided names and types when the course leaves selectors');
  assert.deepEqual(data,before,'page loading must not rewrite cached records');
}
console.log('miniapp original schedule name fallback, retained fees and visitor boundary passed');
