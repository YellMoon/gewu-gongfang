'use strict';
// UTF-8: Exercise the actual student detail component and its existing role policy.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {deriveAccess,permissionIdentityKey}=require('../../utils/miniappAuthorizationRuntime');
const {canOpenMiniappRoute}=require('../../utils/miniappRouteAccess');
const displayModule={exports:{}};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../utils/studentDisplay.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(displayModule.exports);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t);
const find=(h,cls)=>nodes(h.render()).filter(n=>(n.props.className||'').split(' ').includes(cls));
function harness(role='teacher'){
 const user={id:'account-1',role,user_type:role,student_id:'student-1'};
 const access=deriveAccess(user,{status:'loaded',identityKey:permissionIdentityKey(user),capabilities:role==='teacher'?['business:teacher-scope']:role==='super_admin'?['business:all']:['question-bank:view']});
 const h={id:'student-1',epoch:1,allowed:canOpenMiniappRoute('/pages/student-detail/index',access),reads:[],pulls:0,stops:0,routes:[],result:async()=>true,cache:{
  students:[{id:'student-1',name:'Alice',phone:'13000000001',school:'School',balance_hours:10.5,balance_money:1020,created_at:'2026-09-01T00:00:00Z',source_type:1,notes:'Staff note'}],
  payments:[{id:'pay-1',student_id:'student-1',payment_type:2,amount:10.5,payment_date:'2026-09-01',payment_method:'Cash'},{id:'foreign-pay',student_id:'other',payment_type:1,amount:99999,payment_date:'2026-09-01'}],
  grades:[{id:'grade-1',student_id:'student-1',score:86,subject:'Physics',exam_date:'2026-09-01'},{id:'foreign-grade',student_id:'other',score:99,subject:'Other'}]}};
 const state=[],effects=[];let cursor=0;const slot=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return i;};const jsx=(type,props)=>({type,props:props||{}});
 const deps={
  react:{useState:initial=>{const i=slot(initial);return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useEffect:fn=>{slot(null);if(!h.mounted)effects.push(fn);}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':{View:'View',Text:'Text',Button:'Button'},
  '@tarojs/taro':{default:{stopPullDownRefresh:()=>{h.stops++;},switchTab:async o=>{h.routes.push(o.url);}},useRouter:()=>({params:{id:h.id}}),useDidShow:fn=>{h.show=fn;},useDidHide:fn=>{h.hide=fn;},usePullDownRefresh:fn=>{h.pull=fn;}},
  '../../types':{PaymentType:{TUITION:1}},'../../utils/permission':{isStudentScopedUser:()=>['student','family_member'].includes(role)},
  '../../utils/sync':{getLocalItem:(key,id)=>{h.reads.push(key);return h.cache[key].find(x=>x.id===id);},getLocalData:key=>{h.reads.push(key);return h.cache[key];},pullFromCloudBusinessProjection:async()=>{h.pulls++;return h.result();}},
  '../../utils/authSession':{authSessionRuntime:{capture:()=>h.epoch,isSameSession:s=>s===h.epoch}},
  '../../utils/miniappPageAccess':{canAccessMiniappPage:()=>h.allowed,refreshMiniappPageAccess:async()=>h.allowed},
  '../../utils/studentDisplay':displayModule.exports,
  '../../components/shared':{LoadingSkeleton:'LoadingSkeleton',EmptyState:'EmptyState'},'../../components/ForbiddenContent':{default:'Forbidden'},'./index.scss':{},
 };
 const source=fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},m,m.exports);
 h.render=()=>{cursor=0;return m.exports.default();};h.mount=()=>{const tree=h.render();h.mounted=true;h.cleanups=effects.map(fn=>fn());return tree;};return h;
}
(async()=>{
 const denied=harness('visitor');assert.equal(denied.mount().type,'Forbidden','visitor denied before reading student data');await denied.show();assert.equal(denied.pulls,0);assert.deepEqual(denied.reads,[]);
 for(const role of ['super_admin','teacher','student','family_member']){
  const h=harness(role);h.mount();await h.show();assert.ok(text(h.render()).includes('Alice'));assert.ok(text(h.render()).includes('1020'));
  assert.equal(text(h.render()).includes('Staff note'),['super_admin','teacher'].includes(role));
  find(h,'tab')[1].props.onClick();assert.ok(text(h.render()).includes('10.5 课时'));assert.ok(!text(h.render()).includes('99999'));
  find(h,'tab')[2].props.onClick();assert.ok(text(h.render()).includes('Physics'));assert.ok(!text(h.render()).includes('Other'));
  h.result=async()=>false;await h.pull();assert.ok(text(h.render()).includes('已保存的数据'));assert.ok(text(h.render()).includes('Alice'));
  h.result=async()=>{throw Error('transport failure');};await h.pull();assert.ok(text(h.render()).includes('Alice'));
  h.cache.students=[];await h.pull();let empty=nodes(h.render()).find(n=>n.type==='EmptyState');assert.equal(empty.props.actionText,'重试');assert.ok(!text(h.render()).includes('Physics'));
  h.result=async()=>true;await empty.props.onAction();empty=nodes(h.render()).find(n=>n.type==='EmptyState');assert.equal(empty.props.text,'未找到该学生信息');assert.equal(empty.props.actionText,'返回首页');await empty.props.onAction();assert.deepEqual(h.routes,['/pages/index/index']);
 }
 const missing=harness();missing.id=undefined;missing.mount();await missing.show();assert.equal(missing.pulls,0);assert.deepEqual(missing.reads,[]);
 const loaded=harness();loaded.mount();await loaded.show();loaded.epoch++;assert.ok(!text(loaded.render()).includes('Alice'),'rendered data cannot cross accounts');
 for(const reason of ['hide','unmount','identity','permission']){
  const h=harness();h.mount();let resolve;h.result=()=>new Promise(r=>{resolve=r;});const work=h.show();await tick();
  if(reason==='hide')h.hide();else if(reason==='unmount')h.cleanups.forEach(fn=>fn?.());else if(reason==='identity')h.epoch++;else h.allowed=false;
  resolve(true);await work;assert.deepEqual(h.reads,[],reason);assert.ok(!text(h.render()).includes('Alice'));
 }
 const back=harness();back.mount();await back.show();back.hide();back.cache.students[0].balance_money=2040;await back.show();assert.ok(text(back.render()).includes('2040'),'return refresh');
 const race=harness();race.mount();let finish;race.result=()=>new Promise(r=>{finish=r;});const old=race.show();await tick();race.result=async()=>true;await race.pull();const count=race.reads.length;finish(false);await old;assert.equal(race.reads.length,count);assert.ok(!text(race.render()).includes('已保存的数据'));
 assert.match(fs.readFileSync(path.join(__dirname,'index.config.ts'),'utf8'),/enablePullDownRefresh:\s*true/);
 const css=fs.readFileSync(path.join(__dirname,'index.scss'),'utf8');
 assert.match(css,/\.student-detail-page \.es-action\s*\{[^}]*min-height:\s*88rpx/,'recovery action needs a comfortable touch target');
 assert.match(css,/\.tab\s*\{[^}]*min-height:\s*88rpx/,'all three detail tabs need usable touch targets');
 console.log('student detail real component roles, tabs, cache/retry, return, native pull and stale-session checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
