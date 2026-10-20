'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const mask=v=>String(v??'').replace(/\d{12,}/g,v=>'****'+v.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
function minor(value){const text=compact(value);if(!/^-?\d+(?:\.\d{1,2})?$/.test(text))fail('BILL_BANK_AMOUNT_INVALID');const [whole,fraction='']=text.replace('-','').split('.');return(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(text.startsWith('-')?-1n:1n);}
function parseHuaxiaRows(rows){
 if(!compact(rows[0]?.[0]).startsWith('\u534e\u590f\u94f6\u884c\u4e2a\u4eba\u8d26\u6237\u4ea4\u6613\u6d41\u6c34'))return null;
 const result={provider:'huaxia',templateId:'huaxia-debit-v1',records:[],errors:[],warnings:[]};
 try{
  const field=label=>{for(const row of rows.slice(0,7)){const i=row.findIndex(v=>compact(v).startsWith(label+':'));if(i>=0)return compact(row[i+1]);}return '';};
  const period=field('\u67e5\u8be2\u8d77\u6b62\u65e5\u671f').match(/^(20\d{6})\u81f3(20\d{6})$/),card=field('\u5361\u53f7'),owner=field('\u6237\u540d');
  const date=v=>v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8);
  if(!period||!/^\d{12,24}$/.test(card)||field('\u5e01\u79cd')!=='\u4eba\u6c11\u5e01'||field('\u660e\u7ec6\u8303\u56f4')!=='\u5168\u90e8\u4ea4\u6613'||field('\u4ea4\u6613\u7c7b\u578b')!=='\u5168\u90e8'||field('\u91d1\u989d\u533a\u95f4')!=='\u5168\u90e8')fail('BILL_BANK_ACCOUNT_INVALID');
  const start=date(period[1]),end=date(period[2]);if(!validDate(start)||!validDate(end)||start>end)fail('BILL_BANK_PERIOD_INVALID');
  const labels=['\u8bb0\u8d26\u65e5\u671f','\u6458\u8981','\u4ea4\u6613\u91d1\u989d','\u4f59\u989d','\u4ea4\u6613\u673a\u6784','\u5bf9\u65b9\u59d3\u540d','\u5bf9\u65b9\u5361/\u8d26\u53f7','\u5bf9\u65b9\u5f00\u6237\u884c','\u9644\u8a00'];
  const header=rows.findIndex(r=>labels.every((label,i)=>compact(r[i]).startsWith(label+':')));if(header<0)fail('BILL_BANK_HEADER_INVALID');
  const entries=rows.slice(header+1).filter(r=>r.some(v=>compact(v))&&!compact(r[0]).startsWith('\u67e5\u8be2\u65f6\u95f4:'));
  if(entries.length!==Number(field('\u4ea4\u6613\u5408\u8ba1\u7b14\u6570'))||!entries.length)fail('BILL_BANK_COUNT_INVALID');
  let previous=null,lastDate='',income=0n,expense=0n;const seen=new Map();
  for(const [i,row] of entries.entries()){
   const d=compact(row[0]),delta=minor(row[2]),balance=minor(row[3]);
   if(!validDate(d)||d<start||d>end||d<lastDate)fail('BILL_BANK_ROW_INVALID');
   if(previous!==null&&previous+delta!==balance)fail('BILL_BANK_RECONCILIATION_FAILED');
   const description=compact(row[1]),counterparty=compact(row[5]),remarks=compact(row[8]);
   const mortgage=delta<0n&&(/\u8d37\u6b3e\u8fd8\u6b3e/.test(description)&&/\u4e2a\u4eba\u8d37\u6b3e\u6237/.test(counterparty)||/\u516c\u79ef\u91d1\u6263\u6b3e/.test(description)&&/\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3/.test(counterparty));
   const kind=/\u7ed3\u606f/.test(description)?'income':mortgage||/\u8d37\u6b3e\u672c\u606f|\u4fe1\u7528\u5361\u8fd8\u6b3e/.test(description+remarks)?'debt_payment':owner&&owner===counterparty?'transfer':'unknown';
   const rawFields=Object.fromEntries(labels.map((label,j)=>[label,mask(row[j])])),key=JSON.stringify([d,delta.toString(),balance.toString(),rawFields]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   result.records.push({sourceTransactionId:'huaxia:'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:d,occurredAt:d+'T23:59:59+08:00',amountMinor:String(delta<0n?-delta:delta),currency:'CNY',direction:delta<0n?'debit':'credit',kind,status:'completed',description:mask(description+' '+remarks),counterparty:mask(counterparty),category:kind==='income'?'\u5229\u606f\u6536\u5165':kind==='transfer'?'\u8d26\u6237\u5212\u8f6c':'\u5f85\u6838\u5bf9',paymentChannel:'\u534e\u590f\u94f6\u884c\u50a8\u84c4\u5361('+card.slice(-4)+')',paymentAccountHint:'',balanceMinor:balance.toString(),relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null,rawFields,statementFlow:{schema:'huaxia-debit-v1',sequence:i+1,incomeMinor:String(delta>0n?delta:0n),expenseMinor:String(delta<0n?-delta:0n),balanceKind:'total',periodStart:start,periodEnd:end,timePrecision:'day',openingBeforeFirstMinor:i===0?String(balance-delta):null}});
   if(delta>0n)income+=delta;else expense-=delta;previous=balance;lastDate=d;
  }
  if(income!==minor(field('\u6536\u5165\u5408\u8ba1\u91d1\u989d'))||expense!==minor(field('\u652f\u51fa\u5408\u8ba1\u91d1\u989d')))fail('BILL_BANK_TOTAL_INVALID');
  result.accountIdentity={provider:'\u534e\u590f\u94f6\u884c',type:'debit_card',maskedIdentifier:card.slice(-4),currency:'CNY'};
  result.warnings.push({line:1,code:'BILL_BANK_DAY_PRECISION',message:'\u8d26\u5355\u4ec5\u63d0\u4f9b\u8bb0\u8d26\u65e5\u671f\uff1b\u540c\u65e5\u6309\u539f\u8868\u987a\u5e8f\u6838\u5bf9\u65e5\u7ec8\u4f59\u989d\u3002\u8d37\u6b3e\u8fd8\u6b3e\u672a\u62c6\u5206\u672c\u606f\uff0c\u5176\u4ed6\u6536\u652f\u7528\u9014\u9700\u7ed3\u5408\u5e73\u53f0\u8d26\u5355\u6838\u5bf9\u3002'});
 }catch(error){result.records=[];result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'Huaxia statement account, count, totals or running balance validation failed'});}
 return result;
}
module.exports={parseHuaxiaRows};
