'use strict';
// UTF-8: original resource controls against a disposable teacher session.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({ page, out, save, studentId, teacherId, releaseNavigation }) => {
  const dialog = page.getByRole('dialog');
  const projection = () => page.evaluate(() => window.desktopIdentitySessionProvider.listCloudBusinessProjection());
  const initial = await projection();
  const room = initial.rooms.find(r => r.name === 'E2E-20260905-桌面验收教室');
  assert(room, 'explicit pre-existing test address required');
  const results = [];
  const navigate = async item => {
    await page.locator('.app-shell__collapse-button').click();
    const group = page.getByRole('menuitem', { name: 'team 资源', exact: true });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await releaseNavigation();
  };
  const getDraft = async (entity, id, action) => {
    await page.waitForFunction(async ({ entity, id, action }) => (await window.desktopAuthority.list()).some(d =>
      d.type === `${entity}.${action}.v1` && d.payload.id === id && d.status === 'awaiting_confirmation'), { entity, id, action });
    return page.evaluate(async ({ entity, id, action }) => (await window.desktopAuthority.list()).find(d =>
      d.type === `${entity}.${action}.v1` && d.payload.id === id && d.status === 'awaiting_confirmation'), { entity, id, action });
  };
  const confirm = async (draft, allowed, artifact) => {
    await page.locator('.sync-quick-popover:visible').waitFor({ state: 'hidden' });
    await page.locator('.sync-status-trigger').click();
    // UTF-8: review must read fresh content without requiring a manual panel refresh.
    await page.locator('[data-row-key="' + draft.id + '"]').getByRole('button', { name: '查看并确认', exact: true }).click();
    await dialog.waitFor();
    if (draft.payload.changes?.name) await dialog.getByText(draft.payload.changes.name, { exact: true }).waitFor();
    if (draft.type.endsWith('.delete.v1')) await dialog.getByText(draft.preview.record.name, { exact: true }).waitFor();
    // UTF-8: wait for a stable original confirmation control before capturing the modal.
    await dialog.getByRole('button', { name: '确认并发送', exact: true }).hover();
    await page.screenshot({ path: path.join(out, artifact + '-confirm.png'), scale: 'css', animations: 'disabled' });
    await dialog.getByRole('button', { name: '确认并发送', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 45000 });
    // UTF-8: observe this submission's actual IPC receipt, never resubmit or infer success from a closing modal.
    let stored;
    const observations = [];
    const deadline = Date.now() + 45000;
    do {
      stored = await page.evaluate(async id => (await window.desktopAuthority.list()).find(d => d.id === id), draft.id);
      observations.push({ at: new Date().toISOString(), status: stored?.status, receipt: stored?.receipt?.status || null });
      if (['completed', 'conflict'].includes(stored?.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    save(artifact + '-receipt-observations', observations);
    assert.equal(stored.status, allowed ? 'completed' : 'conflict');
    if (!allowed) {
      assert.equal(stored.receipt.status, 'rejected');
      assert.equal(stored.receipt.result.error.code, 'CLOUD_BUSINESS_ACCESS_DENIED');
      assert.deepEqual(stored.payload, draft.payload, 'denied drafts must retain their confirmed contents');
    }
    await page.screenshot({ path: path.join(out, artifact + '-result.png'), scale: 'css' });
    return stored;
  };
  for (const [entity, collection, id, menu, label, updateAllowed, deleteAllowed] of [
    ['student', 'students', studentId, 'user 学生', '林小禾', true, true],
    ['teacher', 'teachers', teacherId, 'team 老师', '角色测试老师', true, false],
    ['room', 'rooms', room.id, 'home 上课地址', '角色测试地址', false, false],
  ]) {
    await navigate(menu);
    const baseline = (await projection())[collection].find(r => r.id === id);
    assert(baseline);
    const row = page.getByRole('row').and(page.locator('[data-row-key="' + id + '"]'));
    const edit = async (name, offline) => {
      await row.getByRole('button', { name: 'edit 编辑', exact: true }).click();
      await dialog.waitFor();
      await dialog.locator('#name').fill(name);
      await page.context().setOffline(offline);
      await dialog.getByRole('button', { name: entity === 'room' ? /^保\s*存$/ : /^确\s*定$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    await edit(label + '初改', true);
    await page.context().setOffline(false);
    assert.deepEqual((await projection())[collection].find(r => r.id === id), baseline);
    await edit(label + '复核', false);
    const update = await getDraft(entity, id, 'update');
    assert.equal(update.payload.changes.name, label + '复核');
    assert.deepEqual((await projection())[collection].find(r => r.id === id), baseline, 'online resave must not piggyback offline edits');
    const updateReceipt = await confirm(update, updateAllowed, 'resource-' + entity + '-update');
    const updated = (await projection())[collection].find(r => r.id === id);
    if (updateAllowed) assert.equal(updated.name, label + '复核'); else assert.deepEqual(updated, baseline);
    if (entity === 'teacher') {
      // UTF-8: changing the name must not change the original subject, phone, rate or notes.
      for (const field of ['phone', 'subject', 'hourly_rate']) assert.deepEqual(updated[field], baseline[field], field);
      // Existing optional-text REST contract normalizes an empty note to null; non-empty notes remain exact.
      assert.equal(updated.notes ?? '', baseline.notes ?? '', 'notes');
    }
    // Leave another edit pending, then use the original delete confirmation.
    await edit(label + '待删除', true);
    await page.context().setOffline(false);
    await row.getByRole('button', { name: 'delete 删除', exact: true }).click();
    await page.locator('.ant-popconfirm:visible').getByRole('button', { name: /^确\s*定$/ }).click();
    const deletion = await getDraft(entity, id, 'delete');
    assert.deepEqual((await projection())[collection].find(r => r.id === id), updated, 'delete must still await confirmation');
    const deleteReceipt = await confirm(deletion, deleteAllowed, 'resource-' + entity + '-delete');
    const deleted = (await projection())[collection].find(r => r.id === id);
    if (deleteAllowed) assert.equal(deleted, undefined); else assert.deepEqual(deleted, updated);
    results.push({ entity, updateAllowed, deleteAllowed, editNoPiggyback: true, deleteWaited: true,
      updateStatus: updateReceipt.status, deleteStatus: deleteReceipt.status, deniedContentsPreserved: !deleteAllowed });
    save('resource-confirmation-readback', results);
  }
  console.log(JSON.stringify({ stage: 'resource_confirmation_verified', results }));
  return results;
};
