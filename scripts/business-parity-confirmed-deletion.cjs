'use strict';
// UTF-8: original undo must restore a cloud-confirmed deletion, not merely the local card.
const assert=require('node:assert/strict'),path=require('node:path');
const {deleteLessonWithNativeConfirmation}=require('./business-parity-schedule-deletion.cjs');
module.exports=async function({page,app,out,save,scheduleId,reopenCalendar,confirmVisibleDraft}) {
  await reopenCalendar();
  const before=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const original=before.schedules.find(s=>s.id===scheduleId);assert(original);
  const card=page.locator('[data-schedule-id="'+scheduleId+'"]');
  await deleteLessonWithNativeConfirmation({page,app,save,scheduleId,accept:true});
  await card.waitFor({state:'hidden'});
  const pending=()=>page.evaluate(async id=>(await window.desktopAuthority.list()).filter(d=>d.status==='awaiting_confirmation'&&(d.payload.id||d.payload.record?.id)===id),scheduleId);
  await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>d.status==='awaiting_confirmation'&&d.type==='schedule.delete.v1'&&d.payload.id===id),scheduleId);
  await confirmVisibleDraft((await pending())[0]);
  const deleted=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  assert.deepEqual(deleted.schedules,before.schedules.filter(s=>s.id!==scheduleId));
  await page.keyboard.press('Control+z');await card.waitFor();
  await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>d.status==='awaiting_confirmation'&&(d.payload.id||d.payload.record?.id)===id),scheduleId);
  const drafts=await pending();assert.equal(drafts.length,1);
  assert.deepEqual((await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection())).schedules,deleted.schedules,'undo stays local before explicit confirmation');
  await card.screenshot({path:path.join(out,'39-confirmed-delete-undone-locally.png')});
  let submitError=null;
  try{await confirmVisibleDraft(drafts[0]);}catch(error){submitError=String(error);}
  const restored=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const finalDraft=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),drafts[0].id);
  save('confirmed-delete-undo-readback',{original,restoreDraft:drafts[0],finalDraft,submitError,restored:restored.schedules.find(s=>s.id===scheduleId)||null});
  assert.equal(finalDraft.status,'completed','confirmed deletion undo must submit a valid restoration');
  const restoredLesson=restored.schedules.find(s=>s.id===scheduleId);
  assert(restoredLesson,'restored lesson must exist in cloud');
  const withoutVersion=record=>{const {updated_at,...value}=record;return value;};
  assert.deepEqual(withoutVersion(restoredLesson),withoutVersion(original),'restoration must preserve original time, address, attendance, fees and creation metadata');
  assert.notEqual(restoredLesson.updated_at,original.updated_at);
  assert.deepEqual(restored.schedules.filter(s=>s.id!==scheduleId),deleted.schedules,'other lessons must stay unchanged');
  assert.deepEqual(restored.courses,before.courses);
  await reopenCalendar();await card.waitFor();
  return{confirmedDeletionUndoRestored:true};
};
