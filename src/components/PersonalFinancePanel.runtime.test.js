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
  const antd=Object.fromEntries(['Alert','Button','Card','DatePicker','Drawer','Form','Input','Modal','Select','Space','Table','Tabs','Tag'].map(key=>[key,component(key)]));
  antd.Input.Password=component('Password');antd.Input.TextArea=component('TextArea');antd.DatePicker.RangePicker=component('RangePicker');antd.Form.Item=component('Form.Item');
  antd.Form.useForm=()=>[{validateFields:async()=>({label:'合成账户',provider:'synthetic',type:'bank',currency:'CNY',maskedIdentifier:'1234'}),resetFields:()=>{}}];
  antd.Modal.confirm=options=>{modals.push(options);return {destroy:()=>{}};};
  antd.message={success:value=>messages.push({type:'success',value,generation}),error:value=>messages.push({type:'error',value,generation}),warning:value=>messages.push({type:'warning',value,generation})};
  class FileReaderFake {
    constructor(){readers.push(this);}
    readAsDataURL(file){this.file=file;}
    abort(){this.aborted=true;}
  }
  const formValues={'asset-balance-form':{balance:'12.30',asOf:'2026-10-08T12:00',note:'fixture'},'finance-balance':{balance:'12.30',asOf:'2026-10-08T12:00'},'finance-annotation':{category:'Food',kind:'expense',principal:'',interest:'',fee:''}};
  const document={getElementById:id=>({id})};
  class FormDataFake {constructor(form){this.values=formValues[form.id]||{};}get(key){return this.values[key]??null;}}
  const window={addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn),setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
  const jsx=(type,props)=>({type,props:props||{}});
  const dependencies={react,'react/jsx-runtime':{jsx,jsxs:jsx},antd,dayjs,
    '../../shared/personal-finance/ledger.js':require('../../shared/personal-finance/ledger.js'),
    '../../shared/personal-finance/accountAnalytics.js':require('../../shared/personal-finance/accountAnalytics.js'),
    '../services/personalFinanceClient.mjs':{...actualHelpers,createPersonalFinanceClient:()=>client},
    '../services/desktopAuthorizationSession.mjs':{readDesktopAuthorizationSession:session},
  };
  const relatedCompiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'BillRelatedAccounts.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const relatedModule={exports:{}};new Function('require','module','exports',relatedCompiled)(n=>{assert.ok(Object.hasOwn(dependencies,n));return dependencies[n];},relatedModule,relatedModule.exports);dependencies['./BillRelatedAccounts']=relatedModule.exports;
  dependencies['../../shared/personal-finance/assetRegister.js']=require('../../shared/personal-finance/assetRegister');
  dependencies['./PersonalFinancePanel.css']={};
  dependencies['./personalFinancePresentation']=require('./personalFinancePresentation');
  const mortgageCompiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'MortgageAccounts.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mortgageModule={exports:{}};new Function('require','module','exports',mortgageCompiled)(n=>{assert.ok(Object.hasOwn(dependencies,n));return dependencies[n];},mortgageModule,mortgageModule.exports);dependencies['./MortgageAccounts']=mortgageModule.exports;
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
    tab:key=>{nodes(render()).find(node=>name(node)==='Tabs').props.onChange(key);render();},
    account:value=>{h.tab('import');const select=nodes(render()).find(node=>name(node)==='Select'&&node.props.placeholder==='自动按来源匹配账户（可更改）');assert.ok(select);select.props.onChange(value);render();},
    source:value=>{h.tab('import');nodes(render()).find(n=>name(n)==='Select'&&n.props['aria-label']==='本地账单来源').props.onChange(value);render();},
    mapping:value=>{const input=nodes(render()).find(node=>name(node)==='TextArea');assert.ok(input);input.props.onChange({target:{value}});render();},
    choose:filename=>{h.tab('import');const input=nodes(render()).find(node=>node.type==='input'&&node.props.type==='file');assert.ok(input);input.props.onChange({target:{files:[{name:filename,size:4}]}});render();},
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
for(const kind of ['balance','classification'])test(`actual TSX: failed ${kind} Modal onOk rejects so the dialog remains retryable`,async()=>{
  const h=await panel();const error=Object.assign(new Error('synthetic cloud rejection'),{code:'FINANCE_REQUEST_FAILED'});
  if(kind==='balance'){
    h.responses.set('createBalanceSnapshot',()=>Promise.reject(error));const table=h.table(props=>props['aria-label']==='账户收支与余额');assert.ok(table);
    const cell=table.props.columns.find(column=>column.title==='操作').render(null,table.props.dataSource[0]);nodes(cell).find(node=>name(node)==='Button'&&text(node)==='详情 / 核对余额').props.onClick();
    await h.click('核对余额');
  }else{
    h.tab('transactions');
    h.responses.set('annotateObservation',()=>Promise.reject(error));const table=h.table(props=>props.expandable?.expandedRowRender);assert.ok(table);
    const row=table.props.expandable.expandedRowRender(table.props.dataSource[0]);nodes(row).find(node=>name(node)==='Button'&&text(node)==='校正统计分类/还款拆分').props.onClick();
  }
  assert.equal(h.modals.length,1);await assert.rejects(h.modals[0].onOk());assert.equal(h.callsFor(kind==='balance'?'createBalanceSnapshot':'annotateObservation').length,1);assert.ok(h.messages.some(message=>message.type==='error'));h.unmount();
});
for(const boundary of ['session','unmount'])for(const operation of ['reader','preview','import','mailboxStatus','reload-error'])test(`actual TSX: ${operation} late callback cannot setState after ${boundary}`,async()=>{
  const h=await panel();const pending=deferred();
  if(operation==='reader')h.choose('late.csv');
  else if(operation==='preview'){await prepare(h);h.responses.set('previewFile',()=>pending.promise);h.click('解析预览');}
  else if(operation==='import'){await prepare(h);h.click('解析预览');await tick();h.responses.set('importFile',()=>pending.promise);h.click('确认整批导入');}
  else if(operation==='mailboxStatus'){h.responses.set('mailboxStatus',()=>pending.promise);h.tab('import');h.click('查看邮箱');}


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

test('actual TSX: explicit bank source preserves mappings, invalidates preview, and auto removes only source',async()=>{
  const h=await panel();await prepare(h,'statement.xlsx');h.mapping('{"amount":"value","date":"posted"}');
  h.source('spdb');h.click('解析预览');await tick();
  assert.deepEqual(h.callsFor('previewFile')[0].args[0].fieldMapping,{amount:'value',date:'posted',provider:'spdb'});
  h.source('auto');confirmationAbsent(h);h.click('解析预览');await tick();
  assert.deepEqual(h.callsFor('previewFile')[1].args[0].fieldMapping,{amount:'value',date:'posted'});
  h.unmount();
});
test('actual TSX: navigation preserves pending file but scopes tables to the active section',async()=>{
  const h=await panel();await prepare(h,'kept.csv');h.tab('overview');
  assert.ok(h.table(p=>p['aria-label']==='账户收支与余额'));
  assert.equal(h.table(p=>p.expandable?.expandedRowRender),undefined);
  h.tab('transactions');assert.ok(h.table(p=>p.expandable?.expandedRowRender));
  h.tab('import');h.click('解析预览');await tick();
  assert.equal(h.callsFor('previewFile')[0].args[0].filename,'kept.csv');
  h.unmount();
});


test('inferred association exposes evidence and submits an owner-scoped distinct decision',async()=>{
  const h=await panel();await tick();h.tab('transactions');
  const table=h.table(p=>p.expandable?.expandedRowRender),transaction={...table.props.dataSource[0],automaticAssociations:[{method:'unique_channel_funding',confidence:'inferred',observationIds:['platform-original','bank-original']}]};
  const expanded=table.props.expandable.expandedRowRender(transaction),component=nodes(expanded).find(n=>n.type?.name==='AutomaticFinanceAssociations');assert.ok(component);
  const rendered=component.type(component.props),button=nodes(rendered).find(n=>name(n)==='Button'&&text(n)==='撤销推算匹配');
  assert.ok(text(rendered).includes('推算匹配'));assert.ok(text(rendered).includes('候选双方唯一'));assert.ok(button&&!button.props.disabled);assert.equal(h.callsFor('createLink').length,0);
  button.props.onClick();await tick();await tick();assert.deepEqual(h.callsFor('createLink')[0].args[0],{expectedRevision:'3',link:{type:'distinct',observationIds:['platform-original','bank-original']}});
  const disabled=nodes(component.type({...component.props,busy:true})).find(n=>name(n)==='Button');assert.equal(disabled.props.disabled,true);
  const withdrawal=component.type({...component.props,transaction:{automaticAssociations:[{method:'wechat_withdrawal_net_receipt',confidence:'inferred',observationIds:['withdrawal','net-receipt']}]}});
  assert.ok(text(withdrawal).includes('\u51c0\u5230\u8d26\u989d'));assert.ok(text(withdrawal).includes('\u624b\u7eed\u8d39'));
  const precise=component.type({...component.props,transaction:{automaticAssociations:[{method:'wechat_withdrawal_net_receipt',confidence:'inferred',observationIds:['withdrawal','net-receipt'],evidence:{matchBasis:'precise_bank_receipt_time',bankReceiptDelaySeconds:1}}]}});
  assert.ok(text(precise).includes('2 \u79d2\u5185'));assert.ok(!text(precise).includes('\u6e20\u9053\u4e00\u81f4'));
  const product=component.type({...component.props,transaction:{automaticAssociations:[{method:'product_statement_time',confidence:'inferred',observationIds:['platform-product','bank-product']}]}});
  assert.ok(text(product).includes('\u7406\u8d22\u4ea7\u54c1'));assert.ok(text(product).includes('\u76f8\u90bb\u539f\u59cb\u65f6\u95f4'));
  const payer=component.type({...component.props,transaction:{automaticAssociations:[{method:'statement_payer_card',confidence:'inferred',observationIds:['debit-bank','credit-bank']}]}});
  assert.ok(text(payer).includes('\u4ed8\u6b3e\u5361\u5c3e\u53f7'));assert.ok(!text(payer).includes('\u6e20\u9053\u4e00\u81f4'));
  assert.equal(text(component.type({...component.props,transaction:{}})),'');h.unmount();
});
