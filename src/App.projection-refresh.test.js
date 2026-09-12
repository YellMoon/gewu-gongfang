'use strict';
// UTF-8: run actual App reconciliation, with a stateful page probe instead of business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('typescript'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(__dirname,'App.tsx'),'utf8');
assert.match(fs.readFileSync(path.join(__dirname,'components/DesktopIdentityGate.tsx'),'utf8'),/<BusinessApp key=\{gateState\.partitionKey\}/,'account/role partitions must keep their existing application boundary');
const compile=text=>ts.transpileModule(text,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;

async function checkMountedCalendar() {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();page.setDefaultTimeout(8000);
    await page.route('**/*',route=>route.abort());await page.setContent('<div id="root"></div>');
    for(const file of ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js'])await page.addScriptTag({path:path.join(root,'node_modules',file)});
    await page.evaluate(code=>{
      const R=window.React,element=R.createElement;
      window.mounts={calendar:0,student:0,course:0};window.unmounts={calendar:0,student:0,course:0};
      const stateful=name=>function Probe(){
        const [history,setHistory]=R.useState(0);
        R.useEffect(()=>{window.mounts[name]++;return()=>{window.unmounts[name]++;};},[]);
        return element('button',{id:name,onClick:()=>setHistory(n=>n+1)},String(history));
      };
      const Calendar=stateful('calendar'),Student=stateful('student'),Course=stateful('course');
      const shell=({children,onNavigate,onRefresh})=>element('main',null,
        element('button',{id:'calendar-nav',onClick:()=>onNavigate('course-calendar')},'calendar'),
        element('button',{id:'student-nav',onClick:()=>onNavigate('student')},'student'),
        element('button',{id:'course-nav',onClick:()=>onNavigate('course-info')},'course'),
        element('button',{id:'manual-refresh',onClick:onRefresh},'refresh'),children);
      const modules={react:R,antd:{},'@ant-design/icons':{},
        './layout/AppShell':{default:shell,__esModule:true},
        './pages/ScheduleCalendar':{default:Calendar,__esModule:true},
        './pages/StudentList':{default:Student,__esModule:true},
        './pages/CourseList':{default:Course,__esModule:true},
        './components/ErrorBoundary':{default:({children})=>children,__esModule:true},
        './navigation/appNavigation':{questionBankPages:[]},
        './navigation/navigationContext':{normalizeNavigationTarget:input=>typeof input==='string'?{page:input}:input},
        './components/question-editor/questionEditorSession':{requestEditorSpaNavigation:callback=>callback()},
        './services/browserDatabase':{default:{refreshAuthorityProjection:async()=>{}},__esModule:true}};
      const exported={};
      new Function('require','exports',code)(name=>{
        if(modules[name])return modules[name];
        if(name.startsWith('./pages/')||name==='./components/QuestionBasket')return{default:()=>null,__esModule:true};
        throw Error('Unexpected App dependency '+name);
      },exported);
      const appRoot=ReactDOM.createRoot(document.getElementById('root'));
      appRoot.render(element(exported.default,{key:1}));
      window.changeAppPartition=()=>appRoot.render(element(exported.default,{key:2}));
    },compile(source));
    await page.locator('#calendar-nav').click();await page.locator('#calendar').waitFor();
    await page.locator('#calendar').click();assert.equal(await page.locator('#calendar').innerText(),'1');
    for(let n=0;n<3;n++) {
      await page.evaluate(()=>window.dispatchEvent(new Event('authority-projection-refreshed')));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#calendar').innerText(),'1','projection refresh must not discard mounted calendar history');
    }
    assert.deepEqual(await page.evaluate(()=>[mounts.calendar,unmounts.calendar]),[1,0]);
    await page.locator('#manual-refresh').click();assert.equal(await page.locator('#calendar').innerText(),'0');
    await page.waitForFunction(()=>mounts.calendar===2&&unmounts.calendar===1);
    await page.locator('#student-nav').click();await page.locator('#student').click();
    await page.evaluate(()=>window.dispatchEvent(new Event('authority-projection-refreshed')));
    await page.waitForFunction(()=>document.querySelector('#student').textContent==='0');
    // UTF-8: acknowledged course writes cannot reset the original filters or open form.
    await page.locator('#course-nav').click();await page.locator('#course').click();
    for(let n=0;n<3;n++) {
      await page.evaluate(()=>window.dispatchEvent(new Event('authority-projection-refreshed')));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#course').innerText(),'1','projection refresh must preserve course filters and form state');
    }
    assert.deepEqual(await page.evaluate(()=>[mounts.course,unmounts.course]),[1,0]);
    await page.locator('#manual-refresh').click();assert.equal(await page.locator('#course').innerText(),'0');
    await page.locator('#calendar-nav').click();await page.locator('#calendar').waitFor();
    assert.equal(await page.locator('#calendar').innerText(),'0','leaving/reopening keeps the original navigation reset');
    await page.locator('#calendar').click();
    await page.evaluate(()=>window.changeAppPartition());
    await page.locator('#calendar').waitFor({state:'hidden'});
    await page.locator('#calendar-nav').click();await page.locator('#calendar').waitFor();
    assert.equal(await page.locator('#calendar').innerText(),'0','account/role partition replacement must discard old history');
    console.log('actual App preserves calendar/course instances on projection refresh; manual refresh and account partition resets remain');
  } finally {await browser.close();}
}

function checkCalendarReadEffect() {
  const calendar=fs.readFileSync(path.join(__dirname,'pages/ScheduleCalendar.tsx'),'utf8');
  const tree=ts.createSourceFile('calendar.tsx',calendar,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const effects=[];
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='React.useEffect'&&node.arguments[0]?.getText(tree).includes('const loadData ='))effects.push(node.arguments[0]);
    ts.forEachChild(node,visit);
  };visit(tree);assert.equal(effects.length,1);
  const window=new EventTarget(),state={},reads={count:0},timers=[];
  let records=[{id:'one',course_id:'course'}];
  window.dbService={getAllCourses:()=>[],getAllTeachers:()=>[],getAllStudents:()=>[],getAllRooms:()=>[]};
  window.setTimeout=fn=>timers.push(fn);
  const setter=key=>value=>{state[key]=typeof value==='function'?value(state[key]||[]):value;};
  const context={window,localStorage:{},loadingSchedulesRef:{current:false},schedulesHydratedRef:{current:false},
    readSchedulesFromPrimaryStore:()=>{reads.count++;return records;},normalizeScheduleEvent:x=>x,
    getCourseDisplayName:()=>'',setSchedules:setter('schedules'),setBatchSchedules:setter('batch'),
    setCourses:setter('courses'),setBatchCourses:setter('batchCourses'),setTeachers:setter('teachers'),
    setAllStudents:setter('students'),setRooms:setter('rooms'),setBatchRooms:setter('batchRooms'),
    setInterval:fn=>{state.interval=fn;return 1;},clearInterval:()=>{state.interval=null;},console};
  const code=compile('const effect='+effects[0].getText(tree)+';');
  const cleanup=new Function(...Object.keys(context),code+'return effect();')(...Object.values(context));
  timers.splice(0).forEach(fn=>fn());assert.equal(reads.count,1);
  records=[];window.dispatchEvent(new Event('authority-projection-refreshed'));
  assert.equal(reads.count,2,'the mounted calendar must read the acknowledged cloud cache immediately');
  assert.deepEqual(state.schedules,[]);assert.deepEqual(state.batch,[]);
  timers.splice(0).forEach(fn=>fn());cleanup();
  window.dispatchEvent(new Event('authority-projection-refreshed'));
  assert.equal(reads.count,2,'unmounted calendar must remove its projection listener');assert.equal(state.interval,null);
  console.log('actual calendar load effect refreshes cache in place and removes its listener on unmount');
}
function checkCourseReadEffect() {
  // UTF-8: execute the actual cache reader/effect without replacing the course component state.
  const course=fs.readFileSync(path.join(__dirname,'pages/CourseList.tsx'),'utf8');
  const tree=ts.createSourceFile('course.tsx',course,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let reader;const effects=[];
  const visit=node=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='loadData')reader=node.initializer;
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes('loadData();'))effects.push(node.arguments[0]);
    ts.forEachChild(node,visit);
  };visit(tree);assert(reader);assert.equal(effects.length,1);
  const window=new EventTarget(),state={},reads={count:0};let records=[{id:'course',active:true}];
  const dbService={getAllCourses:()=>{reads.count++;return records;},getAllInstitutions:()=>[],getAllTeachers:()=>[],getAllStudents:()=>[],getAllRooms:()=>[]};
  const setter=key=>value=>{state[key]=value;};
  const context={window,dbService,console,setCourses:setter('courses'),setInstitutions:setter('institutions'),setTeachers:setter('teachers'),setStudents:setter('students'),setRooms:setter('rooms')};
  const code=compile('const loadData='+reader.getText(tree)+';const effect='+effects[0].getText(tree)+';');
  const cleanup=new Function(...Object.keys(context),code+'return effect();')(...Object.values(context));
  assert.equal(reads.count,1);assert.notEqual(state.courses,records);
  records=[{id:'course',active:false}];window.dispatchEvent(new Event('authority-projection-refreshed'));
  assert.equal(reads.count,2,'mounted course page must read acknowledged cloud cache');assert.deepEqual(state.courses,records);
  assert.equal(typeof cleanup,'function');cleanup();window.dispatchEvent(new Event('authority-projection-refreshed'));
  assert.equal(reads.count,2,'course page must remove its listener when leaving');
  console.log('actual course load effect refreshes cache in place and removes its listener on unmount');
}
checkMountedCalendar().then(()=>{checkCalendarReadEffect();checkCourseReadEffect();}).catch(error=>{console.error(error);process.exitCode=1;});
