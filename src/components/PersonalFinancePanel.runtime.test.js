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
  ? [tree,...nodes(tree.props?.children),...nodes(tree.props?.title),...nodes(tree.props?.items?.map(item => item.children))] : [];
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
  const dependencies={'./TuitionBillReview':component('TuitionBillReview'),react,'react/jsx-runtime':{jsx,jsxs:jsx},antd,dayjs,
    '../services/personalFinanceAnalysisClient.mjs':{financeWorkerAvailable:()=>false},
    '../../shared/personal-finance/ledger.js':require('../../shared/personal-finance/ledger.js'),
    '../../shared/personal-finance/accountAnalytics.js':require('../../shared/personal-finance/accountAnalytics.js'),
    '../../shared/personal-finance/counterpartySettlements.js':require('../../shared/personal-finance/counterpartySettlements.js'),
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
test('tuition review opens the candidate editor with current source scope and never creates payments',async()=>{
 const h=await panel();h.click('\u8d26\u5355\u5b66\u8d39\u6838\u5bf9');const editor=h.all().find(n=>name(n)==='TuitionBillReview');assert(editor);assert.equal(editor.props.revision,'3');assert.equal(editor.props.transactions.length,1);assert.equal(h.calls.length,2,'opening the editor does not submit financial writes');editor.props.onClose();assert(!h.all().some(n=>name(n)==='TuitionBillReview'));h.unmount();
});
function confirmationAbsent(h) {assert.equal(h.previewEnabled(),false,'stale preview must not enable confirmation');}

test('account combinations cross groups and detail/search controls preserve the chosen scope',async()=>{
 const h=await panel(),ledger=fixtureLedger();ledger.accounts[1].type='credit_card';ledger.accounts.push({...ledger.accounts[0],id:'C',label:'Investment C',type:'investment'});
 h.responses.set('getLedger',()=>({ledger}));await h.click('\u5237\u65b0');await tick();
 const scope=()=>h.all().find(n=>name(n)==='Select'&&n.props['aria-label']==='\u7edf\u8ba1\u8d26\u6237').props.value;
 const check=id=>h.all().find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props['aria-label'].endsWith(id));
 check('A').props.onChange({target:{checked:true}});check('B').props.onChange({target:{checked:true}});check('C').props.onChange({target:{checked:true}});
 assert.deepEqual(scope(),['A','B','C']);
 h.all().find(n=>name(n)==='Input'&&n.props['aria-label']==='\u67e5\u627e\u8d26\u6237').props.onChange({target:{value:'Investment'}});
 assert.deepEqual(scope(),['A','B','C']);h.click('\u8be6\u60c5');assert.deepEqual(scope(),['A','B','C']);
 h.click('\u5168\u90e8\u8d26\u6237');assert.deepEqual(scope(),[]);assert.equal(h.callsFor('createBalanceSnapshot').length,0);h.unmount();
});

test('an explicitly selected currency with no transactions never falls back to another currency',async()=>{
 const h=await panel(),ledger=fixtureLedger();ledger.accounts.push({...ledger.accounts[0],id:'USD',label:'USD account',currency:'USD'});h.responses.set('getLedger',()=>({ledger}));await h.click('\u5237\u65b0');await tick();
 const currency=()=>h.all().find(n=>name(n)==='Select'&&n.props['aria-label']==='\u7edf\u8ba1\u5e01\u79cd');currency().props.onChange('USD');assert.equal(currency().props.value,'USD');
 assert.equal(text(h.all().find(n=>n.props['data-testid']==='expense-total')),'0.00');
 assert(text(h.render()).includes('USD'));h.unmount();
});

test('trend drilldown restores the original dates while retaining account and currency filters',async()=>{
 const h=await panel();h.click('\u672c\u6708\u81f3\u4eca\u5929');h.all().find(n=>name(n)==='Select'&&n.props['aria-label']==='\u7edf\u8ba1\u8d26\u6237').props.onChange(['A']);
 const dates=()=>h.all().find(n=>name(n)==='RangePicker').props.value.map(v=>v.format('YYYY-MM-DD'));
 const original=dates(),trend=h.all().find(n=>n.type?.name==='FinanceTrend');trend.props.onSelect(dayjs().format('YYYY-MM-DD'));assert.equal(dates()[0],dates()[1]);
 h.click('\u8fd4\u56de\u539f\u7edf\u8ba1\u671f\u95f4');assert.deepEqual(dates(),original);assert.deepEqual(h.all().find(n=>name(n)==='Select'&&n.props['aria-label']==='\u7edf\u8ba1\u8d26\u6237').props.value,['A']);h.unmount();
});

