'use strict';
// UTF-8: Actual page handlers; payment types match the real numeric contract.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {createAuthSessionRuntime}=require('../../utils/miniappApiSessionRuntime');
const students=Object.freeze(Array.from({length:35},(_,i)=>Object.freeze({id:`student-${i+1}`,name:`Student ${i+1}`})));
const payments=Object.freeze([
  Object.freeze({id:'first',student_id:students[0].id,amount:2.55,payment_type:1,payment_date:'2026-09-01',created_at:'2026-09-01'}),
  Object.freeze({id:'last-old',student_id:students[34].id,amount:18.35,payment_type:1,payment_date:'2026-09-02',created_at:'2026-09-02'}),
  Object.freeze({id:'last-new',student_id:students[34].id,amount:12.5,payment_type:2,payment_date:'2026-09-03',created_at:'2026-09-03'}),
]);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const byClass=(t,c)=>nodes(t).filter(n=>(n.props.className||'').split(' ').includes(c));
const text=t=>Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(role='teacher') {
 const state=[],effects=[];let cursor=0;
 const h={role,allowed:['teacher','super_admin'].includes(role),epoch:1,pulls:0,reads:0,stops:0,cache:{payments,students},result:async()=>true};
 const slot=v=>{const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return i;};
 const identity=()=>({id:'account-'+h.epoch,role:h.role,user_type:h.role,account_state:'formal',token_use:'miniapp-cloud'});
 const runtime=createAuthSessionRuntime({readToken:()=> 'test',readIdentity:identity,readGeneration:()=>h.epoch,writeGeneration:v=>{h.epoch=v;}});
 const jsx=(type,props,key)=>({type,props:props||{},key});
 const deps={
  react:{useState:v=>{const i=slot(v);return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef:v=>state[slot({current:v})],useEffect:fn=>{slot(null);if(!h.mounted)effects.push(fn);}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':{View:'View',Text:'Text',ScrollView:'ScrollView'},
  '@tarojs/taro':{default:{stopPullDownRefresh:()=>{h.stops++;}},useDidShow:fn=>{h.show=fn;},useDidHide:fn=>{h.hide=fn;},usePullDownRefresh:fn=>{h.pull=fn;}},
  '../../types':{PaymentType:{TUITION:1,HOURS:2}},
  '../../utils/sync':{getLocalData:k=>{h.reads++;return h.cache[k];},pullFromCloudBusinessProjection:async()=>{h.pulls++;return h.result();}},
  '../../components/shared':{NetworkStatus:'NetworkStatus',EmptyState:'EmptyState',LoadingSkeleton:'LoadingSkeleton'},
  './paymentsRuntime':require('./paymentsRuntime'),
  '../../utils/miniappPageAccess':{canAccessMiniappPage:()=>h.allowed,refreshMiniappPageAccess:async()=>h.allowed},
  '../../utils/authSession':{authSessionRuntime:runtime},'../../components/ForbiddenContent':{default:'Forbidden'},'./index.scss':{},
 };
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const page={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},page,page.exports);
 h.render=()=>{cursor=0;return page.exports.default();};h.mount=()=>{const t=h.render();h.mounted=true;h.cleanups=effects.map(fn=>fn());return t;};h.refresh=async()=>{await h.show();await tick();};return h;
}
(async()=>{
 const h=harness();assert.equal(byClass(h.mount(),'pay-summary').length,0,'loading must not claim zero financial totals');
 await h.refresh();let tree=h.render(),filters=byClass(tree,'filter-tag');
 assert.equal(filters.length,36,'every authorized student remains selectable');assert.deepEqual(filters.slice(1).map(text),students.map(s=>s.name));
 assert.deepEqual(byClass(tree,'pay-stat-value').map(text),['¥20.90','12.5','3'],'hours never become money and cents are retained');
 assert.deepEqual(byClass(tree,'pay-amount').map(text),['+12.5 课时','+¥18.35','+¥2.55']);
 filters.at(-1).props.onClick();tree=h.render();assert.deepEqual(byClass(tree,'pay-card').map(n=>n.key),['last-new','last-old']);
 assert.deepEqual(byClass(tree,'pay-stat-value').map(text),['¥18.35','12.5','2']);
 await h.pull();await tick();assert.equal(byClass(h.render(),'pay-card').length,2,'native pull retains authorized filter');
 byClass(h.render(),'filter-tag')[21].props.onClick();tree=h.render();assert.deepEqual(byClass(tree,'pay-stat-value').map(text),['¥0.00','0','0']);assert.equal(nodes(tree).filter(n=>n.type==='EmptyState').length,1);
 byClass(tree,'filter-tag')[0].props.onClick();assert.equal(byClass(h.render(),'pay-card').length,3);
 for(const result of [async()=>false,async()=>{throw Error('offline');}]) {h.result=result;await h.pull();await tick();assert.equal(byClass(h.render(),'payments-cache-notice').length,1);assert.equal(byClass(h.render(),'pay-card').length,3);}
 h.cache={payments:[],students:[]};await h.pull();await tick();tree=h.render();assert.equal(byClass(tree,'pay-summary').length,0,'uncached error is not zero money');
 const retry=nodes(tree).find(n=>n.type==='EmptyState');assert.equal(retry.props.actionText,'重试');
 h.result=async()=>true;await retry.props.onAction();await tick();assert.equal(nodes(h.render()).find(n=>n.type==='EmptyState').props.actionText,undefined);
 h.cache={payments,students};await h.pull();await tick();byClass(h.render(),'filter-tag').at(-1).props.onClick();h.hide();h.cache={payments:[payments[0]],students:[students[0]]};await h.refresh();
 assert.equal(byClass(h.render(),'pay-card').length,1,'removed filter cannot hide authorized data');assert.equal(text(byClass(h.render(),'filter-tag')[0]),'全部');
 h.epoch++;assert.equal(byClass(h.render(),'pay-card').length,0,'already rendered financial data cannot cross accounts');
 for(const reason of ['hide','unmount','identity','permission','newerRequest']) {
  const stale=harness();stale.mount();await stale.refresh();let finish;stale.result=()=>new Promise(r=>{finish=r;});const pending=stale.show();await tick();
  if(reason==='hide')stale.hide();else if(reason==='unmount')stale.cleanups.forEach(fn=>fn?.());else if(reason==='identity')stale.epoch++;else if(reason==='permission')stale.allowed=false;
  else {stale.result=async()=>true;stale.cache={payments:[payments[0]],students:[students[0]]};await stale.show();}
  const reads=stale.reads;finish(true);await pending;await tick();assert.equal(stale.reads,reads,'late '+reason+' cannot read financial cache');if(reason==='newerRequest')assert.equal(byClass(stale.render(),'pay-card').length,1);
 }
 for(const role of ['student','family_member','visitor']) {const denied=harness(role);denied.mount();await denied.refresh();assert.equal(denied.render().type,'Forbidden');assert.equal(denied.reads,0);assert.equal(denied.pulls,0);}
 assert.deepEqual(payments.map(p=>p.id),['first','last-old','last-new'],'filter/sort cannot mutate cache');
 assert.match(fs.readFileSync(path.join(__dirname,'index.config.ts'),'utf8'),/enablePullDownRefresh:\s*true/);
 const css=fs.readFileSync(path.join(__dirname,'index.scss'),'utf8');assert.match(css.match(/\.filter-tag\s*\{([^}]+)\}/)[1],/min-height:\s*44px/);
 assert.doesNotMatch(css,/148rpx|height:\s*calc\(100vh/,'non-tab financial list must not reserve a phantom tab bar or a second scroll height');
 assert.match(css.match(/\.pay-student\s*\{([^}]+)\}/)[1],/word-break:\s*break-all/,'long unbroken names must not overlap the amount');
 console.log('payments actual page units/cents/all filters/native pull/cache/retry/role/session races passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
