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
  const state = []; let cursor = 0;
  const staff = ['teacher','super_admin'].includes(role);
  const identity = {id:'test-'+role, name:'Test User', role, user_type:role, account_state:role==='visitor'?'visitor':'formal', token_use:role==='visitor'?'miniapp-visitor':'miniapp-cloud', ...(role==='visitor'?{identity_kind:'visitor',authority_id:'test',capabilities:[...experience.VISITOR_CAPABILITIES]}:{})};
  const policy = {role, modules:staff?['scheduling','question-bank','assets']:['scheduling','question-bank'], capabilities:[]};
  const h = {routes:[], projections:0};
  const slot = initial => {const i=cursor++; if(!(i in state))state[i]=typeof initial==='function'?initial():initial; return i;};
  const jsx = (type,props) => ({type,props:props||{}});
  const navigate = (method, {url}) => {
    assert.equal(method==='switchTab', tabPages.has(url), `${role}: ${url} must use ${tabPages.has(url)?'switchTab':'navigateTo'}`);
    h.routes.push({method,url});
  };
  const runtime = session.createAuthSessionRuntime({readToken:()=> 'test', readIdentity:()=>identity, readGeneration:()=>1, writeGeneration:()=>{}});
  const deps = {
    react:{useState:initial=>{const i=slot(initial);return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useCallback:fn=>fn,useMemo:fn=>fn()},
    'react/jsx-runtime':{jsx,jsxs:jsx}, '@tarojs/components':{View:'View',Text:'Text'},
    '@tarojs/taro':{default:{navigateTo:o=>navigate('navigateTo',o),switchTab:o=>navigate('switchTab',o),redirectTo:o=>h.routes.push({method:'redirectTo',...o})},useDidShow:fn=>{h.show=fn;}},
    '../../utils/authSession':{authSessionRuntime:runtime}, '../../utils/miniappApiSessionRuntime':session,
    '../../utils/accountExperience':experience,
    '../../utils/permission':{clearPermissionCache:()=>{},fetchPermissions:async()=>{},getEffectiveMiniappAccess:()=>policy,getMiniappRolePolicy:()=>policy},
    '../../utils/sync':{getLocalData:()=>[],pullFromCloudBusinessProjection:async()=>{h.projections++;return true;}},
    '../../utils/cloudBusinessProjection':dates,
    '../../utils/storage':{clearBusinessCache:()=>{},setBusinessCacheIdentity:()=>{}},
    '../../utils/miniappHomePresentation':presentation,
    '../../components/shared':{NetworkStatus:'NetworkStatus',LoadingSkeleton:'LoadingSkeleton',EmptyState:'EmptyState'},
    '../../components/MembershipBadge':{default:'MembershipBadge'}, '../../types':{ScheduleStatus:{PLANNED:1,COMPLETED:2}},
  };
  const module={exports:{}};
  new Function('require','module','exports',compiled)(name=>{if(name.endsWith('.scss'))return {};assert.ok(Object.hasOwn(deps,name),name);return deps[name];},module,module.exports);
  h.render=()=>{cursor=0;return module.exports.default();};
  return h;
}
(async()=>{
  for(const role of ['teacher','super_admin','student','family_member','visitor']) {
    const h=harness(role);h.render();h.show();await tick();await tick();const tree=h.render();
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
  console.log('home actual five-role card/shortcut navigation and privacy checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
