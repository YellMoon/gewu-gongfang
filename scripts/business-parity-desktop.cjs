'use strict';
// UTF-8: original student/course-window interaction evidence.
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
    '学生原弹窗必填校验、取消、学校输入、保存后教师可见',
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
    const releaseNavigation=async()=>{
      await page.locator('.app-shell__sider-unpin').click();
      // UTF-8: leave the hover-open rail before using controls underneath it.
      const mainBox=await page.locator('.app-shell__main').boundingBox();
      await page.mouse.move(mainBox.x+mainBox.width-30,mainBox.y+100);
      await page.waitForFunction(()=>!document.querySelector('.app-shell__sider--open'));
      await page.locator('.app-shell__sider').evaluate(async el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
    };
    const mainBeforeNav=await page.locator('.app-shell__main').boundingBox();
    // UTF-8: wait past both animation preparation and the actual zoom transition.
    const waitForModalWidth=async width=>page.getByRole('dialog').evaluate(async(el,expected)=>{
      // UTF-8: rc-motion may start after an initially untransformed frame.
      let stableSince=null;
      const deadline=performance.now()+7000;
      await new Promise((resolve,reject)=>{
        function frame(now) {
          const stable=Math.abs(el.getBoundingClientRect().width-expected)<1
            && getComputedStyle(el).transform==='none'
            && !el.getAnimations().some(a=>a.playState==='running');
          if(stable) { if(stableSince===null) stableSince=now; }
          else stableSince=null;
          if(stableSince!==null && now-stableSince>=350) return resolve();
          if(now>deadline) return reject(new Error('MODAL_GEOMETRY_NOT_STABLE'));
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    },width);
    await page.locator('.app-shell__collapse-button').click();
    assert.deepEqual(await page.locator('.app-shell__main').boundingBox(),mainBeforeNav,'pinning navigation must not resize or move the workspace');
    save('navigation-geometry',{before:mainBeforeNav,opened:await page.locator('.app-shell__main').boundingBox()});
    await page.screenshot({path:path.join(out,'02-navigation-overlay.png'),scale:'css'});
    await page.getByRole('menuitem',{name:'team 资源',exact:true}).click();
    await page.getByRole('menuitem',{name:'user 学生',exact:true}).click();
    await releaseNavigation();
    await page.getByRole('button',{name:'plus 添加学生',exact:true}).click();
    const drawer = page.getByRole('dialog');
    await drawer.waitFor();
    await drawer.locator('.ant-modal-content').waitFor();
    assert.equal(await page.locator('.ant-drawer:visible').count(),0);
    await waitForModalWidth(700);
    const studentModalBox=await drawer.boundingBox();
    assert.equal(Math.round(studentModalBox.width),700);
    // UTF-8: a tall original form has a scrollbar; center in the usable modal viewport.
    const viewportWidth=await page.locator('.ant-modal-wrap:visible').evaluate(el=>el.clientWidth);
    save('student-window-geometry',{studentModalBox,viewportWidth});
    assert(Math.abs(studentModalBox.x-(viewportWidth-studentModalBox.width)/2)<2,'student modal must be horizontally centered');
    save('03-student-form-snapshot',await drawer.ariaSnapshot());
    await drawer.getByRole('button',{name:/^确\s*定$/}).click();
    await drawer.getByText('请输入姓名',{exact:true}).waitFor();
    await page.getByPlaceholder('请输入学生姓名',{exact:true}).fill('林小禾');
    await page.getByPlaceholder('请输入联系电话',{exact:true}).fill('13100000000');
    await drawer.locator('#school').fill('春禾中学');
    await drawer.locator('#school').press('Enter');
    await drawer.locator('#grade_year').click();
    await page.locator('.ant-select-dropdown:visible').getByText('2025级',{exact:true}).click();
    await drawer.getByText('添加学生',{exact:true}).click();
    await page.screenshot({path:path.join(out,'03-student-form.png'),scale:'css'});
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
    await releaseNavigation();
    await page.getByRole('button',{name:'plus 添加学生',exact:true}).waitFor();
    await page.getByRole('cell',{name:'林小禾',exact:true}).waitFor();
    const studentRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'林小禾',exact:true})});
    await studentRow.getByRole('cell',{name:'13100000000',exact:true}).waitFor();
    await studentRow.getByRole('cell',{name:'自有',exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'05-student-reloaded.png'),scale:'css'});
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();
    await page.getByRole('menuitem',{name:'book 课程信息',exact:true}).click();
    await releaseNavigation();
    await page.getByRole('button',{name:'plus 添加课程',exact:true}).click();
    const courseDialog=page.getByRole('dialog');
    await courseDialog.waitFor();
    save('06-course-form-snapshot',await courseDialog.ariaSnapshot());
    const selectCourseOption=async (id,text)=>{
      // UTF-8: click the user-visible select surface, not its covered search input.
      await courseDialog.locator('.ant-select').filter({has:page.locator('#'+id)}).locator('.ant-select-selector').click();
      // UTF-8: target the visible option, not Ant Design's duplicate a11y mirror.
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).click();
    };
    await courseDialog.getByPlaceholder('请输入课程名称',{exact:true}).fill('初二物理');
    await selectCourseOption('semester','秋学期');
    await selectCourseOption('source_type','自有课程');
    await selectCourseOption('type','一对一');
    await selectCourseOption('default_duration_minutes','1.5小时');
    // Keep the original inline address workflow; both drafts need explicit confirmation.
    await courseDialog.locator('#room_id').fill('东湖上课点');
    await courseDialog.locator('#room_id').press('Enter');
    await courseDialog.getByRole('button',{name:'plus-circle 添加学生',exact:true}).click();
    await selectCourseOption('student_pricings_0_student_id','林小禾');
    await courseDialog.locator('#student_pricings_0_tuition').fill('180');
    await courseDialog.locator('#student_pricings_0_teacher_fee').fill('120');
    await courseDialog.locator('#student_pricings_0_teacher_fee').press('Tab');
    assert.equal(await courseDialog.locator('#price_tuition').inputValue(),'180');
    assert.equal(await courseDialog.locator('#price_teacher').inputValue(),'120');
    await courseDialog.screenshot({path:path.join(out,'06-course-form.png')});
    await courseDialog.getByRole('button',{name:/^确\s*定$/}).click();
    await courseDialog.waitFor({state:'hidden'});
    await page.waitForFunction(async()=> (await window.desktopAuthority.list()).some(d=>d.status==='awaiting_confirmation'&&d.type==='course.create.v1'));
    const courseDrafts=await page.evaluate(async()=> (await window.desktopAuthority.list()).filter(d=>d.status==='awaiting_confirmation'));
    assert.equal(courseDrafts.length,2,'inline new address and course must remain pending together');
    const courseDraft=courseDrafts.find(d=>d.type==='course.create.v1');
    assert(courseDraft);
    const courseId=courseDraft.payload.record.id;
    const beforeCourse=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert(!beforeCourse.courses.some(c=>c.id===courseId),'online address draft must not silently submit course');
    assert(!beforeCourse.rooms.some(r=>r.name==='东湖上课点'),'typing an address must not silently submit it');
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="'+courseDraft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').evaluate(async el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    save('07-course-confirm-snapshot',await page.getByRole('dialog').ariaSnapshot());
    await page.getByRole('dialog').screenshot({path:path.join(out,'07-course-confirm.png')});
    await page.getByRole('button',{name:'确认并发送',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden',timeout:45000});
    const courseResults=await page.evaluate(()=>window.desktopAuthority.list());
    for(const d of courseDrafts) assert.equal(courseResults.find(r=>r.id===d.id)?.status,'completed',d.type);
    const courseProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const course=courseProjection.courses.find(c=>c.id===courseId);
    save('course-readback',{course,rooms:courseProjection.rooms.filter(r=>r.name==='东湖上课点')});
    assert.equal(course?.display_name,'初二物理');
    assert.equal(course?.teacher_id,config.login.teacherId);
    assert.equal(course?.room_name,'东湖上课点');
    assert.equal(course?.default_duration_minutes,90);
    assert.equal(course?.price_tuition,180); assert.equal(course?.price_teacher,120);
    assert.equal(course?.student_pricings?.[0]?.student_id,studentId);
    await page.reload();
    await page.locator('.app-shell').waitFor({timeout:45000});
    await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();
    await page.getByRole('menuitem',{name:'book 课程信息',exact:true}).click();
    await releaseNavigation();
    const courseRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'初二物理',exact:true})});
    await courseRow.waitFor();
    save('08-course-reloaded-snapshot',await page.locator('body').ariaSnapshot());
    await page.screenshot({path:path.join(out,'08-course-reloaded.png'),scale:'css'});
    await courseRow.getByRole('button',{name:'edit 编辑',exact:true}).click();
    await courseDialog.waitFor();
    assert.equal(await courseDialog.locator('#price_tuition').inputValue(),'180');
    assert.equal(await courseDialog.locator('#price_teacher').inputValue(),'120');
    await courseDialog.getByText('林小禾',{exact:true}).waitFor();
    await courseDialog.getByText('东湖上课点',{exact:true}).waitFor();
    await courseDialog.screenshot({path:path.join(out,'09-course-reopened.png')});
    await courseDialog.getByRole('button',{name:/^取\s*消$/}).click();
    // UTF-8: continue through the existing calendar date header and schedule modal.
    await page.locator('.app-shell__collapse-button').click();
    await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).click();
    await releaseNavigation();
    await page.locator('[data-date]').first().waitFor();
    save('10-calendar-snapshot',await page.locator('body').ariaSnapshot());
    await page.screenshot({path:path.join(out,'10-calendar.png'),scale:'css'});
    const dayColumn=page.locator('[data-date]').first();
    const scheduleDate=await dayColumn.getAttribute('data-date');
    await dayColumn.locator(':scope > div').first().dblclick();
    await courseDialog.waitFor();
    save('11-schedule-form-snapshot',await courseDialog.ariaSnapshot());
    await selectCourseOption('teacherId',projection.teachers.find(t=>t.id===config.login.teacherId).name);
    await courseDialog.locator('#startTime').fill('12:00');
    await courseDialog.locator('#startTime').press('Enter');
    await selectCourseOption('courseId','初二物理');
    assert.equal(await courseDialog.locator('#endTime').inputValue(),'13:30');
    await courseDialog.getByText('东湖上课点',{exact:true}).waitFor();
    await courseDialog.screenshot({path:path.join(out,'11-schedule-form.png')});
    await page.context().setOffline(true);
    await courseDialog.getByRole('button',{name:/^保\s*存$/}).click();
    await courseDialog.waitFor({state:'hidden'});
    await page.waitForFunction(async()=> (await window.desktopAuthority.list()).some(d=>d.status==='awaiting_confirmation'&&d.type==='schedule.create.v1'));
    const scheduleDraft=await page.evaluate(async()=> (await window.desktopAuthority.list()).find(d=>d.status==='awaiting_confirmation'&&d.type==='schedule.create.v1'));
    const scheduleId=scheduleDraft.payload.record.id;
    await page.context().setOffline(false);
    const beforeSchedule=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert(!beforeSchedule.schedules.some(s=>s.id===scheduleId));
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="'+scheduleDraft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
    await courseDialog.waitFor();
    await courseDialog.evaluate(async el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    await courseDialog.screenshot({path:path.join(out,'12-schedule-confirm.png')});
    await courseDialog.getByRole('button',{name:'确认并发送',exact:true}).click();
    await courseDialog.waitFor({state:'hidden',timeout:45000});
    const scheduleProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const schedule=scheduleProjection.schedules.find(s=>s.id===scheduleId);
    save('schedule-readback',{schedule,scheduleDate});
    assert(schedule); assert.equal(schedule.course_id,courseId);
    assert.equal(schedule.calculated_tuition,270); assert.equal(schedule.calculated_teacher_fee,180);
    assert.equal(schedule.billing_unit,1); assert.equal(schedule.teacher_fee_mode,1);
    assert.equal(schedule.student_pricings?.[0]?.student_id,studentId);
    const calendarCard=page.locator('[data-schedule-id="'+scheduleId+'"]');
    await calendarCard.waitFor();
    assert.match(await calendarCard.innerText(),/初二物理/);
    assert.match(await calendarCard.innerText(),/东湖上课点\s+12:00-13:30/);
    await calendarCard.screenshot({path:path.join(out,'13-calendar-card.png')});
    // UTF-8: reopen persisted schedule through the original calendar, then reschedule offline.
    const reopenCalendar=async()=>{
      await page.reload();
      await page.locator('.app-shell').waitFor({timeout:45000});
      await page.getByText('系统加载中...',{exact:true}).waitFor({state:'hidden',timeout:45000});
      await page.locator('.app-shell__collapse-button').click();
      // UTF-8: reload returns to the home page with the academic submenu collapsed.
      await page.getByRole('menuitem',{name:'calendar 教务',exact:true}).click();
      await page.getByRole('menuitem',{name:'calendar 课程表',exact:true}).click();
      await releaseNavigation();
      await calendarCard.waitFor();
    };
    await reopenCalendar();
    assert.match(await calendarCard.innerText(),/东湖上课点\s+12:00-13:30/);
    await calendarCard.dblclick();
    await courseDialog.waitFor();
    await waitForModalWidth(600);
    assert.equal(await courseDialog.locator('#startTime').inputValue(),'12:00');
    assert.equal(await courseDialog.locator('#endTime').inputValue(),'13:30');
    save('14-reschedule-before-snapshot',await courseDialog.ariaSnapshot());
    await courseDialog.locator('#startTime').fill('14:00');
    await courseDialog.locator('#startTime').press('Enter');
    await selectCourseOption('duration','2小时');
    assert.equal(await courseDialog.locator('#endTime').inputValue(),'16:00');
    // UTF-8: the full backup has an existing 14:00 lesson; retain conflict rejection evidence.
    const outboxBeforeConflict=await page.evaluate(()=>window.desktopAuthority.list());
    await courseDialog.getByRole('button',{name:/^保\s*存$/}).click();
    await page.locator('.ant-message-notice-content').filter({hasText:/时间重叠：.*14:00-15:30/}).waitFor();
    await page.screenshot({path:path.join(out,'14-reschedule-conflict.png'),scale:'css'});
    assert(await courseDialog.isVisible());
    assert.deepEqual(await page.evaluate(()=>window.desktopAuthority.list()),outboxBeforeConflict);
    await courseDialog.locator('#startTime').fill('16:00');
    await courseDialog.locator('#startTime').press('Enter');
    assert.equal(await courseDialog.locator('#endTime').inputValue(),'18:00');
    await courseDialog.screenshot({path:path.join(out,'14-reschedule-form.png')});
    await page.context().setOffline(true);
    await courseDialog.getByRole('button',{name:/^保\s*存$/}).click();
    await courseDialog.waitFor({state:'hidden'});
    await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>
      d.type==='schedule.update.v1'&&d.status==='awaiting_confirmation'&&d.payload.id===id),scheduleId);
    const rescheduleDraft=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>
      d.type==='schedule.update.v1'&&d.status==='awaiting_confirmation'&&d.payload.id===id),scheduleId);
    assert.equal(new Date(rescheduleDraft.payload.expectedVersion).getTime(),new Date(schedule.updated_at).getTime(),
      'rescheduling must retain the cloud version read before editing');
    assert.equal(rescheduleDraft.payload.changes.calculated_tuition,360);
    assert.equal(rescheduleDraft.payload.changes.calculated_teacher_fee,240);
    assert.match(await calendarCard.innerText(),/东湖上课点\s+16:00-18:00/);
    await page.context().setOffline(false);
    const reschedulePending=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert.deepEqual(reschedulePending.schedules.find(s=>s.id===scheduleId),schedule,
      'reconnecting after rescheduling must not change any cloud schedule field');
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="'+rescheduleDraft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
    await courseDialog.waitFor();
    save('15-reschedule-confirm-snapshot',await courseDialog.ariaSnapshot());
    await courseDialog.getByRole('button',{name:'确认并发送',exact:true}).click();
    await courseDialog.waitFor({state:'hidden',timeout:45000});
    await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>d.id===id&&d.status==='completed'),rescheduleDraft.id);
    const movedProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const moved=movedProjection.schedules.find(s=>s.id===scheduleId);
    assert.equal(movedProjection.schedules.filter(s=>s.id===scheduleId).length,1);
    assert.equal(new Date(moved.start_time).getTime(),new Date(scheduleDate+'T16:00:00+08:00').getTime());
    assert.equal(new Date(moved.end_time).getTime(),new Date(scheduleDate+'T18:00:00+08:00').getTime());
    assert.equal(moved.calculated_tuition,360); assert.equal(moved.calculated_teacher_fee,240);
    for(const key of ['course_id','room','student_ids','student_pricings','teacher_id','billing_unit','teacher_fee_mode','status'])
      assert.deepEqual(moved[key],schedule[key],'rescheduling must preserve '+key);
    assert.notEqual(moved.updated_at,schedule.updated_at);
    save('reschedule-readback',{before:schedule,after:moved,expectedVersion:rescheduleDraft.payload.expectedVersion});
    await reopenCalendar();
    assert.match(await calendarCard.innerText(),/东湖上课点\s+16:00-18:00/);
    await calendarCard.screenshot({path:path.join(out,'16-reschedule-reloaded-card.png')});
    await calendarCard.dblclick();
    await courseDialog.waitFor();
    await waitForModalWidth(600);
    assert.equal(await courseDialog.locator('#startTime').inputValue(),'16:00');
    assert.equal(await courseDialog.locator('#endTime').inputValue(),'18:00');
    await courseDialog.getByText('东湖上课点',{exact:true}).waitFor();
    await courseDialog.screenshot({path:path.join(out,'16-reschedule-reopened.png')});
    await courseDialog.getByRole('button',{name:/^取\s*消$/}).click();
    await courseDialog.waitFor({state:'hidden'});
    // UTF-8: exercise native pointer gestures and original undo/redo controls, not React handlers.
    const targetDay=page.locator('[data-date]').nth(1);
    const targetDate=await targetDay.getAttribute('data-date');
    await calendarCard.scrollIntoViewIfNeeded();
    const sourceBox=await calendarCard.boundingBox();
    const targetBox=await targetDay.locator('[data-day-body="true"]').boundingBox();
    assert.equal(await targetDay.locator('[data-day-body="true"]').getAttribute('data-min-start-slot'),
      await calendarCard.locator('xpath=..').getAttribute('data-min-start-slot'));
    const dragEnd={x:targetBox.x+targetBox.width/2,y:sourceBox.y+sourceBox.height/2};
    save('17-pointer-geometry',{sourceBox,targetBox,targetDate,dragEnd});
    await page.context().setOffline(true);
    await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x,dragEnd.y,{steps:15});
    await page.mouse.up();
    await targetDay.locator('[data-schedule-id="'+scheduleId+'"]').waitFor();
    const waitDraftTimes=async(start,end,tuition)=>{
      // UTF-8: assert the exact saved snapshot, not a transient poll followed by a different read.
      const deadline=Date.now()+12000;
      let stableSince=null,last;
      while(Date.now()<deadline) {
        last=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.payload.id===id&&d.type==='schedule.update.v1'&&d.status==='awaiting_confirmation'),scheduleId);
        const matches=last&&new Date(last.payload.changes.start_time).getTime()===new Date(start).getTime()
          &&new Date(last.payload.changes.end_time).getTime()===new Date(end).getTime()
          &&last.payload.changes.calculated_tuition===tuition;
        if(matches) { if(stableSince===null) stableSince=Date.now(); }
        else stableSince=null;
        if(stableSince!==null&&Date.now()-stableSince>=600) return last;
        await page.waitForTimeout(75);
      }
      save('unstable-history-draft',{expected:{start,end,tuition},last});
      throw new Error('SCHEDULE_DRAFT_DID_NOT_STABILIZE');
    };
    const dragStart=targetDate+'T16:00:00+08:00';
    const dragEndTime=targetDate+'T18:00:00+08:00';
    const resizeEnd=targetDate+'T18:30:00+08:00';
    await waitDraftTimes(dragStart,dragEndTime,360);
    await calendarCard.screenshot({path:path.join(out,'17-dragged-card.png')});
    const beforeResize=await calendarCard.boundingBox();
    const resizePixels=beforeResize.height/120*30;
    await page.mouse.move(beforeResize.x+beforeResize.width/2,beforeResize.y+beforeResize.height-2);
    await page.mouse.down();
    await page.mouse.move(beforeResize.x+beforeResize.width/2,beforeResize.y+beforeResize.height-2+resizePixels,{steps:10});
    await page.mouse.up();
    const resizedDraft=await waitDraftTimes(dragStart,resizeEnd,450);
    assert.equal(resizedDraft.payload.changes.calculated_teacher_fee,300);
    await calendarCard.screenshot({path:path.join(out,'18-resized-card.png')});
    // UTF-8: keyboard undo must work without another pointer event triggering persistence.
    await page.keyboard.press('Control+z');
    const undoneDraft=await waitDraftTimes(dragStart,dragEndTime,360);
    assert.match(await calendarCard.innerText(),/16:00-18:00/);
    save('19-undone-draft',{draft:undoneDraft,targetDate});
    await page.getByRole('button',{name:/^重\s*做$/}).click();
    const redoneDraft=await waitDraftTimes(dragStart,resizeEnd,450);
    assert.equal(new Date(redoneDraft.payload.expectedVersion).getTime(),new Date(moved.updated_at).getTime());
    save('19-history-draft',{draft:redoneDraft,targetDate});
    await calendarCard.screenshot({path:path.join(out,'19-redone-card.png')});
    await page.context().setOffline(false);
    const beforeDragConfirm=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert.deepEqual(beforeDragConfirm.schedules.find(s=>s.id===scheduleId),moved);
    await page.locator('.sync-status-trigger').click();
    await page.locator('[data-row-key="'+redoneDraft.id+'"]').getByRole('button',{name:'查看并确认',exact:true}).click();
    await courseDialog.getByRole('button',{name:'确认并发送',exact:true}).click();
    await courseDialog.waitFor({state:'hidden',timeout:45000});
    await page.waitForFunction(async id=>(await window.desktopAuthority.list()).some(d=>d.id===id&&d.status==='completed'),redoneDraft.id);
    const gestureProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const gestured=gestureProjection.schedules.find(s=>s.id===scheduleId);
    assert.equal(new Date(gestured.start_time).getTime(),new Date(dragStart).getTime());
    assert.equal(new Date(gestured.end_time).getTime(),new Date(resizeEnd).getTime());
    assert.equal(gestured.calculated_tuition,450);assert.equal(gestured.calculated_teacher_fee,300);
    for(const key of ['student_pricings','course_id','room','teacher_id','billing_unit','teacher_fee_mode']) assert.deepEqual(gestured[key],moved[key]);
    save('gesture-readback',{before:moved,after:gestured});
    await reopenCalendar();
    await targetDay.locator('[data-schedule-id="'+scheduleId+'"]').waitFor();
    assert.match(await calendarCard.innerText(),/16:00-18:30/);
    await calendarCard.screenshot({path:path.join(out,'20-gestures-reloaded-card.png')});
    // UTF-8: use the original rectangle and Ctrl-drag, with no direct state mutations.
    const selectRectangle=async(firstId,lastId,count,artifact)=>{
      const first=page.locator('[data-schedule-id="'+firstId+'"]');
      const last=page.locator('[data-schedule-id="'+lastId+'"]');
      await first.scrollIntoViewIfNeeded();
      const a=await first.boundingBox(),b=await last.boundingBox();
      const body=await first.locator('xpath=..').boundingBox();
      const start={x:body.x+1,y:a.y+2};
      const end={x:b.x+b.width/2,y:b.y+b.height-2};
      save(artifact+'-geometry',{a,b,body,start,end});
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      await page.mouse.move(end.x,end.y,{steps:18});await page.mouse.up();
      await page.getByText('已选 '+count+' 节 · 拖拽移动 · Ctrl 拖拽复制 · 右键更多',{exact:true}).waitFor();
      await page.screenshot({path:path.join(out,artifact+'.png'),scale:'css'});
    };
    const dragRectangle=async(fromId,toDayIndex,copy)=>{
      const box=await page.locator('[data-schedule-id="'+fromId+'"]').boundingBox();
      const destination=await page.locator('[data-date]').nth(toDayIndex).locator('[data-day-body="true"]').boundingBox();
      if(copy) await page.keyboard.down('Control');
      try {
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
        await page.mouse.move(destination.x+destination.width/2,box.y+box.height/2,{steps:18});
        await page.mouse.up();
      } finally {if(copy)await page.keyboard.up('Control');}
    };
    const waitBatchDraft=async(id,type,date)=>{
      let last,stableSince=null;const deadline=Date.now()+12000;
      while(Date.now()<deadline){
        last=await page.evaluate(async({id,type,courseId})=>(await window.desktopAuthority.list()).find(d=>
          d.type===type&&d.status==='awaiting_confirmation'&&(id?d.payload.id===id:d.payload.record?.course_id===courseId)),{id,type,courseId});
        const record=last&&(last.payload.record||last.payload.changes);
        const matches=record&&new Date(record.start_time).getTime()===new Date(date+'T16:00:00+08:00').getTime()
          &&new Date(record.end_time).getTime()===new Date(date+'T18:30:00+08:00').getTime()
          &&record.calculated_tuition===450&&record.calculated_teacher_fee===300;
        if(matches){if(stableSince===null)stableSince=Date.now();}else stableSince=null;
        if(stableSince!==null&&Date.now()-stableSince>=600)return last;
        await page.waitForTimeout(75);
      }
      save('unstable-batch-draft',{id,type,date,last});throw new Error('BATCH_DRAFT_DID_NOT_STABILIZE');
    };
    const confirmVisibleDraft=async draft=>{
      // UTF-8: open once per confirmation; do not toggle again during the opening animation.
      const confirm=page.locator('[data-row-key="'+draft.id+'"]').getByRole('button',{name:'查看并确认',exact:true});
      await page.locator('.sync-quick-popover:visible').waitFor({state:'hidden'});
      await page.locator('.sync-status-trigger').click();
      await confirm.click();
      await courseDialog.getByRole('button',{name:'确认并发送',exact:true}).click();
      await courseDialog.waitFor({state:'hidden',timeout:45000});
      const completed=await page.evaluate(async id=>(await window.desktopAuthority.list()).find(d=>d.id===id),draft.id);
      assert.equal(completed.status,'completed');
      await page.locator('.sync-quick-popover:visible').waitFor({state:'hidden'});
    };
    const copyDate=await page.locator('[data-date]').nth(2).getAttribute('data-date');
    await page.context().setOffline(true);
    await selectRectangle(scheduleId,scheduleId,1,'21-batch-selected-one');
    await dragRectangle(scheduleId,2,true);
    const copyDraft=await waitBatchDraft(null,'schedule.create.v1',copyDate);
    const copyId=copyDraft.payload.record.id;assert.notEqual(copyId,scheduleId);
    save('22-batch-copy-draft',copyDraft);
    await page.context().setOffline(false);
    const copyPending=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert.deepEqual(copyPending.schedules,gestureProjection.schedules,'copy must await explicit confirmation');
    await confirmVisibleDraft(copyDraft);
    const copiedProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const copiedSchedule=copiedProjection.schedules.find(s=>s.id===copyId);assert(copiedSchedule);
    assert.deepEqual(copiedProjection.schedules.find(s=>s.id===scheduleId),gestured,'copy must not rewrite its source');
    const stableFields=['course_id','student_ids','student_pricings','teacher_id','room','billing_unit','teacher_fee_mode','status','calculated_tuition','calculated_teacher_fee'];
    for(const key of stableFields)assert.deepEqual(copiedSchedule[key],gestured[key],'copy must preserve '+key);
    assert.equal(new Date(copiedSchedule.start_time).getTime(),new Date(copyDate+'T16:00:00+08:00').getTime());
    assert.equal(new Date(copiedSchedule.end_time).getTime(),new Date(copyDate+'T18:30:00+08:00').getTime());
    await reopenCalendar();
    await page.locator('[data-schedule-id="'+copyId+'"]').waitFor();
    await page.context().setOffline(true);
    await selectRectangle(scheduleId,copyId,2,'23-batch-selected-two');
    await dragRectangle(scheduleId,3,false);
    const batchDates=await page.locator('[data-date]').evaluateAll(els=>els.map(el=>el.getAttribute('data-date')));
    const batchDrafts=[await waitBatchDraft(scheduleId,'schedule.update.v1',batchDates[3]),await waitBatchDraft(copyId,'schedule.update.v1',batchDates[4])];
    const batchBefore=[gestured,copiedSchedule];
    batchDrafts.forEach((draft,i)=>assert.equal(new Date(draft.payload.expectedVersion).getTime(),new Date(batchBefore[i].updated_at).getTime()));
    save('24-batch-move-drafts',batchDrafts);
    await page.context().setOffline(false);
    const batchPending=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    assert.deepEqual(batchPending.schedules,copiedProjection.schedules,'batch moving must not submit on reconnect');
    for(const draft of batchDrafts)await confirmVisibleDraft(draft);
    const batchProjection=await page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
    const batchAfter=[scheduleId,copyId].map(id=>batchProjection.schedules.find(s=>s.id===id));
    for(const [i,after] of batchAfter.entries()){
      assert(after);for(const key of stableFields)assert.deepEqual(after[key],batchBefore[i][key]);
      assert.equal(new Date(after.start_time).getTime(),new Date(batchDates[i+3]+'T16:00:00+08:00').getTime());
      assert.equal(new Date(after.end_time).getTime(),new Date(batchDates[i+3]+'T18:30:00+08:00').getTime());
    }
    assert.deepEqual(batchProjection.schedules.filter(s=>![scheduleId,copyId].includes(s.id)),
      copiedProjection.schedules.filter(s=>![scheduleId,copyId].includes(s.id)),'unselected schedules must remain untouched');
    save('batch-readback',{source:gestured,copy:copiedSchedule,before:batchBefore,after:batchAfter});
    await reopenCalendar();
    for(const [i,id] of [scheduleId,copyId].entries()){
      const card=page.locator('[data-date]').nth(i+3).locator('[data-schedule-id="'+id+'"]');
      await card.waitFor();assert.match(await card.innerText(),/初二物理[\s\S]*东湖上课点\s+16:00-18:30/);
      await card.screenshot({path:path.join(out,'25-batch-reloaded-'+i+'.png')});
    }
    const multiStudentBatch=await require('./business-parity-multistudent.cjs')({page,out,save,releaseNavigation,waitForModalWidth,
      selectCourseOption,confirmVisibleDraft,reopenCalendar,studentId,
      teacherName:projection.teachers.find(t=>t.id===config.login.teacherId).name});
    // UTF-8: verify every restored resource editor at both desktop widths, without saving.
    const editorChecks=[];
    const outboxBeforeEditors=await page.evaluate(()=>window.desktopAuthority.list());
    for(const width of [1280,1200]) {
      await app.evaluate(({BrowserWindow},size)=>{
        const win=BrowserWindow.getAllWindows()[0];
        // UTF-8: a maximized native window ignores setContentSize on Windows.
        if(win.isMaximized()) win.unmaximize();
        win.setContentSize(size,800);
      },width);
      await page.waitForFunction(expected=>innerWidth===expected,width);
      for(const [group,item,button,expectedWidth] of [
        ['team 资源','user 学生','plus 添加学生',700],
        ['team 资源','team 老师','plus 添加老师',600],
        ['team 资源','bank 学校','plus 添加学校',520],
        ['team 资源','home 上课地址','plus 添加地址',520],
        ['team 资源','team 机构','plus 添加机构',600],
        ['dollar 财务','dollar 缴费','plus 添加缴费记录',600],
      ]) {
        const beforeNav=await page.locator('.app-shell__main').boundingBox();
        await page.locator('.app-shell__collapse-button').click();
        assert.deepEqual(await page.locator('.app-shell__main').boundingBox(),beforeNav);
        const groupItem=page.getByRole('menuitem',{name:group,exact:true});
        if(await groupItem.getAttribute('aria-expanded')!=='true') await groupItem.click();
        await page.getByRole('menuitem',{name:item,exact:true}).click();
        await releaseNavigation();
        await page.getByRole('button',{name:button,exact:true}).click();
        const editor=page.getByRole('dialog');
        await editor.locator('.ant-modal-content').waitFor();
        await waitForModalWidth(expectedWidth);
        const box=await editor.boundingBox();
        const viewport=await page.locator('.ant-modal-wrap:visible').evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
        assert.equal(Math.round(box.width),expectedWidth);
        assert(Math.abs(box.x-(viewport.width-box.width)/2)<2);
        assert.equal(await page.locator('.ant-drawer:visible').count(),0);
        const artifact='modal-'+width+'-'+item.split(' ')[1];
        await page.screenshot({path:path.join(out,artifact+'-top.png'),scale:'css'});
        const cancel=editor.getByRole('button',{name:/^取\s*消$/});
        await cancel.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(out,artifact+'-footer.png'),scale:'css'});
        await cancel.click();
        await editor.waitFor({state:'hidden'});
        editorChecks.push({item,width,box,viewport,cancelled:true});
      }
    }
    assert.deepEqual(await page.evaluate(()=>window.desktopAuthority.list()),outboxBeforeEditors,'opening and cancelling resource editors must not create or submit drafts');
    save('resource-modal-checks',editorChecks);
    save('desktop-receipt',{passwordLogin:true,sourceDesktop:true,installed:false,productionWrite:false,
      originalWorkspaceLoaded:true,teacherProjectionRead:true,studentDraftConfirmed:true,schoolAtomic:true,
      noSilentReconnectWrite:true,studentReloadVisible:true,courseAndAddressConfirmed:true,
      courseReopened:true,scheduleConfirmed:true,scheduleFinancialReadback:true,
      rescheduleConfirmed:true,rescheduleNoSilentWrite:true,rescheduleVersionBaseline:true,
      rescheduleFinancialReadback:true,rescheduleReloaded:true,rescheduleConflictRejected:true,
      crossDayDrag:true,bottomResize:true,undoRedoDrafts:true,gestureCloudReadback:true,gestureReloaded:true,
      rectangleCopy:true,twoScheduleBatchMove:true,batchFeeSnapshots:true,batchNoSilentWrite:true,batchReloaded:true,...multiStudentBatch,
      studentOriginalModal:true,navigationDoesNotResize:true,resourceModalChecks:editorChecks.length,businessFlowComplete:false});
    console.log(JSON.stringify({stage:'original_desktop_student_course_verified',out}));
  } catch(error) {
    if(page) {
      await page.getByPlaceholder('输入密码',{exact:true}).fill('').catch(()=>{});
      await page.screenshot({path:path.join(out,'failure.png'),scale:'css'}).catch(()=>{});
      save('failure', {error:String(error),stack:error.stack,snapshot:await page.locator('body').ariaSnapshot().catch(()=> '')});
      save('failure-draft-state',await page.evaluate(async()=>window.desktopAuthority?.list()).catch(()=>null));
    }
    throw error;
  } finally { await app.close(); }
}
main().catch(error => {console.error(String(error)); process.exitCode=1;});
