'use strict';
// UTF-8: Exercise actual teaching-page handlers while preserving business rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const dates = require('./cloudBusinessProjection');
const { canOpenMiniappRoute } = require('./miniappRouteAccess');
const accountExperience = require('./accountExperience');
const { createAuthSessionRuntime } = require('./miniappApiSessionRuntime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const byClass = (tree, name) => nodes(tree).filter(n => (n.props.className || '').split(' ').includes(name));
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const find = (h, type) => nodes(h.render()).find(n => n.type === type);
const fixtures = {
  courses: [{ id:'course', name:'Internal', display_name:'Original Course', type:1, active:true, billing_unit:1, price_tuition:180, price_teacher:120, student_pricings:[{student_id:'student'}] }, { id:'finished', name:'Completed Course', type:2, active:false }],
  schedules: [{ id:'lesson', course_id:'course', course_name:'Retained Course', course_type:2, student_ids:['student'], room:'Original Address', status:1, start_time:dates.shanghaiDateKey(new Date())+'T10:00:00+08:00', end_time:dates.shanghaiDateKey(new Date())+'T11:30:00+08:00', calculated_tuition:180, calculated_teacher_fee:120 }],
  students: [{id:'student',name:'Alice',school:'["School One"]',grade_current:'Grade One'}],
};
function harness(page, role='teacher') {
  const state=[], effects=[]; let cursor=0;
  const modules=['teacher','super_admin'].includes(role)?['courses','scheduling']:['scheduling'];
  const h={role,allowed:canOpenMiniappRoute('/pages/'+page+'/index',{role,modules}),epoch:1,pulls:0,reads:[],stops:0,routes:[],cache:structuredClone(fixtures),result:async()=>true,id:'lesson'};
  const slot=initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return i;};
  const identity=()=>({id:'account-'+h.epoch,role:h.role,user_type:h.role,account_state:h.role==='visitor'?'visitor':'formal',token_use:h.role==='visitor'?'miniapp-visitor':'miniapp-cloud',...(h.role==='visitor'?{identity_kind:'visitor',authority_id:'test-authority',capabilities:[...accountExperience.VISITOR_CAPABILITIES]}:{})});
  const sessionRuntime=createAuthSessionRuntime({readToken:()=> 'fixture',readIdentity:identity,readGeneration:()=>h.epoch,writeGeneration:value=>{h.epoch=value;}});
  const jsx=(type,props)=>({type,props:props||{}});
  const localData=key=>{h.reads.push(key);return h.cache[key]||[];};
  const shared={
    types:{ScheduleStatus:{PLANNED:1,COMPLETED:2,CANCELLED:3,LEAVE:4}},
    'utils/sync':{getLocalData:localData,getLocalItem:(key,id)=>localData(key).find(row=>row.id===id),pullFromCloudBusinessProjection:async()=>{h.pulls++;return h.result();}},
    'utils/storage':{getCachedList:localData},
    'utils/permission':{isStudentScopedUser:()=>['student','family_member'].includes(h.role)},
    'utils/accountExperience':accountExperience,
    'utils/miniappPageAccess':{canAccessMiniappPage:()=>h.allowed,refreshMiniappPageAccess:async()=>h.allowed},
    'utils/authSession':{authSessionRuntime:sessionRuntime},
    'utils/studentDisplay':{studentSchoolLabel:value=>value?.startsWith('[')?JSON.parse(value).join(', '):value,studentGradeLabel:student=>student.grade_current||''},
    'utils/cloudBusinessProjection':dates,
    'components/shared':{NetworkStatus:'NetworkStatus',EmptyState:'EmptyState',LoadingSkeleton:'LoadingSkeleton'},
    'components/ForbiddenContent':{default:'Forbidden'},
  };
  const deps={
    react:{useState:initial=>{const i=slot(initial);return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:fn=>{slot(null);if(!h.mounted)effects.push(fn);}},
    'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':{View:'View',Text:'Text',ScrollView:'ScrollView'},
    '@tarojs/taro':{default:{getStorageSync:()=>identity(),stopPullDownRefresh:()=>{h.stops++;},navigateTo:o=>h.routes.push(o.url)},useDidShow:fn=>{h.show=fn;},useDidHide:fn=>{h.hide=fn;},usePullDownRefresh:fn=>{h.pull=fn;},useRouter:()=>({params:{id:h.id}})},
  };
  const source=fs.readFileSync(path.join(__dirname,'../pages',page,'index.tsx'),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',output)(name=>{if(name.endsWith('.scss'))return {};if(Object.hasOwn(deps,name))return deps[name];const key=name.replace(/^(\.\.\/)+/,'');assert.ok(Object.hasOwn(shared,key),name);return shared[key];},module,module.exports);
  h.render=()=>{cursor=0;return module.exports.default();};
  h.mount=()=>{const tree=h.render();h.mounted=true;h.cleanups=effects.map(fn=>fn());return tree;};
  h.refresh=async()=>{await h.show?.();await tick();};
  return h;
}
(async()=>{
  for(const page of ['schedule/detail','courses','schedule']) {
    const h=harness(page); const initial=h.mount();
    assert.equal(nodes(initial).filter(n=>n.type==='LoadingSkeleton').length,1,page+': loading must not claim record missing');
    await h.refresh();
    assert.ok(text(h.render()).includes('Original Course'),page);
    const pristine=JSON.stringify(h.cache);
    h.result=async()=>false;await h.pull();await tick();
    assert.equal(byClass(h.render(),'teaching-cache-notice').length,1,page+': cached failure must be visible');
    assert.ok(text(h.render()).includes('Original Course'));
    h.cache={courses:[],schedules:[],students:[]};await h.pull();await tick();
    const failed=find(h,'EmptyState');assert.equal(failed?.props.actionText,'重试',page+': failed uncached read is not empty business data');
    h.result=async()=>true;await failed.props.onAction();await tick();
    assert.equal(find(h,'EmptyState')?.props.actionText,undefined,page+': actual empty state');
    h.cache=structuredClone(fixtures);await h.pull();await tick();
    assert.equal(JSON.stringify(h.cache),pristine,page+': cache is read-only');
    h.hide();h.cache.courses[0].display_name='Updated Course';await h.refresh();
    assert.ok(text(h.render()).includes('Updated Course'),page+': return refresh');
    h.epoch++;assert.ok(!text(h.render()).includes('Updated Course'),page+': old rows cannot cross accounts');
    for(const reason of ['hide','unmount','account','permission']) {
      const stale=harness(page);stale.mount();await stale.refresh();let finish;
      stale.result=()=>new Promise(resolve=>{finish=resolve;});const pending=stale.show();await tick();
      if(reason==='hide')stale.hide();else if(reason==='unmount')stale.cleanups.forEach(fn=>fn?.());else if(reason==='account')stale.epoch++;else stale.allowed=false;
      const reads=stale.reads.length;finish(true);await pending;await tick();assert.equal(stale.reads.length,reads,page+': stale '+reason+' cannot load cache');
    }
    const denied=harness(page);denied.allowed=false;denied.mount();await denied.refresh();
    assert.equal(denied.pulls,0,page+': denied before fetch');assert.equal(denied.reads.length,0);assert.ok(find(denied,'Forbidden'));
  }
  const detail=harness('schedule/detail');detail.cache.courses=[];detail.mount();await detail.refresh();
  assert.ok(text(detail.render()).includes('Retained Course'),'history retains original label when course leaves selector');
  assert.ok(!text(detail.render()).includes('["School One"]'),'school uses existing readable label');
  byClass(detail.render(),'sd-student-row')[0].props.onClick();assert.deepEqual(detail.routes,['/pages/student-detail/index?id=student']);
  detail.cache.schedules=[];await detail.pull();await tick();assert.equal(byClass(detail.render(),'sd-course-name').length,0,'removed record clears old detail');
  const missing=harness('schedule/detail');missing.id='';missing.mount();await missing.refresh();assert.equal(missing.pulls,0,'missing id should not fetch the projection');assert.ok(find(missing,'EmptyState'));
  for(const role of ['student','family_member']) {
    const h=harness('schedule/detail',role);h.mount();await h.refresh();assert.ok(!text(h.render()).includes('教师费'));
    const courses=harness('courses',role);courses.mount();await courses.refresh();
    assert.ok(find(courses,'Forbidden'));assert.equal(courses.pulls,0);assert.equal(courses.reads.length,0,'existing student/family course-list boundary');
  }
  const courses=harness('courses');courses.mount();await courses.refresh();
  assert.equal(byClass(courses.render(),'course-card').length,2);byClass(courses.render(),'filter-tag')[2].props.onClick();assert.equal(byClass(courses.render(),'course-card').length,1);
  byClass(courses.render(),'filter-tag')[0].props.onClick();assert.equal(byClass(courses.render(),'course-card').length,2);
  // UTF-8: 课程资料不是 tab 页面；筛选变高后列表仍须适配剩余高度。
  const courseCss=fs.readFileSync(path.join(__dirname,'../pages/courses/index.scss'),'utf8');
  const courseRule=selector=>courseCss.match(new RegExp('\\.'+selector+'\\s*\\{([^}]+)\\}'))[1];
  assert.match(courseRule('filter-tag'),/min-height:\s*44px/,'course filters need usable touch targets');
  assert.match(courseRule('filter-tag'),/min-width:\s*44px/);
  assert.match(courseRule('filter-tag'),/box-sizing:\s*border-box/,'minimum touch width includes padding, avoiding needless horizontal overflow');
  assert.match(courseRule('courses-page'),/(?:^|[;\s])height:\s*100vh/);
  assert.match(courseRule('courses-page'),/display:\s*flex/);
  assert.match(courseRule('courses-page'),/flex-direction:\s*column/);
  assert.match(courseRule('courses-page'),/box-sizing:\s*border-box/);
  assert.match(courseRule('courses-page'),/padding-bottom:\s*env\(safe-area-inset-bottom\)/,'non-tab route reserves safe area only');
  assert.match(courseRule('filter-bar'),/flex-shrink:\s*0/);
  assert.match(courseRule('course-scroll'),/flex:\s*1/);
  assert.match(courseRule('course-scroll'),/height:\s*0/);
  assert.match(courseRule('course-scroll'),/min-height:\s*0/);
  const visitor=harness('schedule','visitor');visitor.mount();await visitor.refresh();assert.equal(visitor.pulls,0);assert.equal(visitor.reads.length,0);
  find(visitor,'EmptyState').props.onAction();assert.deepEqual(visitor.routes,['/pages/account-application/index']);
  const visitorDetail=harness('schedule/detail','visitor');visitorDetail.mount();await visitorDetail.refresh();
  assert.equal(visitorDetail.pulls,0,'visitor detail cannot request a forbidden business projection');
  assert.equal(visitorDetail.reads.length,0);assert.ok(find(visitorDetail,'Forbidden'),'visitor detail must explain the role boundary, not suggest a network retry');
  // UTF-8: Exercise the real day/week/date/filter handlers for every formal role.
  for(const role of ['teacher','super_admin','student','family_member']) {
    const h=harness('schedule',role),today=dates.shanghaiDateKey(new Date()),tomorrow=dates.shiftShanghaiDateKey(today,1);
    h.cache.schedules.push({...h.cache.schedules[0],id:'tomorrow',start_time:tomorrow+'T12:00:00+08:00'});
    h.mount();await h.refresh();byClass(h.render(),'toggle-btn')[1].props.onClick();
    assert.equal(byClass(h.render(),'day-view').length,1);
    assert.equal(byClass(h.render(),'schedule-card').length,1,'day only includes its own lessons');
    assert.ok(text(byClass(h.render(),'schedule-card')[0]).includes('Original Course'));
    assert.ok(text(byClass(h.render(),'schedule-card')[0]).includes('Original Address'));
    assert.equal(byClass(h.render(),'filter-bar').length,['teacher','super_admin'].includes(role)?1:0);
    byClass(h.render(),'schedule-card')[0].props.onClick();assert.deepEqual(h.routes,['/pages/schedule/detail/index?id=lesson']);
    const title=text(byClass(h.render(),'day-title-text')[0]);
    byClass(h.render(),'nav-arrow')[1].props.onClick();assert.notEqual(text(byClass(h.render(),'day-title-text')[0]),title);
    byClass(h.render(),'schedule-card')[0].props.onClick();assert.equal(h.routes.at(-1),'/pages/schedule/detail/index?id=tomorrow');
    h.hide();await h.refresh();assert.notEqual(text(byClass(h.render(),'day-title-text')[0]),title,'detail return must retain selected day');
    await h.pull();await tick();assert.equal(byClass(h.render(),'day-view').length,1,'native pull retains day mode');
    byClass(h.render(),'nav-arrow')[1].props.onClick();assert.equal(find(h,'EmptyState').props.text,'当天没有课程');
    byClass(h.render(),'nav-today')[0].props.onClick();assert.equal(text(byClass(h.render(),'day-title-text')[0]),title);
    byClass(h.render(),'toggle-btn')[0].props.onClick();assert.equal(byClass(h.render(),'week-view').length,1);
    byClass(h.render(),'nav-arrow')[1].props.onClick();byClass(h.render(),'toggle-btn')[1].props.onClick();
    const shifted=dates.shanghaiDateParts(dates.shiftShanghaiDateKey(today,7));
    assert.ok(text(byClass(h.render(),'day-title-text')[0]).startsWith(shifted.month+'月'+shifted.day+'日'));
  }
  const calendar=harness('schedule');calendar.mount();await calendar.refresh();byClass(calendar.render(),'toggle-btn')[1].props.onClick();
  const dateKey=dates.shanghaiDateKey(new Date()),year=Number(dateKey.slice(0,4)),last=year+'-12-31';
  const steps=Math.round((Date.parse(last+'T00:00:00Z')-Date.parse(dateKey+'T00:00:00Z'))/86400000);
  for(let i=0;i<steps;i++)byClass(calendar.render(),'nav-arrow')[1].props.onClick();
  assert.ok(text(byClass(calendar.render(),'day-title-text')[0]).startsWith('12月31日'));
  byClass(calendar.render(),'nav-arrow')[1].props.onClick();assert.ok(text(byClass(calendar.render(),'day-title-text')[0]).startsWith('1月1日'));
  byClass(calendar.render(),'nav-arrow')[0].props.onClick();assert.ok(text(byClass(calendar.render(),'day-title-text')[0]).startsWith('12月31日'));
  const switched=harness('schedule');switched.mount();await switched.refresh();
  switched.role='visitor';switched.epoch++;switched.allowed=false;
  const priorPulls=switched.pulls,priorReads=switched.reads.length;await switched.refresh();
  assert.equal(switched.pulls,priorPulls);assert.equal(switched.reads.length,priorReads);
  assert.equal(byClass(switched.render(),'schedule-card').length,0,'mounted teacher tab clears cards when opened by a visitor');
  assert.equal(find(switched,'EmptyState').props.actionText,'申请角色');
  for(const page of ['courses','schedule','schedule/detail']) assert.match(fs.readFileSync(path.join(__dirname,'../pages',page,'index.config.ts'),'utf8'),/enablePullDownRefresh:\s*true/,page+': native empty-state refresh');
  // UTF-8: 最后一张课程卡片必须能滚到固定底部导航的上方。
  const scheduleCss=fs.readFileSync(path.join(__dirname,'../pages/schedule/index.scss'),'utf8');
  const pageCss=scheduleCss.match(/\.schedule-page\s*\{([^}]+)\}/)[1];
  const scrollCss=scheduleCss.match(/\.day-view,\s*\.week-view\s*\{([^}]+)\}/)[1];
  assert.match(pageCss,/(?:^|[;\s])height:\s*100vh/,'schedule viewport must be bounded');
  assert.match(pageCss,/display:\s*flex/);assert.match(pageCss,/flex-direction:\s*column/);
  assert.match(pageCss,/padding-bottom:\s*calc\(148rpx \+ env\(safe-area-inset-bottom\)\)/,'retain tab and safe-area clearance');
  assert.match(scrollCss,/flex:\s*1/);assert.match(scrollCss,/height:\s*0/);assert.match(scrollCss,/min-height:\s*0/);
  // UTF-8: Date, mode and student controls need usable phone touch targets.
  for(const selector of ['toggle-btn','filter-tag','nav-arrow','nav-today']) {
    const css=scheduleCss.match(new RegExp('\\.'+selector+'\\s*\\{([^}]+)\\}'))[1];
    assert.match(css,/min-height:\s*44px/,selector+': at least 44px high');
    if(selector.startsWith('nav-'))assert.match(css,/min-width:\s*44px/,selector+': at least 44px wide');
  }
  console.log('teaching pages load/failure/cache/return/role/session/history and action tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
