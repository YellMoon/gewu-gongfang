'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const mask=v=>String(v??'').replace(/\d{12,}/g,m=>'****'+m.slice(-4));
const fail=code=>Object.assign(new Error(code),{code});
function minor(v){const s=compact(v);if(!/^[+-]?\d+\.\d{2}$/.test(s))throw fail('BILL_BANK_AMOUNT_INVALID');const [a,b]=s.replace(/^[+-]/,'').split('.');return(BigInt(a)*100n+BigInt(b))*(s[0]==='-'?-1n:1n);}
const BANK=['\u4ea4\u6613\u65f6\u95f4','\u4ea4\u6613\u91d1\u989d','\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u673a\u6784\u540d\u79f0','\u4ea4\u6613\u6d41\u6c34\u53f7','\u4ea4\u6613\u540d\u79f0'];
const FUND=['\u4ea4\u6613\u65f6\u95f4','\u4ea4\u6613\u7c7b\u578b','\u4ea4\u6613\u91d1\u989d','\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u673a\u6784\u540d\u79f0','\u5907\u6ce8'];
function parseMybankRows(rows){
 const title=compact(rows[0]?.[0]);if(!['\u7f51\u5546\u94f6\u884c\u8d26\u6237\u6536\u652f\u660e\u7ec6','\u4f59\u5229\u5b9d\u8d44\u91d1\u660e\u7ec6'].includes(title))return null;
 const fund=title==='\u4f59\u5229\u5b9d\u8d44\u91d1\u660e\u7ec6',result={provider:'mybank',templateId:fund?'mybank-yulibao-v1':'mybank-current-v1',records:[],errors:[],warnings:[]};
 try{
  const header=rows.findIndex(r=>r.map(compact).slice(0,8).every((v,i)=>v===(fund?FUND:BANK)[i])&&r.length>=8);
  if(header<0)throw fail('BILL_BANK_HEADER_INVALID');
  const preamble=rows.slice(0,header).map(r=>r.map(compact).join('')).join('');
  const account=preamble.match(fund?/\u4ea4\u6613\u8d26\u53f7:(\d{12,30})/:/\u5361\u53f7:(\d{12,30})/),period=preamble.match(/\u660e\u7ec6\u533a\u95f4:(20\d{2}-\d{2}-\d{2})00:00:00-(20\d{2}-\d{2}-\d{2})00:00:00/);
  if(!account||!period||!validDate(period[1])||!validDate(period[2]))throw fail('BILL_BANK_ACCOUNT_INVALID');
  result.accountIdentity={provider:'\u7f51\u5546\u94f6\u884c',type:fund?'investment':'debit_card',maskedIdentifier:account[1].slice(-4),currency:'CNY',...(fund?{product:'alipay_yulibao'}:{})};
  if(fund)result.warnings.push({line:1,code:'BILL_ESTIMATED_FUND_BALANCE',message:'\u4f59\u5229\u5b9d\u4f59\u989d\u4e3a\u94f6\u884c\u8bd5\u7b97\u503c\uff1b\u6536\u76ca\u3001\u7533\u8d2d\u548c\u8d4e\u56de\u9010\u7b14\u4fdd\u7559\uff0c\u5b9e\u9645\u4efd\u989d\u4ee5\u7ba1\u7406\u4eba\u767b\u8bb0\u4e3a\u51c6\u3002'});
  else result.warnings.push({line:1,code:'BILL_BANK_PAYMENT_RECONCILIATION',message:'\u94f6\u884c\u4ed8\u6b3e\u4fdd\u7559\u8d44\u91d1\u6d41\uff1b\u6d88\u8d39\u5206\u7c7b\u4e0e\u5e73\u53f0\u8d26\u5355\u6838\u5bf9\u540e\u786e\u5b9a\uff0c\u907f\u514d\u91cd\u590d\u8ba1\u5165\u6d88\u8d39\u3002'});
  const entries=rows.slice(header+1).filter(r=>r.some(v=>compact(v))).map((r,index)=>{
   const v=Array.from({length:8},(_,i)=>compact(r[i])),m=v[0].match(/^(20\d{2}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})$/);
   if(!m||!validDate(m[1])||m[1]<period[1]||m[1]>period[2]||!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(m[2]))throw fail('BILL_BANK_ROW_INVALID');
   const delta=minor(v[fund?2:1]),balance=minor(v[fund?3:2]);
   if(!fund&&!/^\d{12,80}$/.test(v[6]))throw fail('BILL_BANK_REFERENCE_INVALID');
   if(fund&&!['\u6b63\u5e38\u7533\u8d2d','\u6b63\u5e38\u8d4e\u56de','\u6b63\u5e38\u6536\u76ca'].includes(v[1]))throw fail('BILL_BANK_TYPE_UNKNOWN');
   if(fund&&(v[1]==='\u6b63\u5e38\u7533\u8d2d'&&delta<0n||v[1]==='\u6b63\u5e38\u8d4e\u56de'&&delta>0n))throw fail('BILL_BANK_DIRECTION_INVALID');
   return{v,date:m[1],occurredAt:m[1]+'T'+m[2]+'+08:00',delta,balance,line:header+index+2};
  }).reverse().sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  if(!entries.length)throw fail('BILL_BANK_NO_RECORDS');
  let previous=null,previousTime=null;const seen=new Map();
  for(const [i,e] of entries.entries()){
   const {v,date,occurredAt,delta,balance}=e,time=Date.parse(occurredAt);
   if(previousTime!==null&&time<previousTime)throw fail('BILL_BANK_ORDER_INVALID');
   if(previous!==null&&previous+delta!==balance)throw fail('BILL_BANK_RECONCILIATION_FAILED');
   const kind=fund?(v[1]==='\u6b63\u5e38\u6536\u76ca'?'income':'transfer'):/\u7ed3\u606f/.test(v[7])?'income':/\u8f6c\u5165|\u8f6c\u51fa|\u8f6c\u8d26|\u7533\u8d2d|\u8d4e\u56de|\u63d0\u73b0/.test(v[7])?'transfer':'unknown';
   const normalized=v.map(mask),key=JSON.stringify([occurredAt,v[fund?2:1],v[fund?3:2],...normalized.slice(4)]),occurrence=(seen.get(key)||0)+1;seen.set(key,occurrence);
   const sourceTransactionId=fund?'mybank_yulibao:'+createHash('sha256').update(key+':'+occurrence).digest('hex'):v[6];
   result.records.push({sourceTransactionId,occurredAt,date,amountMinor:String(delta<0n?-delta:delta),currency:'CNY',direction:delta<0n?'debit':'credit',kind,description:mask(v[7]),counterparty:mask(v[fund?4:3]),category:fund?(kind==='income'?'\u7406\u8d22\u6536\u76ca':'\u7406\u8d22\u5212\u8f6c'):kind==='income'?'\u5229\u606f\u6536\u5165':kind==='transfer'?'\u8d26\u6237\u5212\u8f6c':'\u5f85\u5173\u8054\u5e73\u53f0\u8d26\u5355',paymentChannel:fund?'\u4f59\u5229\u5b9d':'\u7f51\u5546\u94f6\u884c\u50a8\u84c4\u5361('+account[1].slice(-4)+')',paymentAccountHint:'',balanceMinor:String(balance),relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:Object.fromEntries((fund?FUND:BANK).map((k,j)=>[k,j===6&&!fund?v[6]:mask(v[j])])),statementFlow:{schema:result.templateId,sequence:i+1,incomeMinor:String(delta>0n?delta:0n),expenseMinor:String(delta<0n?-delta:0n),balanceKind:fund?'estimated':'total',periodStart:period[1],periodEnd:period[2],openingBeforeFirstMinor:i===0?String(balance-delta):null}});
   previous=balance;previousTime=time;
  }
 }catch(e){result.records=[];result.errors.push({line:1,code:e.code||'BILL_BANK_INVALID',message:'\u7f51\u5546\u94f6\u884c\u8d26\u5355\u7684\u8d26\u6237\u3001\u91d1\u989d\u6216\u9010\u7b14\u4f59\u989d\u672a\u901a\u8fc7\u6838\u9a8c\u3002'});}
 return result;
}
function parseMybankFundPdf(pages){
 try{
  const p=pages[0],labels=FUND.map(x=>x==='\u5bf9\u65b9\u8d26\u53f7'?'\u5bf9\u65b9\u8d26\u6237':x),heads=labels.map(x=>p.items.find(i=>compact(i.str)===x));
  if(heads.some(h=>!h))throw fail('BILL_BANK_HEADER_INVALID');
  const boxes=heads.map(h=>p.bounds.find(b=>b[2]-b[0]>30&&b[2]-b[0]<100&&b[3]-b[1]>5&&b[0]<h.x+h.width/2&&b[2]>h.x+h.width/2&&b[1]<h.y&&b[3]>h.y));
  if(boxes.some(b=>!b))throw fail('BILL_BANK_GRID_INVALID');
  const rows=[['\u4f59\u5229\u5b9d\u8d44\u91d1\u660e\u7ec6'],[p.items.map(i=>i.str).join('')],FUND];
  for(const page of pages){
   const groups=new Map();
   for(const b of page.bounds){
    const col=boxes.findIndex(h=>Math.abs(h[0]-b[0])<1&&Math.abs(h[2]-b[2])<1);
    if(col<0||b[3]-b[1]<5)continue;
    const key=b[1].toFixed(1)+':'+b[3].toFixed(1);if(!groups.has(key))groups.set(key,{top:b[3],cells:Array(8).fill(null)});
    groups.get(key).cells[col]=page.items.filter(i=>i.str.trim()&&i.x>=b[0]&&i.x<b[2]&&i.y>b[1]-0.4&&i.y<b[3]-0.4).sort((a,b)=>Math.abs(a.y-b.y)>1?b.y-a.y:a.x-b.x).map(i=>i.str).join('');
   }
   for(const g of [...groups.values()].sort((a,b)=>b.top-a.top)){if(compact(g.cells[0])==='\u4ea4\u6613\u65f6\u95f4')continue;if(!g.cells.some(v=>compact(v)))continue;if(g.cells.some(v=>v===null))throw fail('BILL_BANK_GRID_INVALID');rows.push(g.cells);}
  }
  return parseMybankRows(rows);
 }catch(e){return{provider:'mybank',templateId:'mybank-yulibao-v1',records:[],warnings:[],errors:[{line:1,code:e.code||'BILL_BANK_INVALID',message:'\u4f59\u5229\u5b9d PDF \u8868\u683c\u672a\u901a\u8fc7\u6838\u9a8c\u3002'}]};}
}
module.exports={parseMybankRows,parseMybankFundPdf};