test('review is reachable independently from import and preserves the pending file preview',async()=>{
 const h=await panel();await prepare(h);h.click('\u89e3\u6790\u9884\u89c8');await tick();assert.equal(h.previewEnabled(),true);h.tab('review');
 assert(text(h.render()).includes('\u8d26\u6237\u8bca\u65ad'));assert(!h.button('\u9009\u62e9\u8d26\u5355\u6587\u4ef6'));h.tab('import');assert.equal(h.previewEnabled(),true);h.unmount();
});

test('full-ledger review keeps an excluded historical transaction as a transaction instead of an account issue',async()=>{
 const h=await panel(),ledger=fixtureLedger();ledger.observations[0].kind='unknown';h.responses.set('getLedger',()=>({ledger}));await h.click('\u5237\u65b0');await tick();
 h.all().find(n=>name(n)==='RangePicker').props.onChange([dayjs('2000-01-01'),dayjs('2000-01-31')]);h.tab('review');const table=h.table(p=>p.columns?.some(c=>c.dataIndex==='reason'));assert(table.props.dataSource.some(g=>g.transactionIds.includes('original')));assert(!table.props.dataSource.some(g=>g.transactionIds.includes('account:A')));assert(text(h.render()).includes('\u5168\u8d26\u672c'));h.unmount();
});

test('fund valuation displays only the selected daily range and preserves incomplete cohort evidence',async()=>{
 const h=await panel();h.tab('funds');const n=h.all().find(n=>n.type?.name==='FinanceFundValuations'),v={financialAccountId:'C',fundCode:'123456',fundName:'Synthetic',currency:'CNY',complete:false,portfolioCoverageConfirmed:false,balanceMinor:null,cumulativeNetReturnMinor:null,unitsInferred:true,issues:[{reason:'official_nav_unavailable'}],daily:[{date:'2026-07-01',unitNav:'1.0000',units:'100.123400',balanceMinor:'10012',netReturnMinor:'0',feeMinor:'0'},{date:'2026-07-02',unitNav:'1.0010',units:'100.123400',balanceMinor:'10022',netReturnMinor:'10',feeMinor:'0'}]};const before=JSON.stringify(v),tree=n.type({valuations:[v],startDate:'2026-07-02',endDate:'2026-07-02'}),table=nodes(tree).find(n=>name(n)==='Table');
 assert.equal(table.props.dataSource[0],v);const daily=nodes(table.props.expandable.expandedRowRender(v)).find(n=>name(n)==='Table');assert.deepEqual(daily.props.dataSource.map(d=>d.date),['2026-07-02']);assert.equal(daily.props.dataSource[0].units,'100.123400');assert.equal(JSON.stringify(v),before);assert(!text(tree).includes('0.00'));h.unmount();
});

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
  else if(operation==='mailboxStatus'){h.responses.set('mailboxStatus',()=>{h.responses.delete('mailboxStatus');return pending.promise;});h.tab('import');h.click('查看邮箱');}


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


