'use strict';
// UTF-8: original date controls, native warning, explicit cloud confirmation and undo.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,app,out,save,fixture,releaseNavigation})=>{
 const projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
 const draftList=()=>page.evaluate(()=>window.desktopAuthority.list());
 const capture=async name=>{save(name+'-tree',await page.locator('.app-shell__main').ariaSnapshot());await page.screenshot({path:path.join(out,name+'.png'),scale:'css'});};
 const navigate=async()=>{await page.locator('.app-shell__collapse-button').click();if(!await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).isVisible())await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).click();await releaseNavigation();};
 await navigate();const before=await projection(),initial=await draftList(),ids=fixture.refreshIds;
 for(const id of [...ids,...fixture.outsideIds])assert(before.schedules.some(s=>s.id===id));
 assert.deepEqual(before.schedules.filter(s=>new Date(s.start_time)>=new Date('2026-09-07T16:00:00Z')&&new Date(s.start_time)<new Date('2026-09-08T16:00:00Z')).map(s=>s.id).sort(),[...ids].sort(),'date range must contain only disposable fixture targets');
 for(const label of ['开始日期','截止日期']){const input=page.getByPlaceholder(label,{exact:true});await input.fill('2026-09-08');await input.press('Enter');assert.equal(await input.inputValue(),'2026-09-08');}
 await capture('refresh-01-before');
 const refresh=async accept=>{
  const prompt=page.waitForEvent('dialog'),click=page.getByRole('button',{name:'刷新课程信息',exact:true}).click({timeout:180000});const dialog=await prompt;
  assert.equal(dialog.type(),'confirm');assert.match(dialog.message(),/覆盖当前排课的学生学费/);
  console.log(JSON.stringify({stage:'native_refresh_confirmation_waiting',expected:accept?'confirm':'cancel',out}));
  await click;const enabled=await app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],until=Date.now()+180000;while(!win.isEnabled()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));return win.isEnabled();});
  assert.equal(enabled,true);save('refresh-native-'+accept,{message:dialog.message(),ownerEnabled:enabled,cdpResponseUsed:false});
 };
 await refresh(false);assert.deepEqual(await draftList(),initial);assert.deepEqual(await projection(),before);
 await page.context().setOffline(true);await refresh(true);
 const pending=async()=>{
  await page.waitForFunction(async ids=>(await window.desktopAuthority.list()).filter(d=>d.status==='awaiting_confirmation'&&ids.includes(d.payload.id)).length===ids.length,ids);
  const drafts=(await draftList()).filter(d=>d.status==='awaiting_confirmation');assert.equal(drafts.length,ids.length);assert(drafts.every(d=>ids.includes(d.payload.id)&&d.type==='schedule.update.v1'));return drafts;
 };
 const drafts=await pending();for(const draft of drafts){const row=before.schedules.find(s=>s.id===draft.payload.id);assert.equal(new Date(draft.payload.expectedVersion).getTime(),new Date(row.updated_at).getTime());assert.equal(draft.payload.changes.calculated_tuition,220);assert.equal(draft.payload.changes.calculated_teacher_fee,160);}
 await capture('refresh-02-local-drafts');await page.context().setOffline(false);assert.deepEqual(await projection(),before);
 const confirmAll=async(drafts,baseline,prefix)=>{
  let current=baseline;
  for(const draft of drafts){
   await page.locator('.sync-status-trigger').click();await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.deepEqual(await projection(),current);
   await capture(prefix+'-'+draft.payload.id);await dialog.getByRole('button',{name:'确认并发送',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:45000});
   await page.waitForFunction(async id=>['completed','conflict','failed'].includes((await window.desktopAuthority.list()).find(d=>d.id===id)?.status),draft.id,{timeout:45000});
   const done=(await draftList()).find(d=>d.id===draft.id);save(prefix+'-receipt-'+draft.payload.id,done);assert.equal(done.status,'completed');
   await page.locator('.sync-quick-popover:visible').waitFor({state:'hidden'});const next=await projection();
   assert.deepEqual(next.schedules.filter(s=>s.id!==draft.payload.id),current.schedules.filter(s=>s.id!==draft.payload.id));current=next;
  }
  return current;
 };
 const refreshed=await confirmAll(drafts,before,'refresh-03-confirm'),expected=structuredClone(before);
 for(const row of expected.schedules)if(ids.includes(row.id)){row.room='更新后上课地址';row.billing_unit=2;row.teacher_fee_mode=2;row.calculated_tuition=220;row.calculated_teacher_fee=160;row.student_pricings=row.student_pricings.map(p=>({...p,attendance_status:1,tuition:220,teacher_fee:160}));row.updated_at=refreshed.schedules.find(s=>s.id===row.id).updated_at;}
 // UTF-8: the original refresh replaces teacher snapshots with course defaults, including null.
 for(const row of expected.schedules)if(ids.includes(row.id))row.teacher_name=before.courses.find(c=>c.id===row.course_id).teacher_name;
 assert.deepEqual(refreshed,expected);save('refresh-confirmed-readback',{before,after:refreshed});
 await page.context().setOffline(true);await page.keyboard.press('Control+z');const undo=await pending();for(const draft of undo){assert.equal(draft.payload.changes.calculated_tuition,0);assert.equal(draft.payload.changes.calculated_teacher_fee,0);}
 await page.context().setOffline(false);assert.deepEqual(await projection(),refreshed);const restored=await confirmAll(undo,refreshed,'refresh-04-undo');const expectedUndo=structuredClone(before);
 for(const row of expectedUndo.schedules)if(ids.includes(row.id))row.updated_at=restored.schedules.find(s=>s.id===row.id).updated_at;
 assert.deepEqual(restored,expectedUndo);await page.reload();await page.locator('.app-shell').waitFor({timeout:45000});await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});await navigate();
 const reloaded=await projection();assert.deepEqual(reloaded,restored);await page.locator('[data-schedule-id="'+ids[0]+'"]').scrollIntoViewIfNeeded();await capture('refresh-05-reloaded');
 save('refresh-ui-readback',{before,refreshed,restored,reloaded});return {nativeCancelUnchanged:true,dateRangeExact:true,noSilentSubmission:true,confirmedRefresh:true,confirmedUndo:true,reloaded:true};
};
