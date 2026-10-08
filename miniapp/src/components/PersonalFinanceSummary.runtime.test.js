'use strict';
// UTF-8: Actual component lifecycle + chooser/preview/import races, with no cloud writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const chosen={tempFiles:[{path:'/fixture.csv',name:'bill.csv',size:4}]};
const preview={provider:'fixture',records:[{date:'2026-10-08',description:'验收账单',currency:'CNY',amountMinor:'123',status:'completed'}],warnings:[],errors:[]};
function page(){
 const state=[],effects=[],cleanups=[],choosers=[],previewCalls=[],imports=[],modals=[],toasts=[];let cursor=0,generation=0,accountId='old-account',show,hide,unmounted=false,lateWrites=0,ledgerCalls=0;
 let ledgerReply=null,previewReply=null,modalReply=null,importReply=null;
 const jsx=(type,props)=>({type,props:props||{}}),slot=v=>{const i=cursor++;if(!(i in state))state[i]=v;return i;};
 const ledger=()=>({accounts:accountId?[{id:accountId,label:accountId,currency:'CNY',type:'bank'}]:[],observations:[],links:[],balanceAnchors:[]});
 const deps={
  react:{useState:initial=>{const i=slot(typeof initial==='function'?initial():initial);return[state[i],next=>{if(unmounted)lateWrites++;state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:initial=>state[slot({current:initial})],useEffect:fn=>{const i=slot(false);if(!state[i]){state[i]=true;effects.push(fn);}}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@tarojs/components':Object.fromEntries(['Button','Checkbox','Input','Text','View'].map(n=>[n,n])),
  '@tarojs/taro':{default:{chooseMessageFile:()=>{const d=deferred();choosers.push(d);return d.promise;},getFileSystemManager:()=>({readFile:o=>o.success({data:'ZmFrZQ=='})}),showToast:o=>toasts.push(o),showModal:o=>{modals.push(o);return modalReply?modalReply():Promise.resolve({confirm:true});}},useDidShow:fn=>{show=fn;},useDidHide:fn=>{hide=fn;}},
  '../utils/personalFinanceApi':{personalFinanceApi:{ledger:()=>{ledgerCalls++;return ledgerReply?ledgerReply():Promise.resolve({ledger:ledger()});},preview:input=>{previewCalls.push(input);return previewReply?previewReply():Promise.resolve({preview});},import:(input,key)=>{imports.push({input,key});return importReply?importReply():Promise.resolve({ok:true});}}},
  '../utils/authSession':{authSessionRuntime:{capture:()=>({generation}),isSameSession:s=>s.generation===generation}},'../utils/permission':{assertMiniappWriteAllowed:()=>{}},
  '../../../shared/personal-finance/ledger':require(path.resolve(__dirname,'../../../shared/personal-finance/ledger.js')),
 };
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'PersonalFinanceSummary.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},m,m.exports);
 const render=()=>{cursor=0;return m.exports.default();};
 const h={render,choosers,previewCalls,imports,modals,toasts,show:()=>show(),hide:()=>hide(),swap:()=>{generation++;accountId='new-account';},empty:()=>{accountId='';},setLedgerReply:fn=>{ledgerReply=fn;},setPreviewReply:fn=>{previewReply=fn;},setModalReply:fn=>{modalReply=fn;},setImportReply:fn=>{importReply=fn;},lateWrites:()=>lateWrites,
  mount:async(withShow=true)=>{render();effects.splice(0).forEach(fn=>cleanups.push(fn()));if(withShow)show();await tick();},unmount:()=>{unmounted=true;cleanups.forEach(fn=>fn?.());},button:label=>nodes(render()).find(n=>n.type==='Button'&&text(n)===label),ledgerCalls:()=>ledgerCalls,
 };
 h.chooseButton=()=>nodes(render()).find(n=>n.type==='Button'&&/^(选择账单|正在处理)/.test(text(n)));
 h.begin=()=>{h.button('导入到账户').props.onClick();h.chooseButton().props.onClick();};
 return h;
}
(async()=>{
 const mountedLate=page();await mountedLate.mount(false);
 assert.equal(mountedLate.ledgerCalls(),1,'a child mounted after the parent did-show must load without waiting for another page show');
 assert.match(text(mountedLate.render()),/old-account/);assert.doesNotMatch(text(mountedLate.render()),/正在读取账户/);
 // Original red scenario: stale chooser callbacks left a replacement account permanently busy.
 const changed=page();await changed.mount();changed.begin();changed.hide();changed.swap();changed.show();await tick();
 changed.choosers[0].resolve(chosen);await tick();
 assert.equal(text(changed.chooseButton()),'选择账单');assert.equal(changed.chooseButton().props.disabled,true,'a replacement account must choose its own import destination');assert.equal(changed.previewCalls.length,0);
 changed.button('导入到账户').props.onClick();assert.equal(text(changed.chooseButton()),'选择账单（new-account）');assert.equal(changed.chooseButton().props.disabled,false);

 const same=page();await same.mount();same.begin();same.hide();same.show();await tick();same.choosers[0].resolve(chosen);await tick();
 assert.equal(same.previewCalls.length,1);assert.equal(same.previewCalls[0].financialAccountId,'old-account');assert.ok(same.button('确认整批导入'),'normal chooser hide/show must retain the preview workflow');
 const confirmation=deferred();same.setModalReply(()=>confirmation.promise);same.button('确认整批导入').props.onClick();same.button('确认整批导入').props.onClick();
 assert.equal(same.modals.length,1,'double submit taps must open a single whole-batch confirmation');confirmation.resolve({confirm:true});await tick();
 assert.equal(same.imports.length,1);assert.ok(same.imports[0].key);assert.equal(same.imports[0].input.financialAccountId,'old-account');

 const locked=page();await locked.mount();locked.begin();locked.chooseButton().props.onClick();assert.equal(locked.choosers.length,1,'duplicate choose taps must share one busy operation');
 locked.hide();locked.swap();locked.show();await tick();locked.begin();assert.equal(locked.choosers.length,2);
 locked.choosers[0].resolve(chosen);await tick();assert.equal(text(locked.chooseButton()),'正在处理…','old finally must not unlock the replacement account operation');
 locked.chooseButton().props.onClick();assert.equal(locked.choosers.length,2);locked.choosers[1].resolve(chosen);await tick();assert.equal(locked.previewCalls.length,1);assert.equal(locked.previewCalls[0].financialAccountId,'new-account');

 const detached=page();await detached.mount();const preparation=deferred();detached.setPreviewReply(()=>preparation.promise);detached.begin();detached.choosers[0].resolve(chosen);await tick();assert.equal(detached.previewCalls.length,1);
 detached.unmount();preparation.resolve({preview});await tick();assert.equal(detached.lateWrites(),0,'unmounted component must reject late preview and finally state writes');assert.equal(detached.toasts.length,0);

 const staleError=page();await staleError.mount();const loading=deferred();staleError.setLedgerReply(()=>loading.promise);staleError.show();staleError.hide();staleError.swap();staleError.setLedgerReply(null);staleError.show();await tick();loading.reject(Object.assign(new Error('old request'),{code:'FINANCE_SESSION_CHANGED'}));await tick();
 assert.doesNotMatch(text(staleError.render()),/FINANCE_SESSION_CHANGED|云端财务暂不可用/,'previous session errors must not replace the new ledger');assert.match(text(staleError.render()),/new-account/);

 const empty=page();empty.empty();await empty.mount();assert.match(text(empty.render()),/暂无金融账户/);assert.equal(empty.chooseButton().props.disabled,true);
 const offline=page();offline.setLedgerReply(()=>Promise.reject(Object.assign(new Error('offline'),{code:'FINANCE_REQUEST_FAILED'})));await offline.mount();assert.match(text(offline.render()),/云端财务暂不可用/);assert.equal(offline.chooseButton(),undefined);
 console.log('personal finance actual component replacement session/late callback/unmount/chooser hide-show/error/empty/duplicate-tap/whole-batch import checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
