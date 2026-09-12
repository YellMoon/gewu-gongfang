'use strict';
// UTF-8: all mutations use the original visible desktop controls; evaluation only observes data.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,out,save,releaseNavigation,teacherId})=>{
 const projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
 const dialog=page.getByRole('dialog');
 const navigate=async(group,item)=>{
  await page.locator('.app-shell__collapse-button').click();
  const section=page.getByRole('menuitem',{name:group,exact:true});
  if(await section.getAttribute('aria-expanded')!=='true')await section.click();
  await page.getByRole('menuitem',{name:item,exact:true}).click();await releaseNavigation();
 };
 const capture=async name=>{save(name+'-tree',await page.locator('body').ariaSnapshot());await page.screenshot({path:path.join(out,name+'.png'),scale:'css',animations:'disabled'});};
 const pending=async(type,id)=>{
  await page.waitForFunction(async({type,id})=>(await window.desktopAuthority.list()).some(d=>d.type===type&&d.status==='awaiting_confirmation'&&(!id||(d.payload.id||d.payload.record?.id)===id)),{type,id});
  return page.evaluate(async({type,id})=>(await window.desktopAuthority.list()).find(d=>d.type===type&&d.status==='awaiting_confirmation'&&(!id||(d.payload.id||d.payload.record?.id)===id)),{type,id});
 };
 const confirm=async(draft,label)=>{
  if(!await page.locator('.sync-quick-popover:visible').count())await page.locator('.sync-status-trigger').click();
  await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
  await dialog.waitFor();await dialog.getByRole('button',{name:'确认并发送',exact:true}).hover();await capture(label+'-confirmation');
  await dialog.getByRole('button',{name:'确认并发送',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:45000});
  await page.waitForFunction(async id=>['completed','conflict'].includes((await window.desktopAuthority.list()).find(d=>d.id===id)?.status),draft.id,{timeout:45000});
  const stored=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),draft.id);
  save(label+'-receipt',{status:stored.status,lastError:stored.lastError,receipt:stored.receipt});assert.equal(stored.status,'completed');
  if(await page.locator('.sync-quick-popover:visible').count())await page.locator('.sync-status-trigger').click();
 };
 const createResource=async(entity,menu,button,fill,width)=>{
  await navigate('team 资源',menu);await page.getByRole('button',{name:button,exact:true}).click();await dialog.waitFor();
  save(entity+'-original-form',await dialog.ariaSnapshot());await fill();
  await dialog.getByRole('button',{name:/^保\s*存$/}).hover();
  await page.waitForFunction(width=>Math.abs(document.querySelector('[role=dialog]').getBoundingClientRect().width-width)<2,width);
  await capture(entity+'-filled');await page.context().setOffline(true);
  await dialog.getByRole('button',{name:/^保\s*存$/}).click();await dialog.waitFor({state:'hidden'});
  const draft=await pending(entity+'.create.v1'),id=draft.payload.record.id;
  await page.context().setOffline(false);assert(!(await projection())[entity==='room'?'rooms':'institutions'].some(r=>r.id===id),'reconnect must not create '+entity);
  await confirm(draft,entity+'-create');return id;
 };
 const institutionId=await createResource('institution','team 机构','plus 添加机构',async()=>{
  await dialog.getByPlaceholder('请输入机构名称',{exact:true}).fill('春禾机构');
  await dialog.getByPlaceholder('联系人姓名',{exact:true}).fill('王老师');await dialog.getByPlaceholder('联系电话',{exact:true}).fill('13100000000');
  await dialog.locator('#revenue_share').fill('30');await dialog.getByPlaceholder('其他备注信息',{exact:true}).fill('原机构表单验证');
 },600);
 const initial=await projection(),institution=initial.institutions.find(r=>r.id===institutionId);
 assert.equal(institution?.name,'春禾机构');assert.equal(institution.contact_person,'王老师');assert.equal(institution.revenue_share,30);
 const student=initial.students.find(s=>s.id===institution.billing_student_id);assert.equal(student?.name,'春禾机构学生');const studentId=student.id;
 const roomId=await createResource('room','home 上课地址','plus 添加地址',async()=>{
  await dialog.getByPlaceholder('如：302教室、线上腾讯会议',{exact:true}).fill('东湖上课点');
  await dialog.getByPlaceholder('如：教学楼3楼302室（可选）',{exact:true}).fill('东湖路一号');
 },520);
 assert.equal((await projection()).rooms.find(r=>r.id===roomId)?.address,'东湖路一号');
 await navigate('calendar 教务','book 课程信息');await page.getByRole('button',{name:'plus 添加课程',exact:true}).click();await dialog.waitFor();
 const option=async(id,name)=>{
  await dialog.locator('.ant-select').filter({has:page.locator('#'+id)}).locator('.ant-select-selector').click();
  const exact=new RegExp('^\\s*'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$');
  const matches=page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:exact});
  // UTF-8: original 8118419f lists the ID option before its same-name legacy alias. Do not redesign this control.
  if(id==='room_id'){assert.equal(await matches.count(),2);await matches.first().click();}
  else await matches.click();
 };
 await dialog.getByPlaceholder('请输入课程名称',{exact:true}).fill('初二物理');await option('semester','秋学期');await option('source_type','机构排课');await option('institution_id','春禾机构');
 await option('type','一对一');await option('default_duration_minutes','1.5小时');await option('room_id','东湖上课点');
 await dialog.getByRole('button',{name:'plus-circle 添加学生',exact:true}).click();await option('student_pricings_0_student_id','春禾机构学生');
 await dialog.locator('#student_pricings_0_tuition').fill('180');await dialog.locator('#student_pricings_0_teacher_fee').fill('120');await dialog.locator('#student_pricings_0_teacher_fee').press('Tab');
 // UTF-8: an online save with existing resources commits directly; test explicit confirmation by first saving offline.
 await capture('institution-course-filled');await page.context().setOffline(true);await dialog.getByRole('button',{name:/^确\s*定$/}).click();await dialog.waitFor({state:'hidden'});
 const courseDraft=await pending('course.create.v1'),courseId=courseDraft.payload.record.id;
 await page.context().setOffline(false);
 assert(!(await projection()).courses.some(c=>c.id===courseId));await confirm(courseDraft,'institution-course-create');
 await navigate('calendar 教务','calendar 课程表');await page.locator('[data-date]').first().waitFor();
 await page.locator('[data-date]').first().locator(':scope > div').first().dblclick();await dialog.waitFor();
 await option('teacherId',(await projection()).teachers.find(t=>t.id===teacherId).name);
 await dialog.locator('#startTime').fill('12:00');await dialog.locator('#startTime').press('Enter');await option('courseId','初二物理');
 // UTF-8: the original selector includes the supplied detailed address in its label.
 assert.equal(await dialog.locator('#endTime').inputValue(),'13:30');await dialog.getByText('东湖上课点 (东湖路一号)',{exact:true}).waitFor();await capture('institution-schedule-filled');
 await page.context().setOffline(true);await dialog.getByRole('button',{name:/^保\s*存$/}).click();await dialog.waitFor({state:'hidden'});
 const lessonDraft=await pending('schedule.create.v1'),scheduleId=lessonDraft.payload.record.id;await page.context().setOffline(false);
 assert(!(await projection()).schedules.some(s=>s.id===scheduleId));await confirm(lessonDraft,'institution-schedule-create');
 const before=await projection(),originalCourse=before.courses.find(c=>c.id===courseId),originalLesson=before.schedules.find(s=>s.id===scheduleId);
 assert.equal(originalCourse.institution_id,institutionId);assert.equal(originalCourse.room_id,roomId);assert.equal(originalCourse.student_pricings[0].student_id,studentId);
 assert.equal(originalLesson.calculated_tuition,270);assert.equal(originalLesson.calculated_teacher_fee,180);assert.equal(originalLesson.student_pricings[0].attendance_status,1);
 const unchanged=async()=>{const p=await projection();assert.deepEqual(p.courses.find(c=>c.id===courseId),originalCourse);assert.deepEqual(p.schedules.find(s=>s.id===scheduleId),originalLesson);return p;};
 for(const [entity,id,menu,name] of [['institution',institutionId,'team 机构','春禾机构改名'],['room',roomId,'home 上课地址','东湖三楼']]){
  await navigate('team 资源',menu);const collection=entity==='room'?'rooms':'institutions';
  const baseline=(await projection())[collection].find(r=>r.id===id),row=page.getByRole('row').and(page.locator('[data-row-key="'+id+'"]'));
  await row.getByRole('button',{name:'edit 编辑',exact:true}).click();await dialog.waitFor();await dialog.locator('#name').fill(name);
  if(entity==='room')await dialog.locator('#address').fill('东湖路三号');await capture(entity+'-edit-filled');
  await page.context().setOffline(true);await dialog.getByRole('button',{name:/^保\s*存$/}).click();await dialog.waitFor({state:'hidden'});
  const draft=await pending(entity+'.update.v1',id);await page.context().setOffline(false);assert.deepEqual((await projection())[collection].find(r=>r.id===id),baseline);
  await confirm(draft,entity+'-edit');assert.equal((await unchanged())[collection].find(r=>r.id===id).name,name);
  if(entity==='institution')assert.equal((await projection()).students.find(s=>s.id===studentId).name,'春禾机构改名学生');
  await page.context().setOffline(true);await row.getByRole('button',{name:'delete 删除',exact:true}).click();
  await page.locator('.ant-popconfirm:visible').getByRole('button',{name:/^确\s*定$/}).click();
  const deletion=await pending(entity+'.delete.v1',id);await page.context().setOffline(false);assert((await projection())[collection].some(r=>r.id===id));
  await confirm(deletion,entity+'-delete');assert(!(await unchanged())[collection].some(r=>r.id===id));
 }
 await page.reload();await page.locator('.app-shell').waitFor({timeout:45000});await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
 const after=await unchanged();assert(after.students.some(s=>s.id===studentId));
 await navigate('calendar 教务','calendar 课程表');const card=page.locator('[data-schedule-id="'+scheduleId+'"]');await card.waitFor();
 assert.match(await card.innerText(),/初二物理/);assert.match(await card.innerText(),/东湖上课点\s+12:00-13:30/);await capture('resource-history-reloaded');
 save('resource-maintenance-history',{before:{course:originalCourse,schedule:originalLesson},after:{course:after.courses.find(c=>c.id===courseId),schedule:after.schedules.find(s=>s.id===scheduleId)},same:true});
 return {institutionId,roomId,studentId,courseId,scheduleId,originalWindows:true,explicitConfirmation:true,historyPreserved:true,reloaded:true};
};
