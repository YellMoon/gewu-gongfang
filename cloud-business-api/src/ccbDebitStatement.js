'use strict';
const {createHash}=require('node:crypto');
const TITLE='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u4e2a\u4eba\u6d3b\u671f\u8d26\u6237\u5168\u90e8\u4ea4\u6613\u660e\u7ec6';
const COLUMNS=['\u5e8f\u53f7','\u6458\u8981','\u5e01\u522b','\u949e\u6c47','\u4ea4\u6613\u65e5\u671f','\u4ea4\u6613\u91d1\u989d','\u8d26\u6237\u4f59\u989d','\u4ea4\u6613\u5730\u70b9/\u9644\u8a00','\u5bf9\u65b9\u8d26\u53f7\u4e0e\u6237\u540d'];
const text=value=>String(value??'').normalize('NFKC').trim();
const compact=value=>text(value).replace(/\s/g,'');
const mask=value=>text(value).replace(/\d{12,}/g,n=>'****'+n.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
function date(value){
 const s=compact(value);if(!/^\d{8}$/.test(s))fail('BILL_BANK_ROW_INVALID');
 const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);
 if(Number.isNaN(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)fail('BILL_BANK_ROW_INVALID');
 return iso;
}
function money(value){
 const s=compact(value);if(!/^[+-]?(?:\d{1,24}|\d{1,3}(?:,\d{3}){1,7})\.\d{2}$/.test(s))fail('BILL_BANK_AMOUNT_INVALID');
 const unsigned=s.replace(/^[+-]/,'').replace(/,/g,''),[a,b]=unsigned.split('.');
 return (BigInt(a)*100n+BigInt(b))*(s.startsWith('-')?-1n:1n);
}
function classify(summary,delta){
 if(delta<0n&&['\u6d88\u8d39','\u8de8\u884cPOS\u6d88\u8d39','\u8de8\u884c\u5176\u4ed6\u6e20\u9053\u6d88\u8d39','\u0045\u0054\u0043\u901a\u884c\u8d39'].includes(summary))return 'expense';
 if(delta<0n&&['\u624b\u7eed\u8d39','\u6536\u8d39'].includes(summary))return 'fee';
 if(delta>0n&&['\u7ed3\u606f','\u5229\u606f\u5b58\u5165'].includes(summary))return 'income';
 if(delta>0n&&['\u9000\u6b3e','\u6d88\u8d39\u9000\u8d27','\u7ed3\u7b97\u9000\u6b3e'].includes(summary))return 'refund';
 return 'unknown';
}
function parseCcbDebitRows(rows){
 if(!Array.isArray(rows)||!rows.some(row=>Array.isArray(row)&&row.some(cell=>compact(cell)===TITLE)))return null;
 const result={provider:'ccb',templateId:'ccb-debit-v1',records:[],errors:[],warnings:[]};
 try{
  if(rows.some(row=>!Array.isArray(row)))fail('BILL_BANK_HEADER_INVALID');
  const header=rows.findIndex(row=>row.length===COLUMNS.length&&row.every((cell,i)=>compact(cell)===COLUMNS[i]));
  if(header<0)fail('BILL_BANK_HEADER_INVALID');
  const preamble=rows.slice(0,header).map(row=>row.map(compact).join('')).join('\n');
  const cards=[...preamble.matchAll(/\u5361\u53f7\/\u8d26\u53f7:(\d{12,24})(?!\d)/g)].map(m=>m[1]);
  const startMatches=[...preamble.matchAll(/\u8d77\u59cb\u65e5\u671f:(\d{8})(?!\d)/g)],endMatches=[...preamble.matchAll(/\u7ed3\u675f\u65e5\u671f:(\d{8})(?!\d)/g)];
  if(cards.length!==1||!/\u5ba2\u6237\u540d\u79f0:[^\n:]+/.test(preamble))fail('BILL_BANK_ACCOUNT_INVALID');
  if(startMatches.length!==1||endMatches.length!==1)fail('BILL_BANK_PERIOD_INVALID');
  const start=date(startMatches[0][1]),end=date(endMatches[0][1]),tail=cards[0].slice(-4);
  if(start>end)fail('BILL_BANK_PERIOD_INVALID');
  const totals=[...preamble.matchAll(/\u5f53\u524d\u65f6\u95f4\u6bb5\u6536\u652f\u91d1\u989d\u5408\u8ba1:\u4eba\u6c11\u5e01\u5143;\u603b\u652f\u51fa:([0-9,.]+)\u603b\u6536\u5165:([0-9,.]+)/g)];
  if(totals.length!==1)fail('BILL_BANK_TOTAL_INVALID');
  const expectedOut=money(totals[0][1]),expectedIn=money(totals[0][2]);
  let previousBalance=null,previousDate='',income=0n,expense=0n,sequence=0;
  const seen=new Map(),counterpartFingerprints=[];
  for(const row of rows.slice(header+1)){
   if(row.every(cell=>text(cell)===''))continue;
   if(row.length!==COLUMNS.length||!/^[1-9]\d*$/.test(compact(row[0]))||Number(row[0])!==++sequence)fail('BILL_BANK_COUNT_INVALID');
   const cells=row.map(text),summary=cells[1],stamp=date(cells[4]),delta=money(cells[5]),balance=money(cells[6]);
   if(compact(cells[2])!=='\u4eba\u6c11\u5e01\u5143')fail('BILL_BANK_CURRENCY_UNSUPPORTED');
   if(compact(cells[3])!=='\u949e')fail('BILL_BANK_SUBACCOUNT_UNSUPPORTED');
   if(!summary||stamp<start||stamp>end||stamp<previousDate)fail('BILL_BANK_ORDER_INVALID');
   if(delta===0n)fail('BILL_BANK_ZERO_UNSUPPORTED');
   if(previousBalance!==null&&previousBalance+delta!==balance)fail('BILL_BANK_RECONCILIATION_FAILED');
   previousBalance=balance;previousDate=stamp;income+=delta>0n?delta:0n;expense+=delta<0n?-delta:0n;
   const kind=classify(compact(summary),delta),other=cells[8].match(/^([\d*]{4,24})\/(.*)$/);
   const counterparty=other?other[2]:cells[8]||cells[7];
   const rawFields={...Object.fromEntries(COLUMNS.map((name,i)=>[name,mask(cells[i])])),dateBasis:'transaction_date',timePrecision:'day'};
   if(other)rawFields['\u5bf9\u65b9\u8d26\u53f7']=mask(other[1]);
   // Printing dates and sequence numbers change across overlapping requests.
   // Business fields and the running balance identify each original cash row.
   const key=JSON.stringify([tail,stamp,String(delta),String(balance),summary,cells[7],cells[8]]);
   const ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   result.records.push({sourceTransactionId:'ccb-debit:'+createHash('sha256').update(key+':'+ordinal,'utf8').digest('hex'),date:stamp,occurredAt:stamp+'T23:59:59+08:00',amountMinor:String(delta<0n?-delta:delta),currency:'CNY',direction:delta<0n?'debit':'credit',kind,status:'completed',description:mask(summary+(cells[7]&&cells[7]!==summary?' '+cells[7]:'')),counterparty:mask(counterparty),category:kind==='income'?'\u5229\u606f\u6536\u5165':kind==='refund'?'\u9000\u6b3e':kind==='fee'?'\u624b\u7eed\u8d39':kind==='expense'?'\u6d88\u8d39':'\u5f85\u6838\u5bf9',paymentChannel:'\u5efa\u8bbe\u94f6\u884c\u50a8\u84c4\u5361('+tail+')',paymentAccountHint:'',balanceMinor:String(balance),relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null,rawFields,statementFlow:{schema:'ccb-debit-v1',sequence,incomeMinor:String(delta>0n?delta:0n),expenseMinor:String(delta<0n?-delta:0n),balanceKind:'total',periodStart:start,periodEnd:end,timePrecision:'day',openingBeforeFirstMinor:sequence===1?String(balance-delta):null}});
   if(other&&/^\d{12,24}$/.test(other[1]))counterpartFingerprints.push({sourceTransactionId:result.records.at(-1).sourceTransactionId,fingerprint:createHash('sha256').update('bank-account-number-v1:'+other[1],'utf8').digest('hex'),maskedIdentifier:other[1].slice(-4)});
  }
  if(!sequence)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  if(income!==expectedIn||expense!==expectedOut)fail('BILL_BANK_TOTAL_INVALID');
  result.accountIdentity={provider:'\u5efa\u8bbe\u94f6\u884c',type:'debit_card',maskedIdentifier:tail,currency:'CNY'};
  result.statementAccountIdentities={schema:'bank-account-identities-v1',ownAccountFingerprint:createHash('sha256').update('bank-account-number-v1:'+cards[0],'utf8').digest('hex'),ownMaskedIdentifier:tail,counterpartFingerprints};
  const ownerNames=rows.slice(0,header).flat().map(compact).filter(v=>/^\u5ba2\u6237\u540d\u79f0:[^:]+$/.test(v)).map(v=>v.slice(v.indexOf(':')+1));
  if(ownerNames.length===1){const metadata={schema:'bank-statement-owner-v1',fullName:ownerNames[0]};try{require('../../shared/personal-finance/statementOwnership').validateStatementOwner(metadata);result.statementOwner=metadata;}catch{}}
 }catch(error){
  result.records=[];delete result.accountIdentity;delete result.statementAccountIdentities;
  result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'CCB debit statement columns, dates, totals or running balances failed validation'});
 }
 return result;
}
module.exports={parseCcbDebitRows};
