'use strict';
// UTF-8: original student-window interaction evidence.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {_electron} = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input); input = '';
  const out = config.out;
  const save = (name, data) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(data, null, 2), 'utf8');
  save('qa-inventory', {checks:[
    '原登录窗口账号密码登录、新安装实例静默登记、无人工设备审批',
    '原学生抽屉必填校验、取消、学校输入、保存后教师可见',
    '离线保存不提交、重连不提交、用户确认后云端可读回',
    '原课程窗口选入新学生、课程名称和地址不含跟踪编码',
    '原课表排课与调课、三项卡片、刷新后仍一致',
    '启动尺寸及较小窗口截图，无遮挡和裁切'], fullSignoff:false});
  const env = {...process.env, NODE_ENV:'production', GEWU_PARITY_SHADOW_URL:config.baseUrl,
    GEWU_DATA_DIR:path.join(out,'profile'), DB_PATH:path.join(out,'profile/data/scheduling.db')};
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_START_URL; delete env.GEWU_DESKTOP_LOGIN_FIXTURE;
  const server = require('node:net').createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  env.PORT = String(server.address().port); await new Promise(resolve => server.close(resolve));
  const app = await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),
    cwd:root,args:[path.join(__dirname,'business-parity-desktop-entry.cjs'),'--user-data-dir='+path.join(out,'profile')],env,timeout:45000});
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.getByPlaceholder('输入密码',{exact:true}).waitFor({timeout:45000});
    await page.screenshot({path:path.join(out,'01-login.png'),scale:'css'});
    save('startup-window', await app.evaluate(({BrowserWindow})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),content:BrowserWindow.getAllWindows()[0].getContentSize()})));
    save('01-login-snapshot', await page.locator('body').ariaSnapshot());
    await page.locator('.desktop-identity-password-form .ant-select-selector').click();
    await page.locator('.ant-select-dropdown:visible').getByText('账号名',{exact:true}).click();
    await page.getByPlaceholder('输入账号名',{exact:true}).fill(config.login.login);
    await page.getByPlaceholder('输入密码',{exact:true}).fill(config.login.password);
    await page.getByRole('button',{name:'密码登录',exact:true}).click();
    config.login.password = '';
    await page.locator('.app-shell').waitFor({timeout:45000});
    await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
    save('02-workspace-snapshot', await page.locator('body').ariaSnapshot());
    await page.screenshot({path:path.join(out,'02-workspace.png'),scale:'css'});
    // Read-only diagnostics; subsequent mutations use original UI controls.
    const projection = await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert(projection.teachers.some(t=>t.id===config.login.teacherId));
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem',{name:'team 资源',exact:true}).click();
    await page.getByRole('menuitem',{name:'user 学生',exact:true}).click();
    await page.getByRole('button',{name:'plus 添加学生',exact:true}).click();
    const drawer = page.getByRole('dialog');
    await drawer.waitFor();
    save('03-student-form-snapshot',await drawer.ariaSnapshot());
    await drawer.getByRole('button',{name:/^确\s*定$/}).click();
    await drawer.getByText('请输入姓名',{exact:true}).waitFor();
    await page.getByPlaceholder('请输入学生姓名',{exact:true}).fill('林小禾');
    await page.getByPlaceholder('请输入联系电话',{exact:true}).fill('13100000000');
    await drawer.locator('#school').fill('春禾中学');
    await drawer.locator('#school').press('Enter');
    await drawer.locator('#grade_year').click();
    await page.locator('.ant-select-dropdown:visible').getByText('2025级',{exact:true}).click();
    await drawer.screenshot({path:path.join(out,'03-student-form.png')});
    await page.context().setOffline(true);
    await drawer.getByRole('button',{name:/^确\s*定$/}).click();
    await drawer.waitFor({state:'hidden'});
    await page.waitForFunction(async()=> (await window.desktopAuthority.list()).some(d=>d.status==='awaiting_confirmation'&&d.type==='student.create.v1'),null,{timeout:12000});
    const drafts=await page.evaluate(async()=> (await window.desktopAuthority.list()).filter(d=>d.status==='awaiting_confirmation'));
    assert.equal(drafts.length,1,'student school must not create a separate confirmation draft');
    const draft=drafts[0];
    const studentId=draft.payload.record.id;
    assert.equal(typeof studentId,'string'); assert(studentId.length>0);
    await page.context().setOffline(false);
    const before=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert(!before.students.some(s=>s.id===studentId),'reconnection must not silently submit');
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
    await page.getByRole('dialog').screenshot({path:path.join(out,'04-student-confirm.png')});
    await page.getByRole('button',{name:'确认并发送',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden',timeout:45000});
    const result=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),draft.id);
    save('student-submission',{status:result.status,lastError:result.lastError});
    assert.equal(result.status,'completed');
    const after=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const student=after.students.find(s=>s.id===studentId);
    assert.equal(student?.name,'林小禾'); assert.equal(student?.school,'春禾中学');
    // UTF-8: original fields must survive canonical cloud readback.
    assert.equal(student?.source_type,1);
    assert.equal(after.student_contacts.find(c=>c.student_id===studentId&&c.slot===1)?.phone,'13100000000');
    assert(after.schools.some(s=>s.name==='春禾中学'));
    save('student-readback',{studentId,name:student.name,school:student.school,teacherCanRead:true,schoolRegistered:true});
    await page.reload();
    await page.locator('.app-shell').waitFor({timeout:45000});
    await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem',{name:'team 资源',exact:true}).click();
    await page.getByRole('menuitem',{name:'user 学生',exact:true}).click();
    await page.getByRole('button',{name:'plus 添加学生',exact:true}).waitFor();
    await page.getByRole('cell',{name:'林小禾',exact:true}).waitFor();
    const studentRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'林小禾',exact:true})});
    await studentRow.getByRole('cell',{name:'13100000000',exact:true}).waitFor();
    await studentRow.getByRole('cell',{name:'自有',exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'05-student-reloaded.png'),scale:'css'});
    save('desktop-receipt',{passwordLogin:true,sourceDesktop:true,installed:false,productionWrite:false,
      originalWorkspaceLoaded:true,teacherProjectionRead:true,studentDraftConfirmed:true,schoolAtomic:true,
      noSilentReconnectWrite:true,studentReloadVisible:true,businessFlowComplete:false});
    console.log(JSON.stringify({stage:'original_desktop_logged_in',out}));
  } catch(error) {
    if(page) {
      await page.getByPlaceholder('输入密码',{exact:true}).fill('').catch(()=>{});
      await page.screenshot({path:path.join(out,'failure.png'),scale:'css'}).catch(()=>{});
      save('failure', {error:String(error),snapshot:await page.locator('body').ariaSnapshot().catch(()=> '')});
    }
    throw error;
  } finally { await app.close(); }
}
main().catch(error => {console.error(String(error)); process.exitCode=1;});
