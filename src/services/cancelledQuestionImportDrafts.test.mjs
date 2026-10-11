import assert from 'node:assert/strict';
import { discardCancelledQuestionImportDrafts } from './cancelledQuestionImportDrafts.mjs';
const draft=(id,task,status='confirmed')=>({id,type:'question.create.v1',status,payload:{record:{import_task_id:task}}});
const test=async readTask=>{
 const rows=[draft('a','cancelled'),draft('b','cancelled'),draft('c','active'),draft('d','cancelled','completed')];
 const removed=[],bridge={list:async()=>structuredClone(rows),removeDraft:async id=>removed.push(id)};
 await discardCancelledQuestionImportDrafts({items:rows,bridge,readTask});return removed;
};
assert.deepEqual(await test(async taskId=>({taskId,status:taskId})),['a','b']);
for(const code of ['CLOUD_QUESTION_IMPORT_NOT_FOUND','HTTP_404','CLOUD_UNREACHABLE','AUTHORIZATION_CONTEXT_REQUIRED']){
 let writes=0;await assert.rejects(discardCancelledQuestionImportDrafts({items:[draft('a','cancelled')],bridge:{removeDraft:async()=>writes++},readTask:async()=>{throw Object.assign(new Error(code),{code});}}));assert.equal(writes,0);
}
assert.deepEqual(await test(async()=>({taskId:'another',status:'cancelled'})),[]);
console.log('explicit owned import cancellation discards pending drafts; missing tasks, authorization and transport failures preserve them');
