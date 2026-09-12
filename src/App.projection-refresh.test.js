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
      const resources={student:'StudentList',teacher:'TeacherList',address:'RoomManager',school:'SchoolManager',institution:'InstitutionManager',payment:'PaymentList'};
      window.mounts={calendar:0,course:0};window.unmounts={calendar:0,course:0};
      Object.keys(resources).forEach(name=>{window.mounts[name]=0;window.unmounts[name]=0;});
      const stateful=name=>function Probe(){
        const [history,setHistory]=R.useState(0);
        R.useEffect(()=>{window.mounts[name]++;return()=>{window.unmounts[name]++;};},[]);
        return element('button',{id:name,onClick:()=>setHistory(n=>n+1)},String(history));
      };
      const Calendar=stateful('calendar'),Student=stateful('student'),Course=stateful('course');
      const shell=({children,onNavigate,onRefresh})=>element('main',null,
        element('button',{id:'calendar-nav',onClick:()=>onNavigate('course-calendar')},'calendar'),
        ...Object.keys(resources).map(name=>element('button',{key:name,id:name+'-nav',onClick:()=>onNavigate(name)},name)),
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
      Object.entries(resources).forEach(([name,file])=>{modules['./pages/'+file]={default:stateful(name),__esModule:true};});
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
    // UTF-8: cloud acknowledgement must not discard another unfinished resource editor.
    for(const name of ['student','teacher','address','school','institution','payment']) {
      await page.locator('#'+name+'-nav').click();await page.locator('#'+name).click();
      for(let n=0;n<3;n++) {
        await page.evaluate(()=>window.dispatchEvent(new Event('authority-projection-refreshed')));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#'+name).innerText(),'1',name+' original editor state must survive acknowledged cache refresh');
      }
      assert.deepEqual(await page.evaluate(key=>[mounts[key],unmounts[key]],name),[1,0]);
      await page.locator('#manual-refresh').click();assert.equal(await page.locator('#'+name).innerText(),'0');
    }
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
function checkResourceReadEffects() {
  for(const name of ['StudentList','TeacherList','RoomManager','SchoolManager','InstitutionManager','PaymentList']) {
    const source=fs.readFileSync(path.join(__dirname,'pages',name+'.tsx'),'utf8');
    const tree=ts.createSourceFile(name+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const readerName=name==='InstitutionManager'?'loadInstitutions':'loadData';let reader;const effects=[];
    const visit=node=>{
      if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===readerName)reader=node.initializer;
      if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes(readerName+'();'))effects.push(node.arguments[0]);
      ts.forEachChild(node,visit);
    };visit(tree);assert(reader);assert.equal(effects.length,1);
    const window=new EventTarget(),state={},calls=[];let revision=1;
    const dbService=new Proxy({}, {get:(_,key)=>{
      assert.match(String(key),/^get/,'refresh must never write business data');
      return()=>{calls.push(key);return [{id:'one',name:'school-'+revision,count:revision,revision}];};
    }});
    const setters=[...new Set(reader.getText(tree).match(/\bset[A-Z]\w*/g))];
    const context={window,dbService,console,buildSchoolOptions:rows=>rows.map(row=>({value:row.name})),...Object.fromEntries(setters.map(key=>[key,value=>{state[key]=value;}]))};
    const code=compile('const '+readerName+'='+reader.getText(tree)+';const effect='+effects[0].getText(tree)+';');
    const cleanup=new Function(...Object.keys(context),code+'return effect();')(...Object.values(context));
    const baseline=JSON.stringify(state),initialReads=calls.length;assert(initialReads>0);
    revision=2;window.dispatchEvent(new Event('authority-projection-refreshed'));
    assert.equal(calls.length,initialReads*2,name+' refresh must reread all displayed relations');
    assert.notEqual(JSON.stringify(state),baseline,name+' cache read must reach page state');
    assert.equal(typeof cleanup,'function');cleanup();window.dispatchEvent(new Event('authority-projection-refreshed'));
    assert.equal(calls.length,initialReads*2,name+' must remove its listener on unmount');
  }
  console.log('six actual resource read effects refresh displayed data without writes and remove listeners');
}
checkMountedCalendar().then(()=>{checkCalendarReadEffect();checkCourseReadEffect();checkResourceReadEffects();}).catch(error=>{console.error(error);process.exitCode=1;});
