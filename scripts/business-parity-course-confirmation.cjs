'use strict';
// UTF-8: normal desktop controls, isolated cloud readback; never production writes.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({ page, out, save, courseId, selectCourseOption }) => {
  const dialog = page.getByRole('dialog');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '初二物理', exact: true }) });
  const read = async () => (await page.evaluate(() => window.desktopIdentitySessionProvider.listCloudBusinessProjection())).courses.find(c => c.id === courseId);
  const baseline = await read();
  assert.equal(baseline.active, true); assert.equal(baseline.default_duration_minutes, 90);
  const pending = async () => page.evaluate(async id => (await window.desktopAuthority.list()).filter(d =>
    d.type === 'course.update.v1' && d.status === 'awaiting_confirmation' && d.payload.id === id), courseId);
  await row.getByRole('button', { name: 'edit 编辑', exact: true }).click();
  await dialog.waitFor();
  await selectCourseOption('default_duration_minutes', '2小时');
  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await pending()).length, 1);
  await page.context().setOffline(false);
  assert.deepEqual(await read(), baseline, 'reconnection must not submit the offline duration edit');
  await row.getByRole('button', { name: '未结课', exact: true }).click();
  await row.waitFor({ state: 'hidden' });
  const drafts = await pending();
  assert.equal(drafts.length, 1, 'new unconfirmed changes should use the existing draft merge');
  const draft = drafts[0];
  assert.equal(draft.payload.changes.default_duration_minutes, 120);
  assert.equal(draft.payload.changes.active, false);
  assert.deepEqual(await read(), baseline, 'online status toggle must not piggyback the earlier duration edit');
  // Reveal the locally completed course using the original status filter.
  await page.locator('.ant-select').filter({ has: page.getByText('未结课', { exact: true }) }).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('已结课', { exact: true }).click();
  await row.getByRole('button', { name: '已结课', exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, '09a-course-local-completed.png'), scale: 'css' });
  const openConfirmation = async () => {
    await page.locator('.sync-quick-popover:visible').waitFor({ state: 'hidden' });
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="' + draft.id + '"]').getByRole('button', { name: '查看并确认', exact: true }).click();
    await dialog.waitFor();
  };
  await openConfirmation();
  await dialog.getByRole('button', { name: '继续保留草稿', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await read(), baseline, 'declining confirmation must leave the cloud untouched');
  await openConfirmation();
  // UTF-8: visual confirmation must expose the two actual changed values.
  await dialog.getByText('课程状态', { exact: true }).waitFor();
  await dialog.getByText('已结课', { exact: true }).waitFor();
  await dialog.getByText('默认时长', { exact: true }).waitFor();
  await dialog.getByText('2小时', { exact: true }).waitFor();
  await dialog.evaluate(async el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
  await dialog.screenshot({ path: path.join(out, '09b-course-pending-confirmation.png'), scale: 'css' });
  await dialog.getByRole('button', { name: '确认并发送', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 45000 });
  const completed = await page.evaluate(async id => (await window.desktopAuthority.list()).find(d => d.id === id), draft.id);
  assert.equal(completed.status, 'completed');
  const after = await read();
  assert.equal(after.active, false); assert.equal(after.default_duration_minutes, 120);
  for (const key of ['name', 'display_name', 'teacher_id', 'room_id', 'room_name', 'billing_unit', 'teacher_fee_mode', 'price_tuition', 'price_teacher', 'student_pricings']) {
    assert.deepEqual(after[key], baseline[key], 'confirmation must retain original course field: ' + key);
  }
  save('course-pending-confirmed', { baseline, after, completedDraftId: draft.id });
  // Restore via the original form; completed drafts no longer block normal online editing.
  // UTF-8: authority refresh remounts the page with its original unfinished-course filter.
  await page.locator('.ant-select').filter({ has: page.getByText('未结课', { exact: true }) }).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('已结课', { exact: true }).click();
  await row.getByRole('button', { name: 'edit 编辑', exact: true }).click();
  await dialog.waitFor();
  await selectCourseOption('default_duration_minutes', '1.5小时');
  await selectCourseOption('active', '未结课（出现在排课选择中）');
  await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 45000 });
  const restored = await read();
  assert.deepEqual({ ...restored, updated_at: baseline.updated_at }, baseline);
  assert.equal((await pending()).length, 0);
  save('course-pending-confirmation-readback', { baseline, after, restored, completedDraftId: draft.id,
    noReconnectWrite: true, noTogglePiggyback: true, declinedConfirmationNoWrite: true, restoredOnline: true });
  await page.screenshot({ path: path.join(out, '09c-course-restored-online.png'), scale: 'css' });
  console.log(JSON.stringify({ stage: 'course_pending_confirmation_verified' }));
  return { coursePendingNoPiggyback: true, coursePendingConfirmedReadback: true, coursePendingRestored: true };
};
