'use strict';
// UTF-8: real original controls, disposable cloud only; reads never stand in for user input.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({ page, out, save, courseId, scheduleId, releaseNavigation }) => {
  const dialog = page.getByRole('dialog');
  const read = () => page.evaluate(() => window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const drafts = () => page.evaluate(() => window.desktopAuthority.list());
  const baseline = await read();
  const originalCourse = baseline.courses.find(c => c.id === courseId);
  const originalSchedule = baseline.schedules.find(s => s.id === scheduleId);
  assert(originalCourse && originalSchedule);
  const freshRoomName = '南湖上课点';
  assert(!baseline.rooms.some(r => r.name === freshRoomName));
  const courseRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '初二物理', exact: true }) });
  const navigate = async item => {
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await releaseNavigation();
  };
  const confirm = async (draft, artifact, keep = false) => {
    await page.locator('.sync-quick-popover:visible').waitFor({ state: 'hidden' });
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="' + draft.id + '"]').getByRole('button', { name: '查看并确认', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '确认并发送', exact: true }).hover();
    await dialog.evaluate(async el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
    save(artifact + '-snapshot', await dialog.ariaSnapshot());
    await page.screenshot({ path: path.join(out, artifact + '.png'), scale: 'css' });
    await dialog.getByRole('button', { name: keep ? '继续保留草稿' : '确认并发送', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 45000 });
    if (keep) return;
    const observations = []; let stored;
    const deadline = Date.now() + 45000;
    do {
      stored = (await drafts()).find(d => d.id === draft.id);
      observations.push({ status: stored?.status, at: new Date().toISOString() });
      if (['completed', 'conflict'].includes(stored?.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    save(artifact + '-receipt', { stored, observations });
    assert.equal(stored?.status, 'completed', 'confirmed address change must finish with a real cloud receipt');
  };
  const pendingSchedule = async room => {
    await page.waitForFunction(async ({ scheduleId, room }) => (await window.desktopAuthority.list()).some(d =>
      d.type === 'schedule.update.v1' && d.payload.id === scheduleId && d.status === 'awaiting_confirmation' && d.payload.changes.room === room), { scheduleId, room });
    return (await drafts()).find(d => d.type === 'schedule.update.v1' && d.payload.id === scheduleId && d.status === 'awaiting_confirmation');
  };
  await navigate('book 课程信息');
  await courseRow.getByRole('button', { name: 'edit 编辑', exact: true }).click();
  await dialog.waitFor();
  await page.context().setOffline(true);
  await dialog.locator('#room_id').fill(freshRoomName);
  await dialog.locator('#room_id').press('Enter');
  await dialog.locator('#room_id').press('Tab');
  await dialog.getByText('课程名称', { exact: true }).click();
  await page.screenshot({ path: path.join(out, 'address-01-original-course-edit.png'), scale: 'css' });
  await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  const pending = (await drafts()).filter(d => d.status === 'awaiting_confirmation');
  const roomDraft = pending.find(d => d.type === 'room.create.v1' && d.payload.record.name === freshRoomName);
  const courseDraft = pending.find(d => d.type === 'course.update.v1' && d.payload.id === courseId);
  const scheduleDraft = await pendingSchedule(freshRoomName);
  assert(roomDraft && courseDraft);
  assert.equal(courseDraft.payload.changes.room_id, roomDraft.payload.record.id);
  // UTF-8: the existing encrypted draft contract stores the baseline in payload.expectedVersion.
  assert.equal(new Date(scheduleDraft.payload.expectedVersion).getTime(), new Date(originalSchedule.updated_at).getTime());
  await page.context().setOffline(false);
  assert.deepEqual(await read(), baseline, 'reconnecting must not send the room, course or linked schedule');
  await confirm(courseDraft, 'address-02-decline-course', true);
  assert.deepEqual(await read(), baseline, 'keeping the draft must preserve all cloud records');
  await confirm(courseDraft, 'address-03-confirm-course');
  const afterCourse = await read();
  const changedCourse = afterCourse.courses.find(c => c.id === courseId);
  assert.equal(changedCourse.room_name, freshRoomName);
  assert.equal(changedCourse.room_id, roomDraft.payload.record.id);
  for (const key of ['name', 'display_name', 'teacher_id', 'year', 'semester', 'type', 'source_type', 'institution_id', 'active',
    'default_duration_minutes', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode', 'student_pricings', 'notes']) {
    assert.deepEqual(changedCourse[key], originalCourse[key], 'address edit must preserve the original course field: ' + key);
  }
  assert.equal(afterCourse.rooms.filter(r => r.name === freshRoomName).length, 1);
  assert.deepEqual(afterCourse.schedules, baseline.schedules, 'course confirmation must not silently submit linked schedule drafts');
  assert.equal((await drafts()).find(d => d.id === roomDraft.id).status, 'completed');
  assert.equal((await drafts()).find(d => d.id === scheduleDraft.id).status, 'awaiting_confirmation');
  await confirm(scheduleDraft, 'address-04-confirm-schedule');
  const afterSchedule = await read();
  const changedSchedule = afterSchedule.schedules.find(s => s.id === scheduleId);
  assert.equal(changedSchedule.room, freshRoomName);
  assert.deepEqual({ ...changedSchedule, room: originalSchedule.room, updated_at: originalSchedule.updated_at }, originalSchedule,
    'address linkage must retain time, attendance, fees, notes and every other schedule field');
  await navigate('calendar 课程表');
  const card = page.locator('[data-schedule-id="' + scheduleId + '"]');
  await card.waitFor();
  assert.match(await card.innerText(), /南湖上课点\s+12:00-13:30/);
  await page.screenshot({ path: path.join(out, 'address-05-linked-calendar.png'), scale: 'css' });
  // Exercise the reverse path with the original existing-address option (no duplicate new address).
  await navigate('book 课程信息');
  await courseRow.getByRole('button', { name: 'edit 编辑', exact: true }).click();
  await dialog.waitFor();
  await dialog.locator('#room_id').fill(originalCourse.room_name);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(originalCourse.room_name, { exact: true }).first().click();
  await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 45000 });
  const restoreDraft = await pendingSchedule(originalCourse.room_name);
  const beforeRestore = await read();
  assert.deepEqual(beforeRestore.schedules, afterSchedule.schedules, 'online course restore must leave schedule linkage awaiting confirmation');
  assert.equal(beforeRestore.courses.find(c => c.id === courseId).room_id, originalCourse.room_id);
  assert.equal(beforeRestore.rooms.length, afterCourse.rooms.length, 'selecting the existing address must not create a duplicate');
  await confirm(restoreDraft, 'address-06-confirm-restore');
  const restored = await read();
  const restoredSchedule = restored.schedules.find(s => s.id === scheduleId);
  assert.deepEqual({ ...restoredSchedule, updated_at: originalSchedule.updated_at }, originalSchedule);
  await page.reload();
  await page.locator('.app-shell').waitFor({ timeout: 45000 });
  await page.getByText('系统加载中...', { exact: true }).waitFor({ state: 'hidden', timeout: 45000 });
  await page.locator('.app-shell__collapse-button').click();
  await page.getByRole('menuitem', { name: 'calendar 教务', exact: true }).click();
  await page.getByRole('menuitem', { name: 'calendar 课程表', exact: true }).click();
  await releaseNavigation();
  await card.waitFor();
  assert.match(await card.innerText(), /东湖上课点\s+12:00-13:30/);
  await page.screenshot({ path: path.join(out, 'address-07-restored-reloaded.png'), scale: 'css' });
  save('course-address-readback', { originalCourse, originalSchedule, changedCourse, changedSchedule, restoredSchedule,
    draftIds: [roomDraft.id, courseDraft.id, scheduleDraft.id, restoreDraft.id], noReconnectWrite: true,
    declineNoWrite: true, noSchedulePiggyback: true, restoreReusesAddress: true });
  return { courseAddressLinkedAfterConfirmation: true, linkedScheduleFieldsPreserved: true, courseAddressRestoredReloaded: true };
};
