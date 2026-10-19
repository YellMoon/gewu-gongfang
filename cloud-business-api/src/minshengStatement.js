'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const clean=v=>String(v).replace(/\s/g,'');
const mask=v=>String(v).replace(/\d{12,}/g,v=>'****'+v.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
function minor(value){const s=clean(value).replace(/,/g,'');if(!/^-?\d+\.\d{2}$/.test(s))fail('BILL_BANK_AMOUNT_INVALID');const[a,b]=s.replace('-','').split('.');return(BigInt(a)*100n+BigInt(b))*(s.startsWith('-')?-1n:1n);}
function textLines(html){return html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:td|th|tr|p|div|table)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,s)=>{const n=s[0].toLowerCase()==='x'?parseInt(s.slice(1),16):Number(s);return n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi,s=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[s.toLowerCase()])).split('\n').map(clean).filter(Boolean);}
function parseMinshengHtml(html){
 const lines=textLines(html),text=lines.join('\n');
 if(!/\u6c11\u751f\u4fe1\u7528\u5361/.test(text)||!text.includes('StatementDate')||!text.includes('LAST4DIGITS'))return null;
 const result={provider:'minsheng',templateId:'minsheng-credit-v1',records:[],errors:[],warnings:[]};
 try{
  const idx=lines.indexOf('StatementDate'),statementDate=lines[idx+1]?.replace(/\//g,'-');if(!validDate(statementDate))fail('BILL_BANK_PERIOD_INVALID');
  const heading=lines.findIndex(s=>s.startsWith('\u672c\u671f\u8d26\u5355\u4ea4\u6613\u660e\u7ec6'));
  if(heading<0)fail('BILL_BANK_HEADER_INVALID');
  const interest=lines.indexOf('Interest',heading),totals=lines.slice(interest+1,interest+7).map(minor);
  if(totals.length!==6||totals[0]!==totals[1]-totals[2]+totals[3]+totals[4]+totals[5]||totals[4]!==0n||totals[5]!==0n)fail('BILL_BANK_TOTAL_INVALID');
  const head=lines.indexOf('LAST4DIGITS',heading),end=lines.findIndex((s,i)=>i>head&&s.startsWith('*\u4ea4\u6613\u6458\u8981'));
  if(head<0||end<0)fail('BILL_BANK_HEADER_INVALID');
  let kind=null,charges=0n,payments=0n,refunds=0n;const seen=new Map(),tails=new Set();
  const date=md=>{if(!/^\d{2}\/\d{2}$/.test(md))fail('BILL_BANK_ROW_INVALID');let year=Number(statementDate.slice(0,4));if(md.replace('/','-')>statementDate.slice(5))year--;const d=year+'-'+md.replace('/','-');if(!validDate(d)||(Date.parse(statementDate)-Date.parse(d))/86400000>370)fail('BILL_BANK_ROW_INVALID');return d;};
  for(let i=head+1;i<end;){
   if(lines[i]==='\u6d88\u8d39'){kind='expense';i++;continue;}
   if(lines[i]==='\u8fd8\u6b3e'){kind='debt_payment';i++;continue;}
   if(lines[i]==='\u9000\u8d27'){kind='refund';i++;continue;}
   if(!kind||i+4>=end)fail('BILL_BANK_ROW_INVALID');
   const tradeDate=date(lines[i]),posted=date(lines[i+1]),description=mask(lines[i+2]),amount=minor(lines[i+3]),tail=lines[i+4];i+=5;
   if(!/^\d{4}$/.test(tail)||posted<tradeDate||kind==='expense'&&amount<0n||kind!=='expense'&&amount>0n)fail('BILL_BANK_ROW_INVALID');tails.add(tail);
   const key=JSON.stringify([tail,tradeDate,posted,description,amount.toString(),kind]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   const abs=amount<0n?-amount:amount;
   result.records.push({sourceTransactionId:'minsheng:'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:tradeDate,occurredAt:posted+'T23:59:59+08:00',amountMinor:abs.toString(),currency:'CNY',direction:amount<0n?'credit':'debit',kind,status:'completed',description,counterparty:description,category:kind==='expense'?'\u5f85\u5206\u7c7b':'\u4fe1\u7528\u5361\u8fd8\u6b3e\u4e0e\u9000\u6b3e',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',principalMinor:kind==='debt_payment'?abs.toString():null,interestMinor:kind==='debt_payment'?'0':null,feeMinor:kind==='debt_payment'?'0':null,rawFields:{tradeDate,postedDate:posted,description,amount:amount.toString(),cardTail:tail,statementDate},bankStatement:{schema:'minsheng-credit-v1',statementDate,postedDate:posted,cardTail:tail}});
   if(kind==='expense')charges+=amount;else if(kind==='refund')refunds-=amount;else payments-=amount;
  }
  if(tails.size!==1)fail('BILL_BANK_MULTICARD_REQUIRES_REVIEW');
  if(charges-refunds!==totals[3]||payments!==totals[2]||!result.records.length)fail('BILL_BANK_TOTAL_INVALID');
  result.accountIdentity={provider:'\u6c11\u751f\u94f6\u884c',type:'credit_card',maskedIdentifier:[...tails][0],currency:'CNY'};
  result.records.push({sourceTransactionId:'minsheng-balance:'+statementDate+':'+[...tails][0],date:statementDate,occurredAt:statementDate+'T23:59:59+08:00',amountMinor:'0',currency:'CNY',direction:'neutral',kind:'unknown',status:'completed',description:'\u4fe1\u7528\u5361\u672c\u671f\u8d26\u5355\u5e94\u8fd8\u4f59\u989d',counterparty:'\u6c11\u751f\u94f6\u884c',category:'',paymentChannel:'',paymentAccountHint:'',balanceMinor:String(-totals[0]),balanceConvention:'signed',relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{statementDate,newBalance:totals[0].toString(),previousBalance:totals[1].toString(),payments:totals[2].toString(),newCharges:totals[3].toString()},balanceEvidence:{schema:'minsheng-credit-balance-v1',sequence:1,incomeMinor:'0',expenseMinor:'0',balanceKind:'billed_debt'}});
  result.warnings.push({line:1,code:'BILL_CREDIT_BILLED_BALANCE',message:'\u8d26\u5355\u5e94\u8fd8\u4f59\u989d\u4ec5\u5305\u542b\u5df2\u51fa\u8d26\u90e8\u5206\uff0c\u4e0d\u7b49\u4e8e\u5f53\u524d\u603b\u6b20\u6b3e\uff1b\u4ea4\u6613\u4fdd\u7559\u4ea4\u6613\u65e5\u548c\u8bb0\u8d26\u65e5\u3002'});
 }catch(error){result.records=[];result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'Minsheng statement totals, card identity or transaction rows failed validation'});}
 return result;
}
module.exports={parseMinshengHtml,textLines};
