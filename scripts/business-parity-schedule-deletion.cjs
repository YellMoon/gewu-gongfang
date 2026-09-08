'use strict';
// UTF-8: exercise the original context menu and history, never invoke handlers directly.
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function({page, out, save, scheduleId, confirmVisibleDraft, reopenCalendar, selectRectangle}) {
  await reopenCalendar();
  const card = page.locator('[data-schedule-id="'+scheduleId+'"]');
  const cloudBefore = await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const original = cloudBefore.schedules.find(s=>s.id===scheduleId); assert(original);
  const pending = () => page.evaluate(async id=>(await window.desktopAuthority.list()).filter(d=>
    d.status==='awaiting_confirmation'&&(d.payload.id===id||d.payload.record?.id===id)),scheduleId);
  const remove = async accept => {
    await card.scrollIntoViewIfNeeded(); await card.click({button:'right'});
    const prompt = page.waitForEvent('dialog');
    const click = page.getByRole('menuitem',{name:'删除课程',exact:true}).click();
    const nativeDialog = await prompt;
    assert.equal(nativeDialog.type(),'confirm');
    assert.equal(nativeDialog.message(),'确定要删除这节课程吗？');
    if(accept) await nativeDialog.accept(); else await nativeDialog.dismiss();
    await click;
  };
  const beforeCancel = await page.evaluate(()=>window.desktopAuthority.list());
  await remove(false); assert(await card.isVisible());
  assert.deepEqual(await page.evaluate(()=>window.desktopAuthority.list()),beforeCancel);
  await page.context().setOffline(true);
  await remove(true); await card.waitFor({state:'hidden'});
  await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>
    d.type==='schedule.delete.v1'&&d.status==='awaiting_confirmation'&&d.payload.id===id),scheduleId);
  const [deleted] = await pending(); assert.equal(deleted.type,'schedule.delete.v1');
  assert.equal(new Date(deleted.payload.expectedVersion).getTime(),new Date(original.updated_at).getTime());
  save('34-delete-pending',{original,deleted});
  await page.keyboard.press('Control+z'); await card.waitFor();
  await page.waitForFunction(async id=>(await window.desktopAuthority.list()).filter(d=>
    d.status==='awaiting_confirmation'&&(d.payload.id===id||d.payload.record?.id===id)).length===0,scheduleId,{timeout:12000});
  assert.deepEqual(await pending(),[],'undo of an unsubmitted deletion must restore the original pending state');
  await card.screenshot({path:path.join(out,'35-delete-undone.png')});
  await page.keyboard.press('Control+y'); await card.waitFor({state:'hidden'});
  await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>
    d.type==='schedule.delete.v1'&&d.status==='awaiting_confirmation'&&d.payload.id===id),scheduleId);
  const redone = await pending(); assert.equal(redone.length,1); assert.equal(redone[0].type,'schedule.delete.v1');
  assert.equal(new Date(redone[0].payload.expectedVersion).getTime(),new Date(original.updated_at).getTime());
  await page.context().setOffline(false);
  assert.deepEqual((await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection())).schedules,cloudBefore.schedules);
  await confirmVisibleDraft(redone[0]);
  const after = await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert(!after.schedules.some(s=>s.id===scheduleId));
  assert.deepEqual(after.schedules,cloudBefore.schedules.filter(s=>s.id!==scheduleId));
  assert.deepEqual(after.courses,cloudBefore.courses);
  save('schedule-deletion-readback',{original,remainingSchedules:after.schedules,courseDefaultsUnchanged:true});
  // UTF-8: original batch menu, confirmation and undo/redo cycle.
  await reopenCalendar(); assert.equal(await card.count(),0,'deleted lesson must stay absent after reload');
  const batchCourse = after.courses.find(c=>(c.display_name||c.name)==='双人讨论课'); assert(batchCourse);
  const batchRecords = after.schedules.filter(s=>s.course_id===batchCourse.id).sort((a,b)=>Date.parse(a.start_time)-Date.parse(b.start_time)).slice(0,2);
  assert.equal(batchRecords.length,2);
  const ids=batchRecords.map(s=>s.id);
  const pendingBatch=()=>page.evaluate(async ids=>(await window.desktopAuthority.list()).filter(d=>
    d.status==='awaiting_confirmation'&&ids.includes(d.payload.id||d.payload.record?.id)),ids);
  await selectRectangle(ids[0],ids[1],2,'36-delete-selected-two');
  const openBatchDelete=async()=>{
    await page.getByText('已选 2 节 · 拖拽移动 · Ctrl 拖拽复制 · 右键更多',{exact:true}).locator('..').click({button:'right'});
    await page.getByRole('menuitem',{name:'全部删除',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'确认批量删除',exact:true});await dialog.waitFor();return dialog;
  };
  const cancelled=await openBatchDelete();
  await cancelled.getByRole('button',{name:/^取\s*消$/}).click();await cancelled.waitFor({state:'hidden'});
  assert.deepEqual(await pendingBatch(),[]);
  for(const id of ids)assert(await page.locator('[data-schedule-id="'+id+'"]').isVisible());
  await page.context().setOffline(true);
  const deleting=await openBatchDelete();
  await deleting.screenshot({path:path.join(out,'37-batch-delete-confirm.png')});
  await deleting.getByRole('button',{name:'确认删除',exact:true}).click();await deleting.waitFor({state:'hidden'});
  const waitBatchDeletion=async()=>page.waitForFunction(async ids=>{
    const drafts=(await window.desktopAuthority.list()).filter(d=>d.status==='awaiting_confirmation'&&ids.includes(d.payload.id||d.payload.record?.id));
    return drafts.length===ids.length&&drafts.every(d=>d.type==='schedule.delete.v1');
  },ids,{timeout:12000});
  await waitBatchDeletion();
  await page.keyboard.press('Control+z');
  for(const id of ids)await page.locator('[data-schedule-id="'+id+'"]').waitFor();
  await page.waitForFunction(async ids=>(await window.desktopAuthority.list()).filter(d=>
    d.status==='awaiting_confirmation'&&ids.includes(d.payload.id||d.payload.record?.id)).length===0,ids,{timeout:12000});
  await page.keyboard.press('Control+y');await waitBatchDeletion();
  const batchDrafts=await pendingBatch();
  for(const draft of batchDrafts)assert.equal(new Date(draft.payload.expectedVersion).getTime(),new Date(batchRecords.find(s=>s.id===draft.payload.id).updated_at).getTime());
  await page.context().setOffline(false);
  assert.deepEqual((await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection())).schedules,after.schedules);
  for(const draft of batchDrafts)await confirmVisibleDraft(draft);
  const final=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert.deepEqual(final.schedules,after.schedules.filter(s=>!ids.includes(s.id)));
  assert.deepEqual(final.courses,after.courses);
  await reopenCalendar();
  for(const id of ids)assert.equal(await page.locator('[data-schedule-id="'+id+'"]').count(),0);
  save('batch-deletion-readback',{deleted:batchRecords,remaining:final.schedules,courseDefaultsUnchanged:true});
  await page.screenshot({path:path.join(out,'38-deletion-reloaded.png'),scale:'css'});
  return {singleDeleteCancel:true,unsubmittedDeleteUndoRedo:true,singleDeleteConfirmed:true,deletePreservesOtherLessons:true,
    batchDeleteCancel:true,batchDeleteUndoRedo:true,batchDeleteConfirmed:true,deletionsReloaded:true};
};
