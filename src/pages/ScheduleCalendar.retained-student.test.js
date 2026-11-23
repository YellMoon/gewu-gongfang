'use strict';
// UTF-8: original student deletion and original handlers, both parent course states.
const {verify,verifyAttendance}=require('./ScheduleCalendar.retained-course.test');
const cases=[true,false].flatMap(courseDeleted=>verify({studentDeleted:true,courseDeleted}));
console.log('original/current retained-student handlers passed: '+cases.length+' cases; active/deleted courses; no student resurrection');
verifyAttendance()
  .then(count => console.log('original/current deleted-student attendance open/save passed: '+count+' fee/status combinations'))
  .catch(error => { console.error(error); process.exitCode=1; });
