'use strict';
const assert=require('node:assert/strict');
const {load}=require('./CourseList.active-parity.test');
(async()=>{
  for(const reference of ['Cloud address','room-cloud']){
    let rooms=[],saved=null,created=0,refreshed=0;
    const values={display_name:'Physics',type:1,source_type:1,teacher_id:'teacher',year:2026,semester:'autumn',room_id:[reference],student_pricings:[]};
    const editingCourse={id:'course',room_id:reference,room_name:'Cloud address',updated_at:'2026-09-01T00:00:00Z'};
    const dbService={getAllRooms:()=>rooms,getAllCourses:()=>[editingCourse],
      refreshAuthorityProjection:async()=>{refreshed++;rooms=[{id:'room-cloud',name:'Cloud address'}];},
      addOrUpdateRoom:()=>{created++;throw Error('DUPLICATE_ADDRESS_CREATED');}};
    const errors=[];
    const deps={form:{getFieldsValue:()=>values,validateFields:async()=>structuredClone(values)},dbService,rooms,
      editingCourse,teachers:[{id:'teacher',name:'Teacher'}],students:[],CourseSourceType:{INSTITUTION:2,MIXED:3},
      sanitizeCourseStudentPricings:x=>x,getColorForRoom:()=>null,
      submitCourseToAuthority:async value=>{saved=value;return true;},setModalVisible(){},setTimeout(){},loadData(){},
      message:{warning:x=>errors.push(x),error:x=>errors.push(x)},navigator:{onLine:true},
      resolveCourseRoomSelection:async args=>(await import('../services/courseRoomSelection.mjs')).resolveCourseRoomSelection(args)};
    await load('src/pages/CourseList.tsx','handleSubmit',deps)();
    assert(saved,'real course save must refresh the cloud catalog before treating an absent room as new: '+errors);
    assert.equal(saved.room_id,'room-cloud');assert.equal(saved.room_name,'Cloud address');
    assert.equal(created,0);assert.equal(refreshed,1);
  }
  const {resolveCourseRoomSelection:resolve}=await import('../services/courseRoomSelection.mjs');
  let creates=0,rooms=[];
  const dbService={getAllRooms:()=>rooms,getAllCourses:()=>[{room_id:'missing-id',room_name:'Known address'}],refreshAuthorityProjection:async()=>{},addOrUpdateRoom:name=>{creates++;rooms.push({id:'new-id',name});}};
  await assert.rejects(resolve({value:'missing-id',dbService}),/COURSE_ROOM_REFERENCE_UNAVAILABLE/);
  await assert.rejects(resolve({value:'Known address',dbService,online:false}),/COURSE_ROOM_REFERENCE_UNAVAILABLE/);
  assert.equal(creates,0,'an unavailable existing address must never become a duplicate');
  assert.equal((await resolve({value:'New typed address',dbService,online:false})).id,'new-id');
  rooms=[{id:'a',name:'Same name'},{id:'b',name:'Same name'}];
  await assert.rejects(resolve({value:'Same name',dbService}),/COURSE_ROOM_AMBIGUOUS/);
  assert.equal((await resolve({value:'a',dbService})).id,'a');
  console.log('actual course save resolves missing cached cloud addresses without duplicate drafts');
})().catch(error=>{console.error(error);process.exitCode=1;});
