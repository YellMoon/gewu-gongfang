'use strict';
// UTF-8: actual original controls; all writes are scoped to the disposable course.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,out,save,fixture,releaseNavigation})=>{
 const id=fixture.studentId,projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection()),drafts=()=>page.evaluate(()=>window.desktopAuthority.list());
 const baseline=await projection(),course=baseline.courses.find(c=>c.id===id);assert(course&&course.active);assert.equal(course.year,null);assert.equal(course.semester,null);assert.equal(course.room_id,null);
 assert(!baseline.students.some(s=>s.id===id),'fixture retains enrolment after the student is archived');
 let current=baseline;const records=[];
 const capture=async name=>{save(name+'-tree',await page.locator('.app-shell__main').ariaSnapshot());await page.screenshot({path:path.join(out,name+'.png'),scale:'css',animations:'disabled'});};
 const navigate=async name=>{await page.locator('.app-shell__collapse-button').click();if(!await page.getByRole('menuitem',{name,exact:true}).isVisible())await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();await releaseNavigation();};
 const card=page.locator('[data-schedule-id="'+id+'"]');
 await navigate('calendar 课程表');await card.waitFor();await card.scrollIntoViewIfNeeded();const originalCardText=await card.innerText();
 assert(originalCardText.includes(course.display_name));assert.match(originalCardText,/原上课地址\s+09:00-10:30/);
 const timetable=async(active,label)=>{
  await navigate('calendar 课程表');await card.waitFor();await card.scrollIntoViewIfNeeded();assert.equal(await card.innerText(),originalCardText,'state cannot alter existing lesson content');
  const pending=page.locator('.workbench-layout__sidebar').getByText(course.display_name,{exact:true});await pending.waitFor({state:active?'visible':'hidden'});assert.equal(await pending.count(),active?1:0);await capture(label);
 };
 const readExpected=async active=>{
  const after=await projection(),expected=structuredClone(current),row=expected.courses.find(c=>c.id===id),actual=after.courses.find(c=>c.id===id);
  assert(actual);assert.equal(actual.active,active);assert.notEqual(actual.updated_at,row.updated_at);row.active=active;row.updated_at=actual.updated_at;
  assert.deepEqual(after,expected,'only the target course state/version may change');records.push(after);current=after;save('course-active-progress',{before:baseline,intermediate:records});return after;
 };
 const toggle=async(active,label)=>{
  await navigate('book 课程信息');
  // UTF-8: the original page defaults to unfinished courses; a toggle removes its row from that filter.
  const filter=async state=>{const control=page.locator('.ant-select').filter({has:page.locator('.ant-select-selection-item').filter({hasText:/^(未结课|已结课)$/})});await control.locator('.ant-select-selector').click();await page.locator('.ant-select-dropdown:visible').getByText(state?'未结课':'已结课',{exact:true}).click();};
  if(active)await filter(false);
  const row=page.locator('[data-row-key="'+id+'"]');await row.waitFor();await row.getByRole('button',{name:active?'已结课':'未结课',exact:true}).click();
  await row.waitFor({state:'hidden'});
  // UTF-8: a cloud readback must not remount this page and silently reset its original filter.
  assert.equal(await page.locator('.ant-select-selection-item').filter({hasText:/^(未结课|已结课)$/}).innerText(),active?'已结课':'未结课');
  await capture(label+'-filtered-out');await filter(active);
  await row.getByRole('button',{name:active?'未结课':'已结课',exact:true}).waitFor();await capture(label);
 };
 const reload=async()=>{await page.reload();await page.locator('.app-shell').waitFor({timeout:45000});await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});};
 const initialDrafts=await drafts();assert.equal(initialDrafts.length,0);await capture('course-active-01-before');
 for(const active of [false,true]){
  await toggle(active,'course-active-02-online-'+active);await readExpected(active);assert.deepEqual(await drafts(),initialDrafts);
  await timetable(active,'course-active-03-online-timetable-'+active);
 }
 for(const active of [false,true]){
  await page.context().setOffline(true);await toggle(active,'course-active-04-local-'+active);
  const pending=(await drafts()).filter(d=>d.status==='awaiting_confirmation');assert.equal(pending.length,1);const draft=pending[0];
  assert.equal(draft.type,'course.update.v1');assert.equal(draft.payload.id,id);assert.deepEqual(draft.payload.changes,{active});
  assert.equal(new Date(draft.payload.expectedVersion).getTime(),new Date(current.courses.find(c=>c.id===id).updated_at).getTime());
  await timetable(active,'course-active-05-local-timetable-'+active);await page.context().setOffline(false);assert.deepEqual(await projection(),current);
  const open=async()=>{await page.locator('.sync-status-trigger').click();await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByText(course.display_name,{exact:true}).waitFor();await dialog.getByText(active?'未结课':'已结课',{exact:true}).waitFor();return dialog;};
  let dialog=await open();assert.deepEqual(await projection(),current);await dialog.getByRole('button',{name:'继续保留草稿',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await drafts()).find(d=>d.id===draft.id).status,'awaiting_confirmation');assert.deepEqual(await projection(),current);
  // Close the retained popover before re-opening the same original confirmation path.
  if(await page.locator('.sync-quick-popover:visible').count())await page.locator('.sync-status-trigger').click();
  dialog=await open();await capture('course-active-06-confirm-'+active);assert.deepEqual(await projection(),current);
  await dialog.getByRole('button',{name:'确认并发送',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:45000});
  await page.waitForFunction(async key=>['completed','conflict','failed'].includes((await window.desktopAuthority.list()).find(d=>d.id===key)?.status),draft.id,{timeout:45000});
  const stored=(await drafts()).find(d=>d.id===draft.id);save('course-active-confirmed-'+active,stored);assert.equal(stored.status,'completed');await readExpected(active);
  await reload();assert.deepEqual(await projection(),current);await timetable(active,'course-active-07-reloaded-'+active);
 }
 save('course-active-ui-readback',{before:baseline,intermediate:records,after:current,originalCardText,reloadedCardText:await card.innerText()});
 return {onlineFinishAndReopen:true,offlineDraftOnly:true,reviewAndKeepDidNotSubmit:true,confirmedFinishAndReopen:true,pendingListFollowsOriginalState:true,existingLessonsUnchanged:true,reloaded:true};
};
