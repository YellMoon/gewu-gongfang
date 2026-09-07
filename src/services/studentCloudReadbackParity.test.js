'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const {buildAuthorityBackedBrowserCache}=await import('./authorityProjectionCacheAdapter.mjs');
  const projection={protocol:'gewu.authority-projection.v1',sourceVersion:1,payload:{
    students:[{id:'student',name:'Student',phone:'old-phone',source_type:1,student_source:'referral'}],
    student_contacts:[{student_id:'student',slot:1,phone:'13100000000',wechat:'student-test'},
      {student_id:'student',slot:2,phone:null,wechat:'parent-test'}],
  }};
  const before=JSON.stringify(projection);
  const cache=buildAuthorityBackedBrowserCache({projection});
  assert.equal(cache.students[0].phone,'13100000000','original list must display canonical contact rather than stale/empty legacy phone');
  assert.equal(cache.students[0].student_wechat,'student-test');
  assert.equal(cache.students[0].parent_wechat,'parent-test');
  assert.equal(cache.students[0].parent_phone,undefined);
  assert.equal(cache.students[0].source_type,1);
  assert.equal(cache.students[0].student_source,'referral');
  assert.equal(JSON.stringify(projection),before,'cloud projection must not be mutated');
  const draft=buildAuthorityBackedBrowserCache({projection,outbox:[{type:'student.update.v1',status:'awaiting_confirmation',
    payload:{id:'student',changes:{phone:'13200000000',source_type:2}}}]});
  assert.equal(draft.students[0].phone,'13200000000','pending local edit must overlay canonical projection');
  const contactDraft=buildAuthorityBackedBrowserCache({projection,outbox:[{type:'student.update.v1',status:'awaiting_confirmation',
    payload:{id:'student',changes:{contacts:[{slot:1,relationship:'student',phone:'13300000000',wechat:null}]}}}]});
  assert.equal(contactDraft.students[0].phone,'13300000000','contact-only drafts must update original list fields');
  const app=fs.readFileSync(path.join(__dirname,'../../cloud-business-api/src/app.js'),'utf8');
  const studentLines=app.split('\n').filter(line=>line.includes("\"'students',COALESCE((SELECT jsonb_agg"));
  assert.equal(studentLines.length,2);
  for(const line of studentLines){
    assert(line.includes("'source_type',s.legacy_source_type"),'desktop and scoped projections must retain student source category');
    assert(line.includes("'student_source',s.student_source_legacy"),'desktop and scoped projections must retain source details');
  }
  console.log('student canonical contact and original source readback parity checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
