'use strict';
// Synthetic fixtures. Execute the real TSX and its handlers; never contact a cloud service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const dayjs = require('dayjs');
const helpers = import('../services/personalFinanceClient.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const name = node => typeof node?.type === 'string' ? node.type : node?.type?.displayName;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree,...nodes(tree.props?.children),...nodes(tree.props?.items?.map(item => item.children))] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? ''
  : typeof tree === 'object' ? text(tree.props?.children) + text(tree.props?.items?.map(item => item.children)) : String(tree);
const preview = {provider:'synthetic',templateId:'canonical-v1',records:[{date:'2026-10-08',description:'合成账单',amountMinor:'123',status:'completed'}],errors:[],warnings:[]};
const fixtureLedger = () => ({revision:'3',accounts:['A','B'].map(id => ({id,label:'账户'+id,provider:'synthetic',type:'bank',currency:'CNY',maskedIdentifier:id==='A'?'1234':'5678',openingBalanceMinor:null,openingDate:null,status:'active'})),
  observations:[{id:'original',financialAccountId:'A',provider:'synthetic',sourceTransactionId:'synthetic-transaction',occurredAt:dayjs().format('YYYY-MM-DD')+'T10:00:00+08:00',date:dayjs().format('YYYY-MM-DD'),amountMinor:'123',currency:'CNY',direction:'debit',kind:'expense',description:'合成消费',counterparty:'合成商户',category:'Food',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{}}],links:[],annotations:[],balanceSnapshots:[],imports:[],legacyRecords:[]});

async function panel() {
  const actualHelpers = await helpers;
  const slots=[],pendingEffects=[],cleanups=[],readers=[],calls=[],writes=[],messages=[],modals=[],listeners=new Map(),timers=new Set();
  let cursor=0,unmounted=false,generation=0,uuid=0;
  const session = () => ({authorization:'Bearer synthetic-'+generation,authContext:{userId:'owner-'+generation,activeRole:'teacher',sessionId:'session-'+generation}});
  const responses = new Map();
  const defaults = {
    getLedger:()=>({ledger:fixtureLedger()}),previewFile:()=>({preview}),importFile:()=>({receipt:{importId:'synthetic-import'}}),
    mailboxStatus:()=>({mailbox:{address:'synthetic@example.test'}}),
    checkMailbox:()=>({mailbox:{messageCount:1,attachments:[{messageId:'message',attachmentId:'one',filename:'one.csv'},{messageId:'message',attachmentId:'two',filename:'two.pdf'}]}}),
    previewMailbox:()=>({preview}),importMailbox:()=>({receipt:{importId:'synthetic-mail-import'}}),
    createBalanceSnapshot:()=>({snapshot:{id:'synthetic-snapshot'}}),annotateObservation:()=>({annotation:{id:'synthetic-annotation'}}),
    createAccount:()=>({account:{id:'synthetic-account'}}),createLink:()=>({link:{id:'synthetic-link'}}),deleteLink:()=>({link:{id:'synthetic-link',status:'deleted'}}),
  };
  const client=Object.fromEntries(Object.keys(defaults).map(method=>[method,async(...args)=>{
    calls.push({method,args:structuredClone(args),generation});
    return responses.has(method) ? responses.get(method)(...args) : defaults[method](...args);
  }]));
  const slot=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return index;};
  const react={
    useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{writes.push({index,unmounted,generation});slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef:initial=>slots[slot({current:initial})],
    useMemo:fn=>{slot(null);return fn();},
    useCallback:fn=>{slot(null);return fn;},
    useEffect:(fn,deps)=>{const index=slot(null),old=slots[index];if(!old||!deps||deps.length!==old.deps?.length||deps.some((value,i)=>value!==old.deps[i])){slots[index]={deps};pendingEffects.push(()=>{old?.cleanup?.();const cleanup=fn();slots[index].cleanup=cleanup;cleanups.push(cleanup);});}},
  };
  const component=displayName=>Object.assign(function component(){},{displayName});
  const antd=Object.fromEntries(['Alert','Button','Card','DatePicker','Form','Input','Modal','Select','Space','Table','Tabs','Tag'].map(key=>[key,component(key)]));
  antd.Input.TextArea=component('TextArea');antd.DatePicker.RangePicker=component('RangePicker');antd.Form.Item=component('Form.Item');
  antd.Form.useForm=()=>[{validateFields:async()=>({label:'合成账户',provider:'synthetic',type:'bank',currency:'CNY',maskedIdentifier:'1234'}),resetFields:()=>{}}];
  antd.Modal.confirm=options=>{modals.push(options);return {destroy:()=>{}};};
  antd.message={success:value=>messages.push({type:'success',value,generation}),error:value=>messages.push({type:'error',value,generation}),warning:value=>messages.push({type:'warning',value,generation})};
  class FileReaderFake {
    constructor(){readers.push(this);}
    readAsDataURL(file){this.file=file;}
    abort(){this.aborted=true;}
  }
  const formValues={'finance-balance':{balance:'12.30',asOf:'2026-10-08T12:00'},'finance-annotation':{category:'Food',kind:'expense',principal:'',interest:'',fee:''}};
  const document={getElementById:id=>({id})};
  class FormDataFake {constructor(form){this.values=formValues[form.id]||{};}get(key){return this.values[key]??null;}}
  const window={addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn),setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
  const jsx=(type,props)=>({type,props:props||{}});
  const dependencies={react,'react/jsx-runtime':{jsx,jsxs:jsx},antd,dayjs,
    '../../shared/personal-finance/ledger.js':require('../../shared/personal-finance/ledger.js'),
    '../services/personalFinanceClient.mjs':{...actualHelpers,createPersonalFinanceClient:()=>client},
    '../services/desktopAuthorizationSession.mjs':{readDesktopAuthorizationSession:session},
  };
  const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'PersonalFinancePanel.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const loaded={exports:{}};
  new Function('require','module','exports','FileReader','crypto','document','FormData','window','setInterval','clearInterval',compiled)(moduleName=>{
    assert.ok(Object.hasOwn(dependencies,moduleName),'unexpected component dependency: '+moduleName);return dependencies[moduleName];
  },loaded,loaded.exports,FileReaderFake,{randomUUID:()=>`synthetic-uuid-${++uuid}`},document,FormDataFake,window,window.setInterval,window.clearInterval);
  const render=()=>{cursor=0;const tree=loaded.exports.default();pendingEffects.splice(0).forEach(fn=>fn());return tree;};
  const h={render,readers,calls,writes,messages,modals,responses,formValues,
    all:()=>nodes(render()),buttons:label=>nodes(render()).filter(node=>name(node)==='Button'&&text(node)===label),
    button:label=>h.buttons(label)[0],
    click:label=>{const button=h.button(label);assert.ok(button,'button exists: '+label);assert.ok(!button.props.disabled,'button enabled: '+label);return button.props.onClick();},
    account:value=>{const select=nodes(render()).find(node=>name(node)==='Select'&&node.props.placeholder==='本次账单所属账户');assert.ok(select);select.props.onChange(value);render();},
    mapping:value=>{const input=nodes(render()).find(node=>name(node)==='TextArea');assert.ok(input);input.props.onChange({target:{value}});render();},
    choose:filename=>{const input=nodes(render()).find(node=>node.type==='input'&&node.props.type==='file');assert.ok(input);input.props.onChange({target:{files:[{name:filename,size:4}]}});render();},
    finishRead:(index,base64)=>{const reader=readers[index];assert.ok(reader,'reader exists');reader.result='data:text/csv;base64,'+base64;reader.onload?.({target:reader});},
    callsFor:method=>calls.filter(call=>call.method===method),
    previewEnabled:()=>{const button=h.button('确认整批导入');return !!button&&!button.props.disabled;},
    swap:()=>{generation++;render();},
    unmount:()=>{unmounted=true;for(const cleanup of cleanups)cleanup?.();},
    lateWrites:()=>writes.filter(write=>write.unmounted).length,
    table:predicate=>nodes(render()).find(node=>name(node)==='Table'&&predicate(node.props)),
  };
  render();await tick();render();return h;
}
async function prepare(h,filename='A.csv',base64='QQ==') {h.account('A');h.choose(filename);h.finishRead(h.readers.length-1,base64);await tick();h.render();}
function confirmationAbsent(h) {assert.equal(h.previewEnabled(),false,'stale preview must not enable confirmation');}

test('actual TSX: later chosen B wins even when A FileReader finishes last',async()=>{
  const h=await panel();h.account('A');h.choose('A.csv');h.choose('B.csv');h.finishRead(1,'Qg==');await tick();h.finishRead(0,'QQ==');await tick();
  h.click('解析预览');await tick();assert.equal(h.callsFor('previewFile')[0].args[0].filename,'B.csv');assert.equal(h.callsFor('previewFile')[0].args[0].base64,'Qg==');h.unmount();
});
for(const change of ['file','account','mapping'])test(`actual TSX: pending A preview cannot activate confirmation after ${change} changes`,async()=>{
  const h=await panel();await prepare(h);const pending=deferred();h.responses.set('previewFile',()=>pending.promise);h.click('解析预览');
  if(change==='file'){h.choose('B.csv');h.finishRead(1,'Qg==');await tick();}else if(change==='account')h.account('B');else h.mapping('{"amount":"发生额"}');
  pending.resolve({preview});await tick();confirmationAbsent(h);h.unmount();
});
test('actual TSX: confirmed import uses precisely the reviewed file/account/mapping snapshot',async()=>{
  const h=await panel();await prepare(h);h.mapping('{"date":"posted","amount":"value","direction":"side"}');h.click('解析预览');await tick();assert.equal(h.previewEnabled(),true);
  const reviewed=structuredClone(h.callsFor('previewFile')[0].args[0]);h.click('确认整批导入');await tick();const submitted=h.callsFor('importFile')[0];assert.ok(submitted);
  for(const key of ['filename','base64','financialAccountId','fieldMapping'])assert.deepEqual(submitted.args[0][key],reviewed[key],key+' matches preview');assert.ok(submitted.args[1],'whole-batch import retains a stable idempotency key');h.unmount();
});
test('actual TSX: mailbox attachments have independently usable previews and import actions',async()=>{
  const h=await panel();h.account('A');h.click('检查账单附件');await tick();assert.equal(h.buttons('查看附件预览').length,2);assert.equal(h.buttons('确认导入此附件').every(button=>button.props.disabled),true);
  h.buttons('查看附件预览')[0].props.onClick();await tick();assert.equal(h.callsFor('previewMailbox')[0].args[0].messageId,'message');assert.equal(h.callsFor('previewMailbox')[0].args[0].attachmentId,'one');
  assert.equal(h.buttons('确认导入此附件')[0].props.disabled,false);assert.equal(h.buttons('确认导入此附件')[1].props.disabled,true);
  h.buttons('查看附件预览')[1].props.onClick();await tick();assert.equal(h.callsFor('previewMailbox')[1].args[0].attachmentId,'two');assert.equal(h.buttons('确认导入此附件')[0].props.disabled,false);assert.equal(h.buttons('确认导入此附件')[1].props.disabled,false);
  h.buttons('确认导入此附件')[0].props.onClick();await tick();const submitted=h.callsFor('importMailbox')[0];assert.equal(submitted.args[0].messageId,'message');assert.equal(submitted.args[0].attachmentId,'one');assert.equal(submitted.args[0].financialAccountId,'A');assert.ok(submitted.args[1]);h.unmount();
});
for(const kind of ['balance','classification'])test(`actual TSX: failed ${kind} Modal onOk rejects so the dialog remains retryable`,async()=>{
  const h=await panel();const error=Object.assign(new Error('synthetic cloud rejection'),{code:'FINANCE_REQUEST_FAILED'});
  if(kind==='balance'){
    h.responses.set('createBalanceSnapshot',()=>Promise.reject(error));const table=h.table(props=>props.columns?.some(column=>column.title==='校准余额'));assert.ok(table);
    const cell=table.props.columns.find(column=>column.title==='校准余额').render(null,table.props.dataSource[0]);nodes(cell).find(node=>name(node)==='Button').props.onClick();
  }else{
    h.responses.set('annotateObservation',()=>Promise.reject(error));const table=h.table(props=>props.expandable?.expandedRowRender);assert.ok(table);
    const row=table.props.expandable.expandedRowRender(table.props.dataSource[0]);nodes(row).find(node=>name(node)==='Button'&&text(node)==='校正统计分类/还款拆分').props.onClick();
  }
  assert.equal(h.modals.length,1);await assert.rejects(h.modals[0].onOk());assert.equal(h.callsFor(kind==='balance'?'createBalanceSnapshot':'annotateObservation').length,1);assert.ok(h.messages.some(message=>message.type==='error'));h.unmount();
});
for(const boundary of ['session','unmount'])for(const operation of ['reader','preview','import','mailboxStatus','checkMailbox','previewMailbox','reload-error'])test(`actual TSX: ${operation} late callback cannot setState after ${boundary}`,async()=>{
  const h=await panel();const pending=deferred();
  if(operation==='reader')h.choose('late.csv');
  else if(operation==='preview'){await prepare(h);h.responses.set('previewFile',()=>pending.promise);h.click('解析预览');}
  else if(operation==='import'){await prepare(h);h.click('解析预览');await tick();h.responses.set('importFile',()=>pending.promise);h.click('确认整批导入');}
  else if(operation==='mailboxStatus'){h.responses.set('mailboxStatus',()=>pending.promise);h.click('查看邮箱');}
  else if(operation==='checkMailbox'){h.responses.set('checkMailbox',()=>pending.promise);h.click('检查账单附件');}
  else if(operation==='previewMailbox'){h.click('检查账单附件');await tick();h.responses.set('previewMailbox',()=>pending.promise);h.buttons('查看附件预览')[0].props.onClick();}
  else {h.responses.set('getLedger',()=>{h.responses.delete('getLedger');return pending.promise;});h.click('刷新');}
  if(boundary==='unmount')h.unmount();else {h.swap();await tick();}
  const before=h.writes.length,messageCount=h.messages.length;
  if(operation==='reader')h.finishRead(0,'QQ==');else if(operation==='reload-error')pending.reject(Object.assign(new Error('old session request'),{code:'OLD_SESSION_FAILURE'}));
  else if(operation==='preview'||operation==='previewMailbox')pending.resolve({preview});
  else if(operation==='mailboxStatus')pending.resolve({mailbox:{address:'old-owner@example.test'}});
  else if(operation==='checkMailbox')pending.resolve({mailbox:{messageCount:1,attachments:[]}});
  else pending.resolve({receipt:{importId:'old-owner-import'}});
  await tick();assert.equal(h.writes.length,before,'late operation must not call a React state setter');assert.equal(h.messages.length,messageCount,'late operation must not notify the replacement session');if(boundary==='unmount')assert.equal(h.lateWrites(),0);else h.unmount();
});
