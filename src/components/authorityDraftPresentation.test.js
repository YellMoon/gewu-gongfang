// UTF-8 source; user-facing copy is verified as Unicode text.
const assert = require('node:assert/strict');
const { describeAuthorityDraft, authorityDraftError } = require('./authorityDraftPresentation');
const item = {type:'schedule.create.v1',preview:{title:'schedule.create'},payload:{record:{course_id:'course-1',start_time:'2026-09-07T06:00:00.000Z',end_time:'2026-09-07T07:30:00.000Z',room:'\u6d4b\u8bd5\u6559\u5ba4',calculated_tuition:270,calculated_teacher_fee:180}}};
const result=describeAuthorityDraft(item,{courses:[{id:'course-1',name:'\u7269\u7406\u8bfe\u7a0b'}]});
const snapshotDetails=describeAuthorityDraft({type:'schedule.update.v1',payload:{changes:{billing_unit:2,teacher_fee_mode:2,teacher_name:'王老师'}}}).details;
assert(snapshotDetails.some(row=>row.label==='计费单位'&&row.value==='按次'));
assert(snapshotDetails.some(row=>row.label==='教师计费方式'&&row.value==='按学生'));
assert(snapshotDetails.some(row=>row.label==='教师'&&row.value==='王老师'));
assert.equal(result.title,'\u65b0\u589e\u6392\u8bfe');
assert.equal(result.summary,'\u7269\u7406\u8bfe\u7a0b \u00b7 2026/09/07 14:00');
assert(result.details.some(row=>row.label==='\u7ed3\u675f\u65f6\u95f4'&&row.value==='2026/09/07 15:30'));
assert(result.details.some(row=>row.label==='\u5b66\u8d39\u5408\u8ba1'&&row.value==='270 \u5143'));
assert(result.details.some(row=>row.label==='\u6559\u5e08\u8bfe\u65f6\u8d39\u5408\u8ba1'&&row.value==='180 \u5143'));
assert(!JSON.stringify(result).includes('schedule.create'));
for(const entity of ['student','teacher','course','room','institution','school','payment','consumption','grade','personal-asset-record','personal-asset-category','question']) {
  for(const action of ['create','update','delete']) {
    const shown=describeAuthorityDraft({type:`${entity}.${action}.v1`,payload:{}});
    assert(!shown.title.includes(entity)); assert(shown.title.length>2);
  }
}
assert.equal(describeAuthorityDraft({type:'student.update.v1',payload:{changes:{name:'\u5c0f\u660e'}}}).summary,'\u5c0f\u660e');
assert.equal(describeAuthorityDraft({type:'internal.unknown.v8',preview:{title:'internal.unknown',summary:'opaque-id'}}).title,'\u5f85\u63d0\u4ea4\u7684\u66f4\u6539');
assert(!JSON.stringify(describeAuthorityDraft({type:'schedule.create.v1',payload:{record:{start_time:'invalid'}}})).includes('Invalid'));
assert.match(authorityDraftError('CLOUD_BUSINESS_ACCESS_DENIED'),/\u6743\u9650/);
assert(!authorityDraftError('SOME_INTERNAL_SECRET_CODE').includes('SOME_INTERNAL'));
console.log('authority draft presentation checks passed');
