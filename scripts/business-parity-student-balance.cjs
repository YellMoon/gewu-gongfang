'use strict';
// UTF-8: original student table/editor; reads only, with synthetic cloud ledgers.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({page,app,out,save,fixture,releaseNavigation,waitForModalWidth}) => {
  const before = await page.evaluate(() => window.desktopAuthority.list());
  let ledgerSnapshot;
  const inspectRow = async label => {
    await page.getByRole('button',{name:'plus 添加学生',exact:true}).waitFor();
    const row = page.locator('[data-row-key="'+fixture.studentId+'"]');
    for(let i=0;!(await row.count())&&i<30;i++) {
      const next=page.locator('.ant-pagination-next:not(.ant-pagination-disabled)');
      if(!(await next.count())) break;
      const previous=await page.locator('.ant-pagination-item-active').innerText();
      await next.click();
      await page.waitForFunction(value=>document.querySelector('.ant-pagination-item-active')?.textContent!==value,previous);
    }
    await row.getByRole('cell',{name:fixture.name,exact:true}).waitFor();
    await row.getByRole('cell',{name:'10.5课时',exact:true}).waitFor();
    await row.getByRole('cell',{name:'¥1020.00',exact:true}).waitFor();
    const projection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert(!projection.students.some(s=>s.id===fixture.hiddenStudentId));
    const payments=projection.payments.filter(p=>p.student_id===fixture.studentId);
    const consumptions=projection.consumptions.filter(c=>c.student_id===fixture.studentId);
    assert.deepEqual(payments.map(p=>p.id).sort(),[fixture.hoursPaymentId,fixture.tuitionPaymentId].sort());
    assert.equal(consumptions.length,1); assert.equal(consumptions[0].id,fixture.consumptionId);
    assert.equal(consumptions[0].amount,180); assert.equal(consumptions[0].hours,1.5);
    const snapshot={student:projection.students.find(s=>s.id===fixture.studentId),payments,consumptions};
    if(ledgerSnapshot) assert.deepEqual(snapshot,ledgerSnapshot,'read-only window checks must preserve cloud records and versions');
    else ledgerSnapshot=snapshot;
    save(label+'-readback',{studentId:fixture.studentId,payments,consumptions,row:await row.innerText()});
    await page.screenshot({path:path.join(out,label+'.png'),scale:'css'});
    return row;
  };
  let row=await inspectRow('balance-01-original-list');
  await row.getByRole('button',{name:'edit 编辑',exact:true}).click();
  const editor=page.getByRole('dialog'); await editor.waitFor();
  await waitForModalWidth(700);
  assert.equal(await page.locator('.ant-drawer:visible').count(),0);
  assert.equal(await editor.locator('#balance_hours').inputValue(),'10.5');
  assert.equal(await editor.locator('#balance_money').inputValue(),'1020');
  await page.screenshot({path:path.join(out,'balance-02-original-editor.png'),scale:'css'});
  await editor.getByRole('button',{name:/^取\s*消$/}).click(); await editor.waitFor({state:'hidden'});
  await page.reload();
  await page.locator('.app-shell').waitFor({timeout:45000});
  await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
  await page.locator('.app-shell__collapse-button').click();
  await page.getByRole('menuitem',{name:'team 资源',exact:true}).click();
  await page.getByRole('menuitem',{name:'user 学生',exact:true}).click();
  await releaseNavigation();
  await inspectRow('balance-03-reloaded-list');
  const {resizeParityWindow}=require('./business-parity-window-size.cjs');
  save('balance-window-size',await app.evaluate(resizeParityWindow,{width:1200,height:800}));
  await inspectRow('balance-04-1200-list');
  assert.deepEqual(await page.evaluate(()=>window.desktopAuthority.list()),before,'opening/cancelling/refreshing must not create or submit drafts');
  return {originalListBalance:true,originalEditorBalance:true,reloadBalance:true,smallWindowBalance:true,
    hiddenStudentExcluded:true,noDraftOrSubmission:true};
};
