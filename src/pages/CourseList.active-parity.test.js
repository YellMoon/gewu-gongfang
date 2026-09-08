'use strict';
// UTF-8: original finish/reopen changes only active, including incomplete historical records.
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),ts=require('typescript');
function load(file,name,env={},old=false){
 const code=old?cp.execFileSync('git',['show','8118419f:'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,code,99,true,file.endsWith('tsx')?4:3);let node;
 function visit(n){if(n.name?.getText(ast)===name&&(ts.isVariableDeclaration(n)||ts.isMethodDeclaration(n)))node=n;ts.forEachChild(n,visit);}visit(ast);assert(node,name);
 const expression=ts.isVariableDeclaration(node)?node.initializer.getText(ast):`function(${node.parameters.map(p=>p.getText(ast)).join(',')})${node.body.getText(ast)}`;
 return new Function(...Object.keys(env),ts.transpileModule('return ('+expression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(env));
}
async function verify(){
 const {createAuthorityDraftFromLocalMutation}=await import('../services/authorityDraftAdapter.mjs');
 const {createDesktopCloudBusinessDraftAdapter}=await import('../services/desktopCloudBusinessDraft.mjs');
 let count=0;
 for(const active of [false,true])for(const complete of [false,true])for(const mode of ['online','offline','pending']){
  const course={id:'course',name:'Original',display_name:'Original',active,updated_at:'2026-09-01T00:00:00Z',year:complete?2026:null,semester:complete?'autumn':null,room_id:complete?'room':null,teacher_id:'teacher',student_pricings:[{student_id:'deleted-student',tuition:120,teacher_fee:80}],notes:'preserve'};
  let expected;await load('src/pages/CourseList.tsx','handleToggleActive',{dbService:{updateCourse:(id,changes)=>{expected={id,changes};}},message:{success(){}},window:{},loadData(){}},true)(course);
  const before=structuredClone(course),drafts=[],calls=[];
  const db={data:{courses:[structuredClone(course)]},saveData(){},refreshAuthorityProjection:async()=>{},recordAuthorityDraft:(collection,action,recordId,value,baseVersion)=>drafts.push(createAuthorityDraftFromLocalMutation({collection,action,recordId,value,baseVersion}))};
  db.updateCourse=load('src/services/browserDatabase.ts','updateCourse');
  const window={desktopIdentitySessionProvider:mode==='offline'?{}:{updateCloudCourse:async input=>calls.push(input)},desktopAuthority:{list:async()=>mode==='pending'?[{type:'course.update.v1',status:'awaiting_confirmation',payload:{id:'course',changes:{notes:'pending'}}}]:[]}};
  const env={window,dbService:db,loadData(){},message:{warning(){},success(){},error(text){throw Error(text);}},courseCloudPayload:load('src/pages/CourseList.tsx','courseCloudPayload'),hasPendingCourseDraft:load('src/pages/CourseList.tsx','hasPendingCourseDraft',{window}),isOfflineCloudFailure:()=>false};
  await load('src/pages/CourseList.tsx','handleToggleActive',env)(course);
  assert.deepEqual(course,before);
  if(mode==='online')assert.deepEqual(calls,[{courseId:'course',expectedUpdatedAt:course.updated_at,active:expected.changes.active}]);
  else{
   assert.equal(calls.length,0);assert.equal(drafts.length,1);assert.deepEqual(drafts[0].payload.changes,expected.changes);assert.equal(drafts[0].payload.expectedVersion,course.updated_at);
   assert.deepEqual({...db.data.courses[0],updated_at:course.updated_at},{...course,active:!active});
   const sent=[];const adapter=createDesktopCloudBusinessDraftAdapter({baseUrl:'https://example.test',sha256:text=>require('node:crypto').createHash('sha256').update(text).digest('hex'),cloudClient:{updateCloudCourse:async input=>{sent.push(input);return {id:'course'};}}});
   await adapter.submit(adapter.createCommand({...drafts[0],id:'draft'}),{sessionToken:'session'});
   assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0]).sort(),['active','baseUrl','courseId','currentSession','expectedUpdatedAt'].sort());assert.equal(sent[0].active,!active);
  }
  count++;
 }
 return count;
}
module.exports={load,verify};
if(require.main===module)verify().then(n=>console.log('original course active parity passed: '+n)).catch(e=>{console.error(e);process.exitCode=1;});
