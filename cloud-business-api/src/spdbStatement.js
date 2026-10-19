'use strict';
const {money,date,assemble}=require('./creditBankStatements');
const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function parseSpdbPdfRows(rows){
 const text=compact(rows.flat().join(''));
 if(!text.includes('\u6d66\u53d1\u4e2a\u4eba\u4fe1\u7528\u5361\u5bf9\u8d26\u5355')||!text.includes('Payment/Credit'))return null;
 const result={provider:'spdb',templateId:'bank-credit-spdb-v1',records:[],errors:[],warnings:[]};
 try{
  const month=text.match(/(20\d{2})(\d{2})\u4fe1\u7528\u5361\u8d26\u5355/),day=rows.find(r=>compact(r[0])==='\u8d26\u5355\u65e5:')?.[1];
  const statementDate=month&&date(month[1]+'-'+month[2]+'-'+compact(day).padStart(2,'0'));
  if(!statementDate)fail('BILL_BANK_PERIOD_INVALID');
  const transactions=[];let summary,active=false,last;
  for(const raw of rows){
   const r=raw.map(v=>String(v).normalize('NFKC').trim()).filter(Boolean),joined=compact(r.join(''));
   const values=[...joined.matchAll(/[\u00a5\uffe5]([+-]?[\d,]+\.\d{2})/g)];
   if(values.length===4){if(summary)fail('BILL_BANK_TOTAL_INVALID');summary=values.map(v=>money(v[1]));}
   if(date(r[0])&&date(r[1])){
    const end=r.length-1,currency=r[end-1];if(!['\u00a5','\uffe5'].includes(currency)||!/^\d{4}$/.test(r[end-2]))fail('BILL_BANK_ROW_INVALID');
    const amount=money(r[end]),description=r.slice(2,end-2).join(' ');if(!description)fail('BILL_BANK_ROW_INVALID');
    last={trade:date(r[0]),posted:date(r[1]),tail:r[end-2],description,amount,...(amount<0n&&/\u8f6c\u5206\u671f\u4ed8\u6b3e/.test(description)?{kind:'unknown',nonCash:false}:{}),credit:amount<0n};transactions.push(last);active=true;continue;
   }
   if(/\u672c\u671f\u79ef\u5206\u60c5\u51b5|\u6e29\u99a8\u63d0\u793a|^\u7b2c\d+\u9875|^\u4ea4\u6613\u65e5\u671f|^TransactionDate/.test(joined)){active=false;continue;}
   if(active&&r.length===1&&r[0].length<=100&&last)last.description+=r[0];
  }
  if(!summary||!transactions.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  const tails=[...new Set(transactions.map(t=>t.tail))],balances=tails.length===1?[{tail:tails[0],amount:summary[0]}]:[];
  return assemble({provider:'spdb',statementDate,transactions,balances,check(){const n=summary,credit=transactions.filter(t=>t.credit).reduce((s,t)=>s-t.amount,0n),debit=transactions.filter(t=>!t.credit).reduce((s,t)=>s+t.amount,0n);if(n[0]!==n[1]-n[2]+n[3]||credit!==n[2]||debit!==n[3])fail('BILL_BANK_TOTAL_INVALID');}});
 }catch(e){result.errors.push({line:1,code:e.code||'BILL_BANK_INVALID',message:'SPDB statement dates, rows or totals failed validation'});return result;}
}
function parseSpdbDetailRows(rows,fieldMapping={}){
 const header=['\u4ea4\u6613\u65e5\u671f','\u8bb0\u8d26\u65e5\u671f','\u4ea4\u6613\u6458\u8981','\u5361\u53f7\u672b\u56db\u4f4d','\u5361\u7247\u7c7b\u578b','\u4ea4\u6613\u5e01\u79cd','\u4ea4\u6613\u91d1\u989d'];
 if(!rows.length||JSON.stringify(rows[0].map(compact))!==JSON.stringify(header))return null;
 const result={provider:'spdb',templateId:'bank-credit-spdb-v1',records:[],errors:[],warnings:[]};
 if(fieldMapping?.provider!=='spdb'){result.errors.push({line:1,code:'BILL_BANK_SOURCE_REQUIRED',message:'\u8be5 Excel \u660e\u7ec6\u4e0d\u542b\u94f6\u884c\u540d\u79f0\uff0c\u8bf7\u5728\u8d26\u5355\u6765\u6e90\u4e2d\u9009\u62e9\u201c\u6d66\u53d1\u94f6\u884c Excel \u660e\u7ec6\u201d\uff1b\u6240\u5c5e\u5361\u7247\u4f1a\u6839\u636e\u5c3e\u53f7\u81ea\u52a8\u5339\u914d\u3002'});return result;}
 try{
  const transactions=[];
  for(const raw of rows.slice(1)){
   if(raw.every(v=>!compact(v)))continue;
   const r=raw.map(v=>String(v).trim()),currency={'\u4eba\u6c11\u5e01':'CNY','\u7f8e\u5143':'USD',CNY:'CNY',USD:'USD'}[compact(r[5])];
   if(r.length!==7||!date(r[0])||!date(r[1])||!/^\d{4}$/.test(r[3])||!currency||!r[2]||!['\u4e3b\u5361','\u9644\u5c5e\u5361'].includes(r[4]))fail('BILL_BANK_ROW_INVALID');
   const value=compact(r[6]).replace(/,/g,'');if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(value))fail('BILL_BANK_AMOUNT_INVALID');
   const [whole,fraction='']=value.split('.'),amount=money(whole+'.'+fraction.padEnd(2,'0'));
   transactions.push({trade:date(r[0]),posted:date(r[1]),tail:r[3],description:r[2],amount,currency,...(amount<0n&&/\u8f6c\u5206\u671f\u4ed8\u6b3e/.test(r[2])?{kind:'unknown',nonCash:false}:{}),credit:amount<0n});
  }
  if(!transactions.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  const parsed=assemble({provider:'spdb',transactions,balances:[],detailOnly:true});
  parsed.warnings=[{line:1,code:'BILL_BANK_DETAIL_ONLY',message:'\u8be5\u6587\u4ef6\u53ea\u63d0\u4f9b\u9010\u7b14\u4ea4\u6613\uff0c\u4e0d\u63d0\u4f9b\u8d26\u5355\u65e5\u3001\u6708\u5408\u8ba1\u6216\u4f59\u989d\uff1b\u4fdd\u7559\u539f\u59cb\u4ea4\u6613\u65e5\u4e0e\u8bb0\u8d26\u65e5\uff0c\u4e0d\u63a8\u6d4b\u7f3a\u5931\u5b57\u6bb5\u3002'}];return parsed;
 }catch(e){result.errors.push({line:1,code:e.code||'BILL_BANK_INVALID',message:'SPDB Excel detail rows failed validation'});return result;}
}
module.exports={parseSpdbPdfRows,parseSpdbDetailRows};