test('mortgage editor preserves evidence bases and treats changed references as unverified',async()=>{
 const actualHelpers=await helpers,slots=[],saved=[],errors=[];let cursor=0,values={};
 const form={resetFields:()=>{values={};},setFieldsValue:v=>{values=structuredClone(v);},validateFields:async()=>values};
 const react={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=v;}];}};
 const component=displayName=>Object.assign(function(){},{displayName});
 const antd=Object.fromEntries(['Alert','Button','Card','Drawer','Form','Input','Modal','Select','Space','Table','Tag'].map(n=>[n,component(n)]));
 antd.Form.Item=component('Form.Item');antd.Form.List=component('Form.List');antd.Form.useForm=()=>[form];antd.Form.useWatch=k=>values[k];antd.message={error:e=>errors.push(e)};
 const jsx=(type,props)=>({type,props:props||{}}),dependencies={react,'react/jsx-runtime':{jsx,jsxs:jsx},antd,'../services/personalFinanceClient.mjs':actualHelpers};
 const loaded={exports:{}},compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'MortgageAccounts.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(n=>dependencies[n],loaded,loaded.exports);
   assert.equal(loaded.exports.mortgageBasis('actual_bank_statement'),'\u94f6\u884c\u8fd8\u6b3e\u8bb0\u5f55');
   assert.equal(loaded.exports.mortgageActual({status:'actual_bank_statement',confidence:'actual_bank_statement'}),true);
   assert.equal(loaded.exports.mortgageActual({status:'estimated',confidence:'actual_bank_statement'}),false);
 const mortgage={schema:'mortgage-v1',loanType:'commercial',sourceAccountId:'funding',statementReference:'1234',originalPrincipalMinor:'296000000',annualRatePpm:'33000',minimumAnnualRatePpm:'33000',repricingTerms:{schema:'mortgage-repricing-terms-v1',basis:'owner_confirmed_natural_year',initialMonths:[1],cycleChanges:[{effectiveDate:'2024-12-11',months:[1,4,7,10]}],spreadChanges:[{effectiveDate:'2024-10-25',spreadBasisPoints:-30}],confirmedAt:'2026-10-29T00:00:00+08:00'},termMonths:360,firstPaymentDate:'2022-09-20',recentSplit:{month:'2026-09',principalMinor:'364699',interestMinor:'464473',monthBasis:'latest_matching_statement'},prepayments:[{date:'2025-12-03',amountMinor:'100000000',amountBasis:'total_payment',mode:'reduce_payment_keep_term'}]};
 const account={id:'mortgage',label:'Mortgage',type:'loan',mortgage},models=[{financialAccountId:'mortgage',label:'Mortgage',prepayments:[]}];
 const render=()=>{cursor=0;return loaded.exports.default({models,accounts:[account],busy:false,onSave:async(a,e)=>{saved.push({a:structuredClone(a),existing:e});return a;}});};
 const modal=()=>nodes(render()).find(n=>name(n)==='Modal');
 const edit=()=>{const tree=render(),card=nodes(tree).find(n=>name(n)==='Card'&&n.props.size==='small');nodes(card.props.extra).filter(n=>name(n)==='Button')[1].props.onClick();render();};
 edit();assert.equal(values.prepayments[0].amountBasis,'total_payment');modal().props.onOk();await tick();assert.deepEqual(errors,[]);
 assert.deepEqual(saved[0].a.mortgage,mortgage,'editing unrelated fields preserves total-payment and automatic-period evidence');assert.equal(saved[0].existing,account);
 edit();values.recentPrincipal='3647.00';modal().props.onOk();await tick();
 assert.deepEqual(saved[1].a.mortgage.recentSplit,{month:null,monthBasis:'latest_matching_statement',principalMinor:'364700',interestMinor:'464473'});
 assert.equal(saved[1].a.mortgage.prepayments[0].amountBasis,'total_payment');assert.equal(saved[1].a.mortgage.minimumAnnualRatePpm,'33000');assert.deepEqual(saved[1].a.mortgage.repricingTerms,mortgage.repricingTerms);assert.notEqual(saved[1].a.mortgage.repricingTerms,mortgage.repricingTerms);assert.deepEqual(account.mortgage,mortgage);assert.deepEqual(errors,[]);
 const {validateMortgage}=require('../../shared/personal-finance/mortgages');assert.doesNotThrow(()=>validateMortgage(saved[0].a.mortgage));
 edit();values.annualRate='3.2';modal().props.onOk();await tick();assert.equal(saved[2].a.mortgage.minimumAnnualRatePpm,'33000');assert.throws(()=>validateMortgage(saved[2].a.mortgage));
 edit();values.loanType='provident';modal().props.onOk();await tick();assert.equal(saved[3].a.mortgage.minimumAnnualRatePpm,undefined);assert.equal(saved[3].a.mortgage.repricingTerms,undefined);assert.deepEqual(account.mortgage,mortgage);
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
  const network=component.type({...component.props,transaction:{automaticAssociations:[{method:'unique_card_funding',confidence:'inferred',observationIds:['network-platform','network-bank']}]}});
  assert.ok(text(network).includes('\u672a\u62ab\u9732\u652f\u4ed8\u5e73\u53f0'));assert.ok(text(network).includes('\u5019\u9009\u53cc\u65b9\u552f\u4e00'));assert.ok(!text(network).includes('\u6e20\u9053\u4e00\u81f4'));assert.ok(nodes(network).find(n=>name(n)==='Button'&&text(n)==='\u64a4\u9500\u63a8\u7b97\u5339\u914d'));
  const native=component.type({...component.props,transaction:{automaticAssociations:[{method:'inferred_native_credit_repayment_pair',confidence:'inferred',observationIds:['native-payer','native-credit']}]}});
  assert.ok(text(native).includes('\u539f\u4ef6\u672a\u62ab\u9732\u5bf9\u624b\u5361\u53f7'));assert.ok(text(native).includes('\u672a\u4f7f\u7528\u5206\u949f\u65f6\u95f4\u5224\u65ad'));
  const nativeUndo=nodes(native).find(n=>name(n)==='Button'&&text(n)==='\u64a4\u9500\u63a8\u7b97\u5339\u914d');assert.ok(nativeUndo&&!nativeUndo.props.disabled);
  nativeUndo.props.onClick();await tick();await tick();assert.deepEqual(h.callsFor('createLink').at(-1).args[0],{expectedRevision:'3',link:{type:'distinct',observationIds:['native-payer','native-credit']}});
  assert.equal(text(component.type({...component.props,transaction:{}})),'');h.unmount();
});

