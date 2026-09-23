'use strict';
// UTF-8: Run the actual home handlers against the platform's tab-page boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const session = require('../../utils/miniappApiSessionRuntime');
const experience = require('../../utils/accountExperience');
const presentation = require('../../utils/miniappHomePresentation');
const dates = require('../../utils/cloudBusinessProjection');
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const byClass = (tree, name) => nodes(tree).filter(n => (n.props?.className || '').split(' ').includes(name));
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const appSource = fs.readFileSync(path.join(__dirname, '../../app.config.ts'), 'utf8');
const tabPages = new Set([...appSource.matchAll(/pagePath:\s*'([^']+)'/g)].map(match => '/' + match[1]));
const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2020}}).outputText;
function harness(role) {
  const state = [], effects=[]; let cursor = 0;
  const staff = ['teacher','super_admin'].includes(role);
  const identity = {id:'test-'+role, name:'Test User', role, user_type:role, account_state:role==='visitor'?'visitor':'formal', token_use:role==='visitor'?'miniapp-visitor':'miniapp-cloud', ...(role==='visitor'?{identity_kind:'visitor',authority_id:'test',capabilities:[...experience.VISITOR_CAPABILITIES]}:{})};
  const policy = {role, modules:staff?['scheduling','question-bank','assets']:['scheduling','question-bank'], capabilities:[]};
  const h = {routes:[], projections:0, identity, epoch:1, modals:[], removed:[], reads:[], writes:0, cleanups:[], permissionResult:async()=>{}, result:async()=>true};
  const slot = initial => {const i=cursor++; if(!(i in state))state[i]=typeof initial==='function'?initial():initial; return i;};
  const jsx = (type,props) => ({type,props:props||{}});
  const navigate = (method, {url}) => {
    assert.equal(method==='switchTab', tabPages.has(url), `${role}: ${url} must use ${tabPages.has(url)?'switchTab':'navigateTo'}`);
    h.routes.push({method,url});
  };
  const runtime = session.createAuthSessionRuntime({readToken:()=> 'test', readIdentity:()=>h.identity, readGeneration:()=>h.epoch, writeGeneration:value=>{h.epoch=value;}});
  h.runtime=runtime;
  const deps = {
    react:{useState:initial=>{const i=slot(initial);return[state[i],next=>{h.writes++;state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:fn=>{slot(null);if(!h.mounted)effects.push(fn);}},
    'react/jsx-runtime':{jsx,jsxs:jsx}, '@tarojs/components':{View:'View',Text:'Text'},
    '@tarojs/taro':{default:{navigateTo:o=>navigate('navigateTo',o),switchTab:o=>navigate('switchTab',o),redirectTo:o=>h.routes.push({method:'redirectTo',...o}),getStorageSync:()=>h.identity,removeStorageSync:key=>h.removed.push(key),showModal:o=>h.modals.push(o)},useDidShow:fn=>{h.show=fn;},useDidHide:fn=>{h.hide=fn;}},
    '../../utils/authSession':{authSessionRuntime:runtime}, '../../utils/miniappApiSessionRuntime':session,
    '../../utils/accountExperience':experience,
    '../../utils/permission':{clearPermissionCache:()=>{h.permissionsCleared=true;},fetchPermissions:()=>h.permissionResult(),getEffectiveMiniappAccess:()=>policy,getMiniappRolePolicy:()=>policy},
    '../../utils/sync':{getLocalData:key=>{h.reads.push(key);return [];},pullFromCloudBusinessProjection:async()=>{h.projections++;return h.result();}},
    '../../utils/cloudBusinessProjection':dates,
    '../../utils/storage':{clearBusinessCache:()=>{h.businessCleared=true;},setBusinessCacheIdentity:()=>{}},
    '../../utils/miniappHomePresentation':presentation,
    '../../components/shared':{NetworkStatus:'NetworkStatus',LoadingSkeleton:'LoadingSkeleton',EmptyState:'EmptyState'},
    '../../components/MembershipBadge':{default:'MembershipBadge'}, '../../types':{ScheduleStatus:{PLANNED:1,COMPLETED:2}},
  };
  const module={exports:{}};
  new Function('require','module','exports',compiled)(name=>{if(name.endsWith('.scss'))return {};assert.ok(Object.hasOwn(deps,name),name);return deps[name];},module,module.exports);
  h.render=()=>{cursor=0;return module.exports.default();};
  h.mount=()=>{const tree=h.render();h.mounted=true;h.cleanups=effects.map(fn=>fn());return tree;};
  return h;
}
(async()=>{
  for(const role of ['teacher','super_admin','student','family_member','visitor']) {
    const h=harness(role);h.mount();h.show();await tick();await tick();const tree=h.render();
    const cards=byClass(tree,'home-action-card'),shortcuts=byClass(tree,'home-shortcut-card');
    const staff=['teacher','super_admin'].includes(role),visitor=role==='visitor';
    assert.equal(cards.length,staff||visitor?3:2);assert.equal(shortcuts.length,staff?4:visitor?0:2);
    assert.equal(h.projections,visitor?0:1,'visitor does not fetch teaching records');
    if(!staff)for(const label of ['今日收入','本月收入','学生总数','财务导入','缴费记录'])assert.ok(!text(tree).includes(label));
    for(const card of [...cards,...shortcuts])card.props.onClick();
    assert.deepEqual(h.routes.slice(0,2).map(r=>r.url),['/pages/schedule/index','/pages/question-bank/index']);
    if(staff)assert.deepEqual(h.routes.slice(2).map(r=>r.url),['/pages/assets/index','/pages/students/index','/pages/courses/index','/pages/payments/index','/pages/stats/index']);
    if(visitor)assert.equal(h.routes.at(-1).url,'/pages/account-application/index');
    if(!staff&&!visitor)assert.deepEqual(h.routes.slice(2).map(r=>r.url),['/pages/schedule/index','/pages/question-bank/index']);
  }
  for(const reason of ['identity','hide','hide-show','unmount']) {
    const h=harness('teacher');h.mount();h.show();await tick();
    byClass(h.render(),'home-logout')[0].props.onClick();
    if(reason==='identity'){h.epoch++;h.identity={...h.identity,id:'replacement'};}
    if(reason==='hide')h.hide?.();
    if(reason==='hide-show'){h.hide();h.show();await tick();}
    if(reason==='unmount')h.cleanups.forEach(fn=>fn?.());
    h.modals[0].success({confirm:true});
    assert.equal(h.removed.length,0,'stale '+reason+' logout must not clear another account');
    assert.equal(h.routes.length,0,'stale modal must not redirect');
  }
  for(const invalidated of [false,true]) {
    const h=harness('teacher');h.mount();h.show();await tick();if(invalidated)h.runtime.invalidate();
    byClass(h.render(),'home-logout')[0].props.onClick();h.modals[0].success({confirm:false});assert.equal(h.removed.length,0);
    byClass(h.render(),'home-logout')[0].props.onClick();h.modals[1].success({confirm:true});
    assert.equal(h.permissionsCleared,true);assert.equal(h.businessCleared,true);
    assert.ok(h.removed.includes('auth_token'));assert.equal(h.routes.at(-1).url,'/pages/login/index');
  }
  for(const phase of ['permissions','projection'])for(const reason of ['identity','hide','unmount']) {
    const h=harness('teacher');let finish;
    if(phase==='permissions')h.permissionResult=()=>new Promise(resolve=>{finish=resolve;});
    else h.result=()=>new Promise(resolve=>{finish=resolve;});
    h.mount();h.show();await tick();assert.equal(typeof finish,'function');
    if(reason==='identity'){h.epoch++;h.identity={...h.identity,id:'replacement'};}
    if(reason==='hide')h.hide?.();
    if(reason==='unmount')h.cleanups.forEach(fn=>fn?.());
    const writes=h.writes,reads=h.reads.length;finish(true);await tick();await tick();
    assert.equal(h.writes,writes,phase+' '+reason+' must not set stale state');
    assert.equal(h.reads.length,reads,phase+' '+reason+' must not read replacement cache');
    if(phase==='permissions')assert.equal(h.projections,0,'stale permissions must not start a projection');
  }
  for(const role of ['teacher','student','family_member'])for(const repeated of [false,true]) {
    const h=harness(role);let refreshes=0;
    h.permissionResult=async()=>{refreshes++;if(repeated||refreshes===1){h.epoch++;h.identity={...h.identity,teacher_id:'scope-'+refreshes};}};
    h.mount();h.show();await tick();await tick();
    assert.equal(refreshes,2,'same-account scope refresh retries once, never loops');
    assert.equal(h.projections,repeated?0:1,'only a stable confirmed scope reads the projection');
    assert.equal(nodes(h.render()).some(n=>n.type==='LoadingSkeleton'),false,'bounded authorization retry must not leave an endless loading screen');
    if(repeated)assert.equal(byClass(h.render(),'home-metric-grid').length,0,'unconfirmed scope must not show financial/teaching metrics');
  }
  for(const phase of ['permissions','projection']) {
    const h=harness('teacher'),finishes=[];
    if(phase==='permissions')h.permissionResult=()=>new Promise(resolve=>finishes.push(resolve));
    else h.result=()=>new Promise(resolve=>finishes.push(resolve));
    h.mount();h.show();await tick();h.show();await tick();
    assert.equal(finishes.length,2);finishes[1](true);await tick();await tick();
    const writes=h.writes,reads=h.reads.length,projections=h.projections;
    finishes[0](true);await tick();await tick();
    assert.equal(h.writes,writes,'older '+phase+' completion cannot replace the latest refresh');
    assert.equal(h.reads.length,reads);assert.equal(h.projections,projections);
  }
  for(const role of ['teacher','student','family_member']) {
    const h=harness(role);h.permissionResult=()=>new Promise(()=>{});h.mount();h.show();
    assert.equal(byClass(h.render(),'home-metric-grid').length,0,'pending authorization must not flash financial/teaching metrics');
  }
  const retry=harness('teacher');retry.mount();retry.show();await tick();
  const before=retry.projections;nodes(retry.render()).find(n=>n.type==='NetworkStatus').props.onRetry();await tick();await tick();
  assert.equal(retry.projections,before+1,'home retry must refresh cloud/auth state, not only re-count an old cache');
  const retryCallback=nodes(retry.render()).find(n=>n.type==='NetworkStatus').props.onRetry;
  retry.hide();const hiddenWrites=retry.writes,hiddenProjections=retry.projections;
  retryCallback();await tick();
  assert.equal(retry.writes,hiddenWrites,'hidden-page retry must not set state');
  assert.equal(retry.projections,hiddenProjections,'hidden-page retry must not start requests');
  const css=fs.readFileSync(path.join(__dirname,'index.scss'),'utf8').match(/\.home-logout\s*\{([^}]+)\}/)[1];
  assert.match(css,/min-height:\s*44px/,'logout target height');assert.match(css,/min-width:\s*44px/,'logout target width');
  console.log('home five-role navigation, stale-session/logout/lifecycle/retry and touch checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
