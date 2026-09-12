'use strict';
// UTF-8: delete only the UI-created teaching profile, through the original controls.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,out,save,releaseNavigation,teacherId,courseId,scheduleId})=>{
 const projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
 const before=await projection(),course=before.courses.find(c=>c.id===courseId),schedule=before.schedules.find(s=>s.id===scheduleId);
 assert(course&&schedule);assert.equal(course.teacher_id,teacherId);
 const unchanged=async()=>{const p=await projection();assert.deepEqual(p.courses.find(c=>c.id===courseId),course);assert.deepEqual(p.schedules.find(s=>s.id===scheduleId),schedule);return p;};
 const navigate=async(group,item)=>{
  await page.locator('.app-shell__collapse-button').click();const section=page.getByRole('menuitem',{name:group,exact:true});
  if(await section.getAttribute('aria-expanded')!=='true')await section.click();
  await page.getByRole('menuitem',{name:item,exact:true}).click();await releaseNavigation();
 };
 await navigate('team 资源','team 老师');
 const row=page.getByRole('row').and(page.locator('[data-row-key="'+teacherId+'"]'));await row.waitFor();
 save('teacher-delete-before-tree',await page.locator('body').ariaSnapshot());
 await page.context().setOffline(true);await row.getByRole('button',{name:'delete 删除',exact:true}).click();
 await page.locator('.ant-popconfirm:visible').getByRole('button',{name:/^确\s*定$/}).click();
 await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>d.type==='teacher.delete.v1'&&d.payload.id===id&&d.status==='awaiting_confirmation'),teacherId);
 const draft=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.type==='teacher.delete.v1'&&d.payload.id===id&&d.status==='awaiting_confirmation'),teacherId);
 await page.context().setOffline(false);assert((await unchanged()).teachers.some(t=>t.id===teacherId),'reconnecting must not submit the deletion');
 await page.locator('.sync-status-trigger').click();
 await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByRole('button',{name:'确认并发送',exact:true}).hover();
 save('teacher-delete-confirm-tree',await dialog.ariaSnapshot());await dialog.screenshot({path:path.join(out,'teacher-delete-confirm.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'确认并发送',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:45000});
 await page.waitForFunction(async id=>['completed','conflict'].includes((await window.desktopAuthority.list()).find(d=>d.id===id)?.status),draft.id,{timeout:45000});
 const result=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),draft.id);
 save('teacher-delete-submission',{status:result.status,lastError:result.lastError,receipt:result.receipt});assert.equal(result.status,'completed');
 assert(!(await unchanged()).teachers.some(t=>t.id===teacherId));
 await page.reload();await page.locator('.app-shell').waitFor({timeout:45000});await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
 await navigate('team 资源','team 老师');assert.equal(await page.getByRole('row').and(page.locator('[data-row-key="'+teacherId+'"]')).count(),0);
 // Original calendar selects a live teacher after reopening; it cannot select a deleted profile.
 // Use the existing unfiltered lesson list, without changing the original calendar semantics.
 const after=await unchanged();await navigate('calendar 教务','file-text 排课列表');
 const retainedRow=page.getByRole('row').and(page.locator('[data-row-key="'+scheduleId+'"]'));await retainedRow.waitFor();
 assert.match(await retainedRow.innerText(),/初二物理/);assert.match(await retainedRow.innerText(),/东湖上课点/);assert.match(await retainedRow.innerText(),/12:00.*13:30/);
 save('teacher-delete-reloaded-tree',await page.locator('body').ariaSnapshot());await page.screenshot({path:path.join(out,'teacher-delete-reloaded.png'),scale:'css',animations:'disabled'});
 save('teacher-delete-history',{before:{course,schedule},after:{course:after.courses.find(c=>c.id===courseId),schedule:after.schedules.find(s=>s.id===scheduleId)},same:true});
 return {teacherDeleted:true,historyPreserved:true,reloaded:true,reconnectDidNotSubmit:true};
};
