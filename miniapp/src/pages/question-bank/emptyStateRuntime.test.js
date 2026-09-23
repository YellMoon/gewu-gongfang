'use strict';
// UTF-8: Distinguish an empty library from a filter with no matches in the actual page.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t);
function harness(status='empty',role='teacher'){
 const state=[],modals=[],routes=[];let cursor=0;const slot=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return i;};const jsx=(type,props)=>({type,props:props||{}});
 const deps={
  react:{useState:initial=>{const value=typeof initial==='function'?initial():initial;const i=slot(value==='loading'?status:value);return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useEffect:()=>{},useMemo:fn=>fn()},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':Object.fromEntries(['View','Text','Input','Button','Picker','RichText','ScrollView'].map(n=>[n,n])),
  '@tarojs/taro':{default:{getStorageSync:()=>({id:'test',role,user_type:role}),showModal:o=>modals.push(o),navigateTo:o=>routes.push(o.url)},useDidShow:()=>{},usePullDownRefresh:()=>{},useReachBottom:()=>{}},
  '../../utils/api':{miniappCloudBusinessApi:{}},'../../utils/questionAssetDelivery':{},'../../utils/authSession':{},
  '../../utils/miniappAuthorizationRuntime':require('../../utils/miniappAuthorizationRuntime'),
  '../../utils/questionBasketStore':{questionBasketStore:{},useQuestionBasket:()=>({ids:[]})},
  '../../components/QuestionBasketOverlay':{default:'Basket'},'../../utils/questionDisplay':require('../../utils/questionDisplay'),'./index.scss':{},
 };
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},m,m.exports);
 const h={modals,routes,render:()=>{cursor=0;return m.exports.default();}};
 h.find=cls=>nodes(h.render()).find(n=>(n.props.className||'').split(' ').includes(cls));return h;
}
for(const role of ['super_admin','teacher','student','family_member','visitor']){
 const h=harness('empty',role);assert.equal(text(h.find('question-empty-title')),'题库中暂无题目');assert.equal(h.find('question-retry'),undefined);
 h.find('question-search-input').props.onInput({detail:{value:'no-match'}});
 assert.equal(text(h.find('question-empty-title')),'没有符合条件的题目','search miss must not claim the library is empty');
 assert.equal(text(h.find('question-empty-message')),'换一个筛选条件试试');
 const reset=h.find('question-retry');assert.equal(text(reset),'清除筛选');reset.props.onClick();
 assert.equal(h.find('question-search-input').props.value,'');assert.equal(text(h.find('question-empty-title')),'题库中暂无题目');
 h.find('question-source-input').props.onInput({detail:{value:'missing-source'}});
 assert.equal(text(h.find('question-empty-title')),'没有符合条件的题目');h.find('question-retry').props.onClick();assert.equal(h.find('question-source-input').props.value,'');
}
for(const [status,label] of [['loading','正在加载题库'],['offline','暂时无法加载题库'],['forbidden','当前账号暂无题库访问权限']]){
 const h=harness(status);h.find('question-search-input').props.onInput({detail:{value:'no-match'}});assert.equal(text(h.find('question-empty-title')),label);
 assert.equal(text(h.find('question-retry')),status==='offline'?'重试':'');
}
// UTF-8: Formal student/family accounts cannot apply on the visitor-only route.
for(const role of ['student','family_member','visitor']){
 const h=harness('empty',role);nodes(h.render()).find(n=>n.type==='Basket').props.onRestricted();const modal=h.modals.at(-1);
 assert.equal(modal.title,'组卷需要教师角色');
 if(role==='visitor'){assert.equal(modal.confirmText,'去申请');modal.success({confirm:true});assert.deepEqual(h.routes,['/pages/account-application/index']);}
 else {assert.equal(modal.confirmText,'知道了');assert.equal(modal.showCancel,false);assert.equal(modal.success,undefined);assert.deepEqual(h.routes,[]);}
}
console.log('question bank actual component empty-library/filter-miss/reset/role/error states passed');
