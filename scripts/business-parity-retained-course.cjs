'use strict';
// UTF-8: original desktop pointer gestures and confirmation controls; state reads only.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,out,save,fixture,releaseNavigation})=>{
 const id=fixture.studentId,projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
 const baseline=await projection(),original=baseline.schedules.find(s=>s.id===id);assert(original);assert(!baseline.courses.some(c=>c.id===id));
 const card=page.locator('[data-schedule-id="'+id+'"]');
 const snapshot=async name=>{save(name+'-tree',await page.locator('.app-shell__main').ariaSnapshot());await page.screenshot({path:path.join(out,name+'.png'),scale:'css'});};
 const pending=async(type,recordId,start,end,tuition)=>{
  let last,stable=null;const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   last=await page.evaluate(async({type,recordId,courseId})=>(await window.desktopAuthority.list()).find(d=>d.type===type&&d.status==='awaiting_confirmation'&&(recordId?d.payload.id===recordId:d.payload.record?.course_id===courseId)),{type,recordId,courseId:id});
   const r=last&&(last.payload.record||last.payload.changes);
   const matches=last&&(type==='schedule.delete.v1'||(r&&new Date(r.start_time).getTime()===new Date(start).getTime()&&new Date(r.end_time).getTime()===new Date(end).getTime()&&r.calculated_tuition===tuition));
   if(matches){if(stable===null)stable=Date.now();}else stable=null;
   if(stable!==null&&Date.now()-stable>600)return last;
   await page.waitForTimeout(75);
  }
  save('retained-unstable-draft',{type,recordId,start,end,tuition,last});throw Error('RETAINED_COURSE_DRAFT_NOT_STABLE');
 };
 const confirm=async(draft,before,label)=>{
  await page.context().setOffline(false);assert.deepEqual(await projection(),before,'reconnection must not submit '+label);
  await page.locator('.sync-status-trigger').click();
  await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('button',{name:'确认并发送',exact:true}).hover();
  assert.deepEqual(await projection(),before,'review must not submit '+label);await snapshot(label+'-confirm');
  await dialog.getByRole('button',{name:'确认并发送',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:45000});
  await page.waitForFunction(async id=>['completed','conflict','failed'].includes((await window.desktopAuthority.list()).find(d=>d.id===id)?.status),draft.id,{timeout:45000});
  const result=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),draft.id);save(label+'-receipt',result);assert.equal(result.status,'completed');
  await page.locator('.sync-quick-popover:visible').waitFor({state:'hidden'});return projection();
 };
 const drag=async(date,copy=false)=>{
  await card.scrollIntoViewIfNeeded();const destination=page.locator('[data-date="'+date+'"] [data-day-body="true"]');await destination.waitFor();
  assert.equal(await destination.getAttribute('data-min-start-slot'),await card.locator('xpath=..').getAttribute('data-min-start-slot'));
  const a=await card.boundingBox(),b=await destination.boundingBox();assert(a&&b);save('retained-'+(copy?'copy':'move')+'-geometry',{source:a,target:b,date});
  if(copy)await page.keyboard.down('Control');
  try{await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,a.y+a.height/2,{steps:18});await page.mouse.up();}
  finally{if(copy)await page.keyboard.up('Control');}
 };
 const movedStart='2026-09-09T01:00:00Z',shortEnd='2026-09-09T02:30:00Z',longEnd='2026-09-09T03:00:00Z';
 for(const day of ['09','10'])assert(!baseline.schedules.some(s=>s.id!==id&&new Date(s.start_time)<new Date('2026-09-'+day+'T03:00:00Z')&&new Date(s.end_time)>new Date('2026-09-'+day+'T01:00:00Z')),'fixture target must be empty');
 await snapshot('retained-01-before');await page.context().setOffline(true);await drag('2026-09-09');
 await pending('schedule.update.v1',id,movedStart,shortEnd,270);await snapshot('retained-02-moved');
 const box=await card.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height-2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height-2+box.height/90*30,{steps:12});await page.mouse.up();
 await pending('schedule.update.v1',id,movedStart,longEnd,360);await snapshot('retained-03-resized');
 await page.keyboard.press('Control+z');await pending('schedule.update.v1',id,movedStart,shortEnd,270);
 await page.getByRole('button',{name:/^重\s*做$/}).click();
 const resized=await pending('schedule.update.v1',id,movedStart,longEnd,360);assert.equal(resized.payload.changes.calculated_teacher_fee,240);
 assert.equal(new Date(resized.payload.expectedVersion).getTime(),new Date(original.updated_at).getTime());
 const afterResize=await confirm(resized,baseline,'retained-04-resize'),moved=afterResize.schedules.find(s=>s.id===id);
 assert.equal(new Date(moved.start_time).getTime(),new Date(movedStart).getTime());assert.equal(new Date(moved.end_time).getTime(),new Date(longEnd).getTime());
 assert.equal(moved.calculated_tuition,360);assert.equal(moved.calculated_teacher_fee,240);assert.deepEqual(moved.student_pricings,original.student_pricings);
 await page.context().setOffline(true);await drag('2026-09-10',true);
 const copied=await pending('schedule.create.v1',null,'2026-09-10T01:00:00Z','2026-09-10T03:00:00Z',360),copyId=copied.payload.record.id;assert.notEqual(copyId,id);
 const afterCopy=await confirm(copied,afterResize,'retained-05-copy');assert(afterCopy.schedules.some(s=>s.id===copyId));
 await page.context().setOffline(true);await page.keyboard.press('Control+z');
 const undoCopy=await pending('schedule.delete.v1',copyId);assert.equal(await page.locator('[data-schedule-id="'+copyId+'"]').count(),0);
 const afterUndo=await confirm(undoCopy,afterCopy,'retained-06-undo-copy');assert(!afterUndo.schedules.some(s=>s.id===copyId));
 save('retained-course-cloud-before-reload',{copyId,baseline,afterResize,afterCopy,afterUndo});
 await page.reload();await page.locator('.app-shell').waitFor({timeout:45000});await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
 // UTF-8: the original app reopens on its workbench; navigate, do not change that behavior.
 await page.locator('.app-shell__collapse-button').click();
 if(!await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).isVisible())await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();
 await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).click();await releaseNavigation();
 await card.waitFor();await card.scrollIntoViewIfNeeded();assert.match(await card.innerText(),/原上课地址\s+09:00-11:00/);
 assert.equal(await page.locator('[data-schedule-id="'+copyId+'"]').count(),0);await snapshot('retained-07-reloaded');
 const reloaded=await projection();assert.deepEqual(reloaded.schedules,afterUndo.schedules);assert(!reloaded.courses.some(c=>c.id===id));
 for(const key of ['students','student_contacts','payments','consumptions'])assert.deepEqual(reloaded[key],baseline[key]);
 save('retained-course-ui-readback',{copyId,baseline,afterResize,afterCopy,afterUndo,reloaded});
 return {copyId,moveAndResize:true,undoRedo:true,confirmedCopy:true,confirmedUndoOfCopy:true,reloaded:true,noSilentSubmission:true};
};