test('whole-batch reversal submits every original in one scoped decision',async()=>{
 const h=await panel();await tick();h.tab('transactions');
 const table=h.table(p=>p.expandable?.expandedRowRender),ids=['p1','p2','b1','b2'],transaction={...table.props.dataSource[0],automaticAssociations:[{id:'group',method:'balanced_channel_group',confidence:'inferred',observationIds:ids,evidence:{count:2}}]};
 const component=nodes(table.props.expandable.expandedRowRender(transaction)).find(n=>n.type?.name==='AutomaticFinanceAssociations'),rendered=component.type(component.props);
 assert.ok(text(rendered).includes('\u7ec4\u5185\u94f6\u884c\u5e8f\u53f7\u5bf9\u5e94\u5173\u7cfb\u672a\u786e\u5b9a'));
 const button=nodes(rendered).find(n=>name(n)==='Button'&&text(n)==='\u64a4\u9500\u6574\u7ec4\u6838\u5bf9');assert.ok(button&&!button.props.disabled);assert.equal(h.callsFor('createLink').length,0);
 button.props.onClick();await tick();await tick();assert.deepEqual(h.callsFor('createLink')[0].args[0],{expectedRevision:'3',link:{type:'group_distinct',observationIds:ids}});
 assert.equal(nodes(component.type({...component.props,busy:true})).find(n=>name(n)==='Button').props.disabled,true);h.unmount();
});
test('restore automatic classification submits an empty patch for exactly the annotated original',async()=>{
 const h=await panel();await tick();h.tab('transactions');const table=h.table(p=>p.expandable?.expandedRowRender),t=table.props.dataSource[0],o=t.sources[0],expanded=table.props.expandable.expandedRowRender({...t,appliedAnnotations:[{id:'annotation',observationId:o.id,revision:'2',patch:{kind:'transfer'}}]});
 const button=nodes(expanded).find(n=>name(n)==='Button'&&text(n)==='\u6062\u590d\u81ea\u52a8\u5206\u7c7b');assert(button);button.props.onClick();await tick();await tick();assert.deepEqual(h.callsFor('annotateObservation')[0].args,[o.id,{patch:{},expectedRevision:'3'}]);h.unmount();
});
test('counterparty field submits purpose only for an original neutral receipt and allows clearing without inventing direction',async()=>{
 const h=await panel(),ledger=fixtureLedger(),s=ledger.observations[0];Object.assign(ledger.accounts[0],{provider:'alipay',type:'wallet'});ledger.accounts.push({id:'family',label:'Family collections',provider:'manual',type:'receivable',currency:'CNY',status:'active',balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,counterpartySettlement:{schema:'counterparty-settlement-v1',counterparty:'Relative'}});
 Object.assign(s,{provider:'alipay',kind:'transfer',direction:'neutral',sourceTransactionId:'shop-order',relatedReference:'T200P825758715263451',rawFields:{'\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u5546\u54c1\u8bf4\u660e':s.description,'\u4ea4\u6613\u8ba2\u5355\u53f7':'shop-order','\u5546\u5bb6\u8ba2\u5355\u53f7':'T200P825758715263451','\u91d1\u989d':'1.23'}});
 const p=require('../../shared/personal-finance/alipayWalletStatement').parseAlipayWalletBalanceRows([['shop-order',s.date+' 12:00:00','\u4ea4\u6613\u4ed8\u6b3e','1.23','','1.23','\u652f\u4ed8\u5b9d','']]).records[0];ledger.observations.push({...p,id:'proof',sourceIdentity:'proof',sourceVersionOrdinal:1,financialAccountId:'A',provider:'alipay',importId:'native-wallet-source'});h.responses.set('getLedger',()=>({ledger}));await h.click('\u5237\u65b0');await tick();h.tab('transactions');
 const table=h.table(p=>p.expandable?.expandedRowRender),row=table.props.expandable.expandedRowRender(table.props.dataSource[0]);nodes(row).find(n=>name(n)==='Button'&&text(n)==='\u6821\u6b63\u7edf\u8ba1\u5206\u7c7b/\u8fd8\u6b3e\u62c6\u5206').props.onClick();const modal=h.modals[0],field=nodes(modal.content).find(n=>n.type==='select'&&n.props.name==='settlementAccountId');assert(field);assert.equal(field.props.defaultValue,'');assert(text(modal.content).includes(s.date));assert(text(modal.content).includes('Family collections'));
 Object.assign(h.formValues['finance-annotation'],{kind:'transfer',category:'Family collection',settlementAccountId:'family'});await modal.onOk();const submitted=h.callsFor('annotateObservation').at(-1);assert.equal(submitted.args[0],s.id);assert.deepEqual(submitted.args[1].patch,{kind:'transfer',category:'Family collection',settlementAccountId:'family'});assert(!Object.hasOwn(submitted.args[1].patch,'direction'));assert.equal(submitted.args[1].expectedRevision,'3');
 h.formValues['finance-annotation'].settlementAccountId='';await modal.onOk();assert.equal(h.callsFor('annotateObservation').at(-1).args[1].patch.settlementAccountId,null);
 h.formValues['finance-annotation'].settlementAccountId='family';h.formValues['finance-annotation'].kind='income';const count=h.callsFor('annotateObservation').length;await assert.rejects(modal.onOk());assert.equal(h.callsFor('annotateObservation').length,count);h.unmount();
});
test('native evidence with multiple old originals exposes a scoped undo and states differing original dates honestly',async()=>{
 const h=await panel();h.tab('transactions');const table=h.table(p=>p.expandable?.expandedRowRender),association={method:'unionpay_native_existing_cash_evidence',confidence:'inferred',observationIds:['bank-original','platform-original','native-original'],evidence:{networkObservationIds:['native-original'],existingObservationIds:['bank-original','platform-original'],dateEvidence:[{nativeVisibleDate:'2024-09-24',bankPostingDate:'2024-09-25',originalBankTradeDate:'2024-06-26'}]}};const raw=JSON.stringify(association),expanded=table.props.expandable.expandedRowRender({...table.props.dataSource[0],automaticAssociations:[association]}),component=nodes(expanded).find(n=>n.type?.name==='AutomaticFinanceAssociations'),rendered=component.type(component.props),button=nodes(rendered).find(n=>name(n)==='Button'&&text(n)==='\u64a4\u9500\u63a8\u7b97\u5339\u914d');assert(button);assert(text(rendered).includes('2024-09-24'));assert(text(rendered).includes('2024-09-25'));assert(text(rendered).includes('2024-06-26'));assert(!text(rendered).includes('\u65e5\u671f\u3001\u91d1\u989d\u548c\u6e20\u9053\u4e00\u81f4'));button.props.onClick();await tick();await tick();assert.deepEqual(h.callsFor('createLink')[0].args[0],{expectedRevision:'3',link:{type:'distinct',observationIds:['native-original','bank-original']}});assert.equal(JSON.stringify(association),raw);const container=nodes(rendered).find(n=>name(n)==='Space');assert.equal(container.props.style.display,'flex');assert.equal(container.props.style.maxWidth,'calc(100vw - 120px)');h.unmount();
});
