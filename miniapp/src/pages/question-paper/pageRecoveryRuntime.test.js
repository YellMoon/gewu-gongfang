'use strict';
// UTF-8: Exercise the actual paper page's empty recovery and pre-read role boundary.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function page(role){
 const user={id:'test-account',role,user_type:role,teacher_id:'test-teacher',student_id:'test-student'};
 const state=[],effects=[],routes=[];let cursor=0,mounted=false,reads=0;const jsx=(type,props)=>({type,props:props||{}}),slot=v=>{const i=cursor++;if(!(i in state))state[i]=v;return i;};
 const deps={
  react:{useRef:v=>state[slot({current:v})],useState:v=>{const i=slot(typeof v==='function'?v():v);return[state[i],n=>{state[i]=typeof n==='function'?n(state[i]):n;}];},useMemo:fn=>fn(),useEffect:fn=>{if(!mounted)effects.push(fn);}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':Object.fromEntries(['View','Text','Input','Button','Picker','RichText'].map(x=>[x,x])),
  '@tarojs/taro':{default:{getStorageSync:()=>user,showToast:()=>{},navigateBack:async()=>{throw Error('no prior page');},switchTab:async o=>routes.push(o.url),navigateTo:async o=>routes.push(o.url),stopPullDownRefresh:()=>{}},usePullDownRefresh:()=>{}},
  '../../utils/api':{miniappCloudBusinessApi:{listQuestionPreviewsByIds:async()=>{reads++;return{success:true,data:{questions:[]}};}}},
  '../../utils/questionAssetDelivery':{},'../../utils/authSession':{authSessionRuntime:{capture:()=>({identity:user,token:'test'}),isSameSession:()=>true}},
  '../../utils/miniappAuthorizationRuntime':require('../../utils/miniappAuthorizationRuntime'),'../../utils/storage':{storage:{get:()=>null,set:()=>{}}},
  '../../utils/questionBasketStore':{useQuestionBasket:()=>({scopeKey:'test-scope',ids:[],revision:0}),questionBasketStore:{reconcileIdentity:()=>{},snapshot:()=>({scopeKey:'test-scope',ids:[]}),readPaperSelection:()=>null,seedQuestions:()=>{}}},
  '../../components/QuestionBasketOverlay':{default:'Basket'},'../../components/ForbiddenContent':{default:'Forbidden'},
  '../../utils/questionPaperWorkflow':require('../../utils/questionPaperWorkflow'),'../../utils/questionPaperDownload':{},'../../utils/questionDisplay':require('../../utils/questionDisplay'),'./index.scss':{},
 };
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},m,m.exports);
 return {routes,reads:()=>reads,render:()=>{cursor=0;return m.exports.default();},mount:()=>{cursor=0;const tree=m.exports.default();mounted=true;effects.forEach(fn=>fn());return tree;}};
}
(async()=>{
 // UTF-8: Paper editing controls must remain touchable on narrow phones.
 const styles=fs.readFileSync(path.join(__dirname,'index.scss'),'utf8');
 assert.match(styles,/\.paper-order-actions button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,'paper order actions need a 44px touch area');
 for(const role of ['super_admin','teacher']){const h=page(role);h.mount();await tick();const button=nodes(h.render()).find(n=>n.type==='Button'&&text(n)==='返回题库选题');assert.ok(button);await button.props.onClick();assert.deepEqual(h.routes,['/pages/question-bank/index'],'empty root route must return to the named question bank');}
 for(const role of ['student','family_member','visitor']){const h=page(role);assert.equal(h.mount().type,'Forbidden');await tick();assert.equal(h.reads(),0,'denied page must not hydrate a paper');assert.deepEqual(h.routes,[]);}
 console.log('paper actual component root/normal empty recovery and denied-role pre-read boundary passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
