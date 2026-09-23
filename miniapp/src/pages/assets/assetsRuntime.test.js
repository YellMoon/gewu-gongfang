'use strict';
// UTF-8: Execute the actual page, including deferred native picker/read/modal handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createAuthSessionRuntime } = require('../../utils/miniappApiSessionRuntime');
const { canOpenMiniappRoute } = require('../../utils/miniappRouteAccess');
const { deriveAccess, permissionIdentityKey } = require('../../utils/miniappAuthorizationRuntime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const byClass = (h, name) => nodes(h.render()).filter(n => (n.props.className || '').split(' ').includes(name));
function harness(role='teacher') {
  const state=[], effects=[]; let cursor=0;
  const user={id:'account-1',role,user_type:role};
  const access=deriveAccess(user,{status:'loaded',identityKey:permissionIdentityKey(user),capabilities:[role==='teacher'?'business:teacher-scope':role==='super_admin'?'business:all':'question-bank:view']});
  const h={epoch:1,allowed:canOpenMiniappRoute('/pages/assets/index',access),posts:[],toasts:[],modals:[],reads:0,pulls:0,picks:0,cache:{assetRecords:[],assetCategories:[]}};
  const identity=()=>({id:'account-'+h.epoch,role,user_type:role,account_state:'formal',token_use:'miniapp-cloud'});
  const session=createAuthSessionRuntime({readToken:()=> 'token-'+h.epoch,readIdentity:identity,readGeneration:()=>h.epoch,writeGeneration:v=>{h.epoch=v;}});
  h.pick=async()=>({tempFiles:[{path:'fixture.csv'}]});
  h.read=async()=> 'date,type,amount,category,note\n2026-09-23,expense,12,Books,';
  h.confirm=async()=>({confirm:true}); h.post=async()=>({success:true,data:{receipt:{replayed:false,recordCount:1}}}); h.project=async()=>true;
  const slot=initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return i;};
  const jsx=(type,props)=>({type,props:props||{}});
  const deps={
    react:{useState:initial=>{const i=slot(initial);return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef:initial=>state[slot({current:initial})],useMemo:fn=>fn(),useEffect:fn=>{slot(null);if(!h.mounted)effects.push(fn);}},
    'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':{View:'View',Text:'Text',ScrollView:'ScrollView'},
    '@tarojs/taro':{default:{chooseMessageFile:async()=>{h.picks++;return h.pick();},getFileSystemManager:()=>({readFile:o=>h.read().then(data=>o.success({data}),o.fail)}),showModal:async o=>{h.modals.push(o);return h.confirm();},showToast:o=>h.toasts.push(o.title),stopPullDownRefresh:()=>{}},useDidShow:fn=>{h.show=fn;},useDidHide:fn=>{h.hide=fn;},usePullDownRefresh:fn=>{h.pull=fn;}},
    '../../utils/api':{miniappCloudBusinessApi:{importPersonalAssets:async(...args)=>{h.posts.push(args);return h.post();}}},
    '../../utils/authSession':{authSessionRuntime:session},
    '../../utils/permission':{assertMiniappWriteAllowed:()=>{if(!h.allowed)throw Error('denied');}},
    '../../utils/miniappPageAccess':{canAccessMiniappPage:()=>h.allowed,refreshMiniappPageAccess:async()=>h.allowed},
    '../../utils/sync':{getLocalData:key=>{h.reads++;return h.cache[key]||[];},pullFromCloudBusinessProjection:async()=>{h.pulls++;return h.project();}},
    '../../components/shared':{EmptyState:'EmptyState',LoadingSkeleton:'LoadingSkeleton'},'../../components/ForbiddenContent':{default:'Forbidden'},
  };
  const source=fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',output)(name=>name.endsWith('.scss')?{}:Object.hasOwn(deps,name)?deps[name]:require(name),module,module.exports);
  h.render=()=>{cursor=0;return module.exports.default();};
  h.mount=()=>{const tree=h.render();h.mounted=true;h.cleanups=effects.map(fn=>fn());return tree;};
  h.refresh=async()=>{await h.show();await tick();};
  h.import=()=>byClass(h,'task-card')[0].props.onClick();
  return h;
}
(async()=>{
  const h=harness();h.mount();await h.refresh();
  const picking=deferred();h.pick=()=>picking.promise;
  const first=h.import();const duplicate=h.import();await tick();assert.equal(h.picks,1,'double tap cannot open two pickers');
  picking.resolve({tempFiles:[{path:'fixture.csv'}]});await Promise.all([first,duplicate]);
  assert.equal(h.modals.length,1,'requires explicit import confirmation');assert.equal(h.posts.length,1);
  assert.equal(h.posts[0][0],'token-1');assert.match(h.posts[0][2],/^asset-import-[a-f0-9]{64}$/);
  h.pick=async()=>({tempFiles:[{path:'renamed.csv'}]});await h.import();
  assert.equal(h.posts[1][2],h.posts[0][2],'same normalized content must reuse its retry key');
  h.confirm=async()=>({confirm:false});await h.import();assert.equal(h.posts.length,2,'cancel never writes');
  const toasts=h.toasts.length;h.pick=async()=>{throw {errMsg:'chooseMessageFile:fail cancel'};};await h.import();assert.equal(h.toasts.length,toasts,'picker cancellation is quiet');
  h.pick=async()=>({tempFiles:[{path:'fixture.csv'}]});h.read=async()=> 'bad csv';await h.import();
  assert.ok(h.toasts.at(-1).includes('CSV'));assert.ok(!h.toasts.at(-1).includes('PERSONAL_ASSET'),'no internal parser codes');
  for(const stage of ['pick','read','confirm','post']) for(const reason of ['account','unmount','permission','hide']) {
    const x=harness();x.mount();await x.refresh();const gate=deferred();
    x[stage]=()=>gate.promise;const work=x.import();await tick();
    if(reason==='account')x.epoch++;else if(reason==='permission')x.allowed=false;else if(reason==='hide')x.hide();else x.cleanups.forEach(fn=>fn?.());
    const before=x.pulls;
    gate.resolve(stage==='pick'?{tempFiles:[{path:'fixture.csv'}]}:stage==='read'?'date,type,amount,category,note\n2026-09-23,expense,12,Books,':stage==='confirm'?{confirm:true}:{success:true,data:{receipt:{replayed:false}}});
    await work;assert.equal(x.posts.length,stage==='post'?1:0,stage+'/'+reason+' cannot submit as a replacement session');assert.equal(x.toasts.length,0);assert.equal(x.pulls,before);
  }
  for(const role of ['student','family_member','visitor']) {const x=harness(role);x.mount();await x.refresh();assert.equal(x.pulls,0);assert.equal(x.reads,0);assert.equal(byClass(x,'task-card').length,0);}
  const r=harness();assert.ok(nodes(r.mount()).some(n=>n.type==='LoadingSkeleton'));
  r.project=async()=>false;await r.refresh();assert.equal(nodes(r.render()).find(n=>n.type==='EmptyState').props.actionText,'重试');
  r.cache.assetRecords=[{id:'one',category_id:'cat',date:'2026-09-23',type:'expense',amount:2.55}];
  r.cache.assetCategories=[{id:'cat',name:'Books',type:'expense'}];await r.refresh();byClass(r,'period-tag')[2].props.onClick();
  assert.ok(text(r.render()).includes('2.55'),'do not round cents away');assert.equal(byClass(r,'asset-cache-notice').length,1);
  // UTF-8: Real populated-page audit found dates and amounts stuck together.
  r.cache.assetRecords[0].note='Exercise books';await r.refresh();
  const recordRow=byClass(r,'record-row')[0];
  assert.ok(text(recordRow).includes('Books'),'each record keeps its category context');
  assert.ok(text(recordRow).includes('Exercise books'),'cloud note remains visible');
  assert.equal(byClass(r,'record-date').length,1,'date has a separate secondary line');
  assert.equal(text(byClass(r,'record-amount')[0]),'-¥2.55','expenses have a visible direction');
  assert.equal(nodes(r.render()).filter(n=>n.type==='ScrollView').length,0,'use native page scrolling and pull refresh');
  const styles=fs.readFileSync(path.join(__dirname,'index.scss'),'utf8');
  assert.doesNotMatch(styles,/height:\s*calc\(100vh\s*-\s*360rpx\)/,'no hardcoded nested viewport');
  r.epoch++;assert.ok(!text(r.render()).includes('2.55'),'never render old account balances');
  const uncertain=harness();uncertain.mount();await uncertain.refresh();uncertain.post=async()=>({success:false,error:'network timeout'});await uncertain.import();
  uncertain.post=async()=>({success:true,data:{receipt:{replayed:true}}});await uncertain.import();assert.equal(uncertain.posts[0][2],uncertain.posts[1][2]);assert.equal(uncertain.toasts.at(-1),'这份文件已导入');
  // UTF-8: A picker return is not a replacement account or a fresh submission.
  const native=harness();native.mount();await native.refresh();const chosen=deferred();native.pick=()=>chosen.promise;
  const nativeWork=native.import();native.hide();await native.refresh();await native.import();assert.equal(native.picks,1,'hide/show from picker retains import lock');
  chosen.resolve({tempFiles:[{path:'fixture.csv'}]});await nativeWork;assert.equal(native.posts.length,1,'picker return on same session still works');
  for(const reason of ['account','hide','unmount','permission']) {
    const x=harness();x.mount();await x.refresh();const gate=deferred();x.project=()=>gate.promise;const work=x.refresh();await tick();
    if(reason==='account')x.epoch++;else if(reason==='hide')x.hide();else if(reason==='permission')x.allowed=false;else x.cleanups.forEach(fn=>fn?.());
    const reads=x.reads;gate.resolve(true);await work;assert.equal(x.reads,reads,'late read: '+reason);
  }
  const applied=harness();applied.mount();await applied.refresh();applied.project=async()=>false;await applied.import();
  assert.equal(applied.toasts.at(-1),'导入成功','failed refresh cannot claim committed write failed');
  console.log('assets actual page confirmation, retries, session races, permissions and read-state checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
