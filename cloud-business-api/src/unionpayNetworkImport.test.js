'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {parseBillFile}=require('./billFileDecoder'),{createPersonalFinanceRepository}=require('./personalFinanceRepository'),{buildFinanceView}=require('../../shared/personal-finance/ledger'),{syntheticCapture}=require('../../shared/personal-finance/fixtures/unionpayNetwork.synthetic');
const bank='\u62db\u5546\u94f6\u884c',huaxia='\u534e\u590f\u94f6\u884c',repayment='\u4fe1\u7528\u5361\u8fd8\u6b3e';
const accounts=[{id:'credit',provider:bank,maskedIdentifier:'1234',type:'credit_card',currency:'CNY',label:'Synthetic credit',status:'active',openingBalanceMinor:null,openingDate:null,balanceConvention:'signed'},{id:'cash',provider:huaxia,maskedIdentifier:'0900',type:'debit_card',currency:'CNY',label:'Synthetic cash',status:'active',openingBalanceMinor:null,openingDate:null,balanceConvention:'signed'}];
const input=capture=>({tenantId:'tenant',actor:{accountId:'alice',roles:['teacher']},filename:'synthetic-native-capture.json',base64:Buffer.from(JSON.stringify(capture),'utf8').toString('base64'),idempotencyKey:'import-network'});
function harness({accountRows=accounts,accountRace}={}){
 const ledger={accounts:structuredClone(accountRows),observations:[],imports:[],annotations:[],links:[],balanceSnapshots:[]},receipts=new Map();let revision=0,archives=0,accountWrites=0,reads=0;
 const q=async(sql,values)=>{
  if(sql.startsWith('SELECT data FROM business.personal_finance_accounts')){assert.deepEqual(values.slice(0,2),['tenant','alice']);reads++;const rows=accountRace?accountRace(reads,ledger.accounts):ledger.accounts;return {rows:rows.filter(a=>values.length<3||a.id===values[2]).map(data=>({data}))};}
  if(sql.startsWith('SELECT revision'))return {rows:[{revision:String(revision)}]};
  if(sql.startsWith('UPDATE business.personal_finance_owners'))return {rows:[{revision:String(++revision)}]};
  if(sql.startsWith('SELECT request_hash'))return {rows:receipts.has(values[2])?[receipts.get(values[2])]:[]};
  if(sql.startsWith('SELECT id,data FROM business.personal_finance_observations'))return {rows:ledger.observations.filter(o=>o.financialAccountId===values[2]&&o.sourceIdentity===values[3]).map(data=>({id:data.id,data}))};
  if(sql.endsWith(' AS ledger'))return {rows:[{ledger}]};
  if(sql.startsWith('INSERT INTO business.personal_finance_imports'))ledger.imports.push(JSON.parse(values[5]));
  if(sql.startsWith('INSERT INTO business.personal_finance_observations'))ledger.observations.push(JSON.parse(values[7]));
  if(sql.startsWith('INSERT INTO business.personal_finance_accounts'))accountWrites++;
  if(sql.startsWith('INSERT INTO business.personal_finance_receipts'))receipts.set(values[2],{request_hash:values[3],receipt:JSON.parse(values[4])});
  return {rows:[]};
 };
 const repo=createPersonalFinanceRepository({query:q,transaction:async work=>work(q),parseBillFile,archiveSource:async({fileHash})=>{archives++;return {id:'synthetic-source',fileHash};}});
 return {repo,ledger,counts:()=>({archives,accountWrites,reads})};
}
test('production worker decodes reviewed JSON and rejects bare or malformed extraction',async()=>{
 const buffer=Buffer.from(JSON.stringify(syntheticCapture([{frozen:true,amount:'26.00'},{refund:true,direction:'credit'}])),'utf8');const p=await parseBillFile({filename:'capture.json',buffer});assert.deepEqual(p.errors,[]);assert.equal(p.records.length,2);assert.equal(p.provider,'unionpay');assert.equal(p.records[0].direction,'neutral');assert.equal(p.records[1].kind,'refund');assert.equal(p.fileHash,crypto.createHash('sha256').update(buffer).digest('hex'));
 const bare=await parseBillFile({filename:'raw.json',buffer:Buffer.from(JSON.stringify({transactions:[{amountCents:2600}]}),'utf8')});assert.equal(bare.errors[0].code,'BILL_NETWORK_NATIVE_TEXT_REQUIRED');const malformed=await parseBillFile({filename:'broken.json',buffer:Buffer.from('{broken','utf8')});assert.equal(malformed.errors[0].code,'BILL_JSON_INVALID');
});
test('owner-scoped preview maps separate real card types and never creates a UnionPay wallet',async()=>{
 const h=harness(),p=await h.repo.previewImport(input(syntheticCapture([{title:repayment,direction:'credit'},{title:repayment,bank:huaxia,tail:'0900'}])));assert.deepEqual(p.errors,[]);assert.equal(p.records[0].bankAccount.type,'credit_card');assert.equal(p.records[1].bankAccount.type,'debit_card');assert.equal(p.accountResolution.account.id,'credit');assert.equal(p.bankAccountResolutions.length,2);assert(p.bankAccountResolutions.every(r=>r.status==='matched'));assert.equal(h.counts().accountWrites,0);assert.equal(h.counts().archives,0);
});
test('complete import preserves separate card memberships, originals and idempotency without posting duplicate money',async()=>{
 const h=harness(),request=input(syntheticCapture([{title:repayment,direction:'credit'},{title:repayment,bank:huaxia,tail:'0900'}]));const a=await h.repo.import(request);assert.equal(a.insertedCount,2);assert.equal(h.ledger.observations.length,2);assert.deepEqual(new Set(h.ledger.observations.map(o=>o.financialAccountId)),new Set(['cash','credit']));assert.equal(h.ledger.imports.length,2);assert.equal(Object.values(a.importMemberships).flat().length,2);assert.equal(h.counts().accountWrites,0);const originals=JSON.stringify(h.ledger.observations);const replay=await h.repo.import(request);assert.equal(replay.replayed,true);assert.equal(h.ledger.observations.length,2);assert.equal(JSON.stringify(h.ledger.observations),originals);const v=buildFinanceView(h.ledger);assert.equal(v.networkEvidence.summary.heldRows,2);assert.equal(v.review.transactionCount,2);assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');assert(v.transactions.every(t=>Object.keys(t.balanceEffects).length===0));
});
test('unknown card remains in preview with a specific identity issue and cannot be forced into a selected card',async()=>{
 const h=harness(),request={...input(syntheticCapture([{}, {tail:'9999'}])),financialAccountId:'credit'},p=await h.repo.previewImport(request);assert.equal(p.records.length,2);assert.equal(p.errors[0].code,'BILL_NETWORK_ACCOUNT_IDENTITY_REQUIRED');assert.equal(p.errors[0].cardTail,'9999');assert.equal(p.records[1].bankAccount,undefined);await assert.rejects(h.repo.import(request),/IMPORT_INVALID/);assert.equal(h.ledger.observations.length,0);assert.equal(h.counts().archives,0);assert.equal(h.counts().accountWrites,0);
});
test('a same-tail USD account or another owner cannot provide a CNY identity',async()=>{
 const h=harness({accountRows:[{...accounts[0],currency:'USD'}]});const p=await h.repo.previewImport(input(syntheticCapture()));assert.equal(p.errors[0].code,'BILL_NETWORK_ACCOUNT_IDENTITY_REQUIRED');await assert.rejects(h.repo.import(input(syntheticCapture())),/IMPORT_INVALID/);assert.equal(h.counts().accountWrites,0);
});
test('an account archived between preview and transaction cannot be silently recreated',async()=>{
 const h=harness({accountRace:(n,rows)=>n>=3?rows.map(a=>({...a,status:'archived'})):rows});await assert.rejects(h.repo.import(input(syntheticCapture())),/ACCOUNT_SELECTION_REQUIRED|BANK_ACCOUNT_SELECTION_REQUIRED/);assert.equal(h.counts().archives,0);assert.equal(h.counts().accountWrites,0);assert.equal(h.ledger.observations.length,0);
});
