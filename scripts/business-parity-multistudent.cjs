'use strict';
// UTF-8: original desktop controls only; cloud reads are assertions, never setup writes.
const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async function runMultiStudentBatch({page,out,save,releaseNavigation,waitForModalWidth,selectCourseOption,confirmVisibleDraft,reopenCalendar,studentId,teacherName}){
  const dialog=page.getByRole('dialog');
  const navigate=async(group,item)=>{
    await page.locator('.app-shell__collapse-button').click();
    const section=page.getByRole('menuitem',{name:group,exact:true});
    if(await section.getAttribute('aria-expanded')!=='true')await section.click();
    await page.getByRole('menuitem',{name:item,exact:true}).click();await releaseNavigation();
  };
  const waitDrafts=async(type,count,filter)=>{
    let last,stableSince=null;const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      last=(await page.evaluate(()=>window.desktopAuthority.list())).filter(d=>d.type===type&&d.status==='awaiting_confirmation'&&filter(d.payload.record));
      if(last.length===count){if(stableSince===null)stableSince=Date.now();}else stableSince=null;
      if(stableSince!==null&&Date.now()-stableSince>=600)return last;
      await page.waitForTimeout(75);
    }
    save('multistudent-drafts-not-ready',{type,count,last});throw new Error('MULTISTUDENT_DRAFTS_NOT_READY');
  };
  await navigate('team 资源','user 学生');
  await page.getByRole('button',{name:'plus 添加学生',exact:true}).click();
  await dialog.waitFor();await waitForModalWidth(700);
  await dialog.getByPlaceholder('请输入学生姓名',{exact:true}).fill('周清');
  await dialog.getByPlaceholder('请输入联系电话',{exact:true}).fill('13100000001');
  await dialog.locator('#school').fill('春禾中学');await dialog.locator('#school').press('Enter');
  await dialog.locator('#grade_year').click();await page.locator('.ant-select-dropdown:visible').getByText('2025级',{exact:true}).click();
  await dialog.getByText('添加学生',{exact:true}).click();
  await page.context().setOffline(true);
  await dialog.getByRole('button',{name:/^确\s*定$/}).click();await dialog.waitFor({state:'hidden'});
  const [studentDraft]=await waitDrafts('student.create.v1',1,r=>r.name==='周清');
  const secondStudentId=studentDraft.payload.record.id;
  await page.context().setOffline(false);
  const beforeStudent=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert(!beforeStudent.students.some(s=>s.id===secondStudentId));await confirmVisibleDraft(studentDraft);
  const studentProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert.equal(studentProjection.students.find(s=>s.id===secondStudentId)?.name,'周清');
  assert.equal(studentProjection.student_contacts.find(c=>c.student_id===secondStudentId&&c.slot===1)?.phone,'13100000001');
  await navigate('calendar 教务','book 课程信息');
  await page.getByRole('button',{name:'plus 添加课程',exact:true}).click();await dialog.waitFor();
  await dialog.getByPlaceholder('请输入课程名称',{exact:true}).fill('双人讨论课');
  await selectCourseOption('semester','秋学期');await selectCourseOption('source_type','自有课程');
  await selectCourseOption('type','一对二');await selectCourseOption('default_duration_minutes','1.5小时');
  await selectCourseOption('billing_unit','按次课计费');await selectCourseOption('teacher_fee_mode','按学生分摊');
  // UTF-8: original tags field contains both ID/name options with identical visible labels.
  await dialog.locator('#room_id').fill('东湖上课点');await dialog.locator('#room_id').press('Enter');
  for(const [i,name,tuition,fee] of [[0,'林小禾','180','120'],[1,'周清','130','80']]){
    await dialog.getByRole('button',{name:'plus-circle 添加学生',exact:true}).click();
    // UTF-8: use the original searchable select's keyboard interaction during popup re-alignment.
    const studentInput=dialog.locator('#student_pricings_'+i+'_student_id');
    const studentSelect=dialog.locator('.ant-select').filter({has:page.locator('#student_pricings_'+i+'_student_id')});
    await studentSelect.locator('.ant-select-selector').click();await studentInput.fill(name);
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+name+'$')}).waitFor();
    await studentInput.press('Enter');
    assert.equal(await studentSelect.locator('.ant-select-selection-item').innerText(),name);
    await dialog.locator('#student_pricings_'+i+'_tuition').fill(tuition);
    await dialog.locator('#student_pricings_'+i+'_teacher_fee').fill(fee);
    await dialog.locator('#student_pricings_'+i+'_teacher_fee').press('Tab');
  }
  assert.equal(await dialog.locator('#price_tuition').inputValue(),'310');
  assert.equal(await dialog.locator('#price_teacher').inputValue(),'200');
  save('26-multistudent-course-form',await dialog.ariaSnapshot());
  await dialog.screenshot({path:path.join(out,'26-multistudent-course.png')});
  await page.context().setOffline(true);await dialog.getByRole('button',{name:/^确\s*定$/}).click();await dialog.waitFor({state:'hidden'});
  const [courseDraft]=await waitDrafts('course.create.v1',1,r=>r.display_name==='双人讨论课'||r.name==='双人讨论课');
  const courseId=courseDraft.payload.record.id;
  await page.context().setOffline(false);
  const beforeCourse=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert(!beforeCourse.courses.some(c=>c.id===courseId));await confirmVisibleDraft(courseDraft);
  const courseProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const course=courseProjection.courses.find(c=>c.id===courseId);assert(course);
  assert.equal(course.price_tuition,310);assert.equal(course.price_teacher,200);assert.equal(course.billing_unit,2);assert.equal(course.teacher_fee_mode,2);
  assert.deepEqual(course.student_pricings.map(p=>p.student_id).sort(),[studentId,secondStudentId].sort());
  await reopenCalendar();
  const firstDay=page.locator('[data-date]').first();const firstDate=await firstDay.getAttribute('data-date');
  await firstDay.locator(':scope > div').first().dblclick();await dialog.waitFor();await waitForModalWidth(600);
  await selectCourseOption('teacherId',teacherName);
  await dialog.locator('#startTime').fill('12:00');await dialog.locator('#startTime').press('Enter');
  await selectCourseOption('courseId','双人讨论课');assert.equal(await dialog.locator('#endTime').inputValue(),'13:30');
  await dialog.getByRole('spinbutton').fill('2');await dialog.getByRole('spinbutton').press('Tab');
  await dialog.getByRole('button',{name:'添加日期',exact:true}).click();await dialog.getByRole('button',{name:'添加日期',exact:true}).click();
  await dialog.getByText('共 3 节课程',{exact:true}).waitFor();
  const dates=await dialog.locator('.ant-picker input').evaluateAll(inputs=>inputs.map(input=>input.value).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)));
  const expectedDates=[0,2,4].map(delta=>{const date=new Date(firstDate+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+delta);return date.toISOString().slice(0,10);});
  assert.deepEqual(dates,expectedDates);save('27-multidate-form',await dialog.ariaSnapshot());
  await dialog.screenshot({path:path.join(out,'27-multidate-form.png')});
  await page.context().setOffline(true);await dialog.getByRole('button',{name:/^保\s*存$/}).click();await dialog.waitFor({state:'hidden'});
  const drafts=await waitDrafts('schedule.create.v1',3,r=>r.course_id===courseId);
  for(const draft of drafts){assert.equal(draft.payload.record.calculated_tuition,310);assert.equal(draft.payload.record.calculated_teacher_fee,200);}
  save('28-multidate-drafts',drafts);await page.context().setOffline(false);
  const pending=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert.deepEqual(pending.schedules,courseProjection.schedules,'batch date save must wait for confirmation');
  for(const draft of drafts)await confirmVisibleDraft(draft);
  const after=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const records=after.schedules.filter(s=>s.course_id===courseId);assert.equal(records.length,3);
  save('multistudent-batch-readback',{course,records,expectedDates});
  assert.deepEqual(records.map(s=>new Date(s.start_time).toISOString()).sort(),expectedDates.map(date=>date+'T04:00:00.000Z'));
  for(const record of records){
    assert.equal(new Date(record.end_time)-new Date(record.start_time),90*60000);
    assert.equal(record.calculated_tuition,310);assert.equal(record.calculated_teacher_fee,200);
    assert.equal(record.billing_unit,2);assert.equal(record.teacher_fee_mode,2);assert.equal(record.room,'东湖上课点');
    // UTF-8: assert the canonical cloud field, not the desktop cache's status alias.
    assert.deepEqual(record.student_pricings.map(p=>[p.student_id,p.tuition,p.teacher_fee,p.attendance_status]).sort(),[[studentId,180,120,1],[secondStudentId,130,80,1]].sort());
  }
  await reopenCalendar();
  for(const [i,record] of records.entries()){
    const card=page.locator('[data-schedule-id="'+record.id+'"]');await card.waitFor();
    assert.match(await card.innerText(),/双人讨论课[\s\S]*东湖上课点\s+12:00-13:30/);
    await card.screenshot({path:path.join(out,'29-multidate-reloaded-'+i+'.png')});
  }
  // UTF-8: edit one original lesson's attendance; never change course defaults or sibling lessons.
  let attendanceBefore=records[0];const attendanceChecks=[];
  const labels={1:'正常出勤',3:'取消',4:'请假'};
  const openAttendance=async()=>{
    const card=page.locator('[data-schedule-id="'+attendanceBefore.id+'"]');
    await card.click({button:'right'});await page.getByRole('menuitem',{name:'学生出勤和费用',exact:true}).click();
    await dialog.waitFor();await waitForModalWidth(700);
  };
  const studentCard=name=>dialog.locator('.ant-card').filter({has:page.getByText(new RegExp('^\\d+\\. '+name+'$'))});
  for(const [step,statuses,tuition,teacherFee] of [[0,[4,1],130,80],[1,[3,1],130,80],[2,[1,4],180,120],[3,[4,4],0,0],[4,[1,1],310,200]]){
    await openAttendance();
    for(const [i,name,unitTuition,unitFee] of [[0,'林小禾','180','120'],[1,'周清','130','80']]){
      const card=studentCard(name);await card.waitFor();
      assert.equal(await card.getByRole('spinbutton').nth(0).inputValue(),unitTuition);
      assert.equal(await card.getByRole('spinbutton').nth(1).inputValue(),unitFee);
      const currentLabel=await card.locator('.ant-select-selection-item').innerText();
      if(currentLabel!==labels[statuses[i]]){
        // UTF-8: rc-select exposes its active keyboard option via aria-activedescendant.
        const input=card.getByRole('combobox');const inputId=await input.getAttribute('id');
        const waitActive=label=>page.waitForFunction(({id,label})=>{
          const input=document.getElementById(id);const option=document.getElementById(input?.getAttribute('aria-activedescendant'));
          return input?.getAttribute('aria-expanded')==='true'&&option?.getAttribute('aria-label')===label;
        },{id:inputId,label});
        await card.locator('.ant-select-selector').click();await waitActive(currentLabel);
        const order=['正常出勤','请假','取消'];const steps=(order.indexOf(labels[statuses[i]])-order.indexOf(currentLabel)+3)%3;
        for(let n=0;n<steps;n++)await input.press('ArrowDown');
        await waitActive(labels[statuses[i]]);await input.press('Enter');
        assert.equal(await card.locator('.ant-select-selection-item').innerText(),labels[statuses[i]]);
      }
    }
    await dialog.screenshot({path:path.join(out,'30-attendance-form-'+step+'.png')});
    await page.context().setOffline(true);await dialog.getByRole('button',{name:/^确\s*定$/}).click();await dialog.waitFor({state:'hidden'});
    let draft,stableSince=null;const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      draft=(await page.evaluate(()=>window.desktopAuthority.list())).find(d=>d.type==='schedule.update.v1'&&d.status==='awaiting_confirmation'&&d.payload.id===attendanceBefore.id);
      const changes=draft?.payload.changes;
      const matches=changes?.calculated_tuition===tuition&&changes?.calculated_teacher_fee===teacherFee
        &&[studentId,secondStudentId].every((id,i)=>changes.student_pricings.find(p=>p.student_id===id)?.status===statuses[i]);
      if(matches){if(stableSince===null)stableSince=Date.now();}else stableSince=null;
      if(stableSince!==null&&Date.now()-stableSince>=600)break;
      await page.waitForTimeout(75);
    }
    save('31-attendance-draft-'+step,{draft,statuses,tuition,teacherFee});
    assert(stableSince!==null&&Date.now()-stableSince>=600,'attendance draft must stabilize with both student statuses');
    assert.equal(new Date(draft.payload.expectedVersion).getTime(),new Date(attendanceBefore.updated_at).getTime());
    await page.context().setOffline(false);
    const pending=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert.deepEqual(pending.schedules.find(s=>s.id===attendanceBefore.id),attendanceBefore,'attendance must not silently submit');
    await confirmVisibleDraft(draft);
    const projection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const updated=projection.schedules.find(s=>s.id===attendanceBefore.id);assert(updated);
    save('32-attendance-readback-'+step,{before:attendanceBefore,after:updated,statuses});
    assert.equal(updated.calculated_tuition,tuition);assert.equal(updated.calculated_teacher_fee,teacherFee);
    assert.deepEqual(updated.student_pricings.map(p=>[p.student_id,p.tuition,p.teacher_fee,p.attendance_status]).sort(),
      [[studentId,180,120,statuses[0]],[secondStudentId,130,80,statuses[1]]].sort());
    for(const key of ['start_time','end_time','course_id','room','teacher_id','billing_unit','teacher_fee_mode','status'])assert.deepEqual(updated[key],attendanceBefore[key]);
    assert.deepEqual(projection.courses.find(c=>c.id===courseId),course,'lesson attendance must not change course defaults');
    assert.deepEqual(projection.schedules.filter(s=>s.id!==updated.id),pending.schedules.filter(s=>s.id!==updated.id),'other lessons must remain unchanged');
    attendanceChecks.push({statuses,tuition,teacherFee,expectedVersion:draft.payload.expectedVersion});attendanceBefore=updated;
    await reopenCalendar();await openAttendance();
    for(const [i,name] of [[0,'林小禾'],[1,'周清']]){
      const card=studentCard(name);assert.equal(await card.locator('.ant-select-selection-item').innerText(),labels[statuses[i]]);
      assert.equal(await card.getByRole('spinbutton').nth(0).inputValue(),i===0?'180':'130');
      assert.equal(await card.getByRole('spinbutton').nth(1).inputValue(),i===0?'120':'80');
    }
    await dialog.screenshot({path:path.join(out,'33-attendance-reopened-'+step+'.png')});
    await dialog.getByRole('button',{name:/^取\s*消$/}).click();await dialog.waitFor({state:'hidden'});
  }
  save('attendance-matrix-readback',attendanceChecks);
  return {secondStudentCreated:true,twoStudentCourseCreated:true,perSessionFeesPreserved:true,threeDateBatchConfirmed:true,batchDatesReloaded:true,
    twoStudentAttendanceStates:attendanceChecks.length,attendanceZeroAndRestore:true,courseDefaultsPreserved:true};
};
