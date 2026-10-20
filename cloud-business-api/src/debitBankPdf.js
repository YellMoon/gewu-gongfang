'use strict';
// Add support for validated PSBC and JSB debit PDF statements.
// UTF-8 source; all persisted data uses explicit UTF-8.
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const mask=v=>String(v??'').replace(/\d{12,}/g,s=>'****'+s.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const labels={jsb:['\u5e8f\u53f7','\u6458\u8981/\u9644\u8a00','\u5e01\u522b','\u4ea4\u6613\u65e5\u671f','\u4ea4\u6613\u7c7b\u578b','\u4ea4\u6613\u91d1\u989d','\u8d26\u6237\u4f59\u989d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u6237\u540d'],psbc:['\u4ea4\u6613\u65f6\u95f4','\u5b50\u8d26\u53f7','\u50a8\u79cd','\u5e01\u79cd','\u949e\u6c47','\u4ea4\u6613\u91d1\u989d','\u4ea4\u6613\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u6458\u8981','\u4ea4\u6613\u6e20\u9053','\u5916\u90e8\u7cfb\u7edf\u6d41\u6c34']};
const bounds={jsb:[36,94.11,152.22,210.33,268.44,326.55,384.66,442.77,500.88,559],psbc:[36,86.05,123.59,167.38,217.43,242.45,305.01,367.57,505.21,605.30,655.35,736.68,805.5]};
const headerX={jsb:[58.06,107.42,174.28,225.39,283.5,341.61,399.72,457.83,515.94],psbc:[43.27,91.57,136.73,183.65,221.19,255.98,318.54,418.64,537.51,621.58,678.27,744.34]};
function money(v){const s=compact(v);if(!/^-?\d+\.\d{2}$/.test(s))fail('BILL_BANK_AMOUNT_INVALID');const [a,b]=s.replace('-','').split('.');return(BigInt(a)*100n+BigInt(b))*(s.startsWith('-')?-1n:1n);}
const iso=s=>/^\d{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6):s;
function readRows(pages,provider){
 const rows=[];let serial=0;
 for(const [index,page] of pages.entries()){
  const items=page.items,joined=items.map(i=>compact(i.str)).join('');
  const footer=provider==='jsb'?joined.match(/\u9875\u7801:(\d+)\/(\d+)/):joined.match(/\u7b2c(\d+)\u9875\/\u5171(\d+)\u9875/);
  if(!footer||Number(footer[1])!==index+1||Number(footer[2])!==pages.length)fail('BILL_BANK_PAGE_INVALID');
  const headers=labels[provider].map((label,i)=>items.filter(v=>compact(v.str)===label&&Math.abs(v.x-headerX[provider][i])<2));
  if(headers.some(h=>h.length!==1))fail('BILL_BANK_HEADER_INVALID');
  const top=headers[0][0].y;if(headers.some(h=>Math.abs(h[0].y-top)>1))fail('BILL_BANK_HEADER_INVALID');
  const footerItem=items.find(v=>compact(v.str).startsWith(provider==='jsb'?'\u7533\u8bf7\u65f6\u95f4:':'\u6e29\u99a8\u63d0\u793a:'));
  const bottom=footerItem?.y??30;
  const b=bounds[provider],col=x=>b.findIndex((left,i)=>i<b.length-1&&x>=left-1&&x<b[i+1]-1);
  const body=items.filter(v=>v.y<top-2&&v.y>bottom+2&&col(v.x)>=0);
  const anchors=body.filter(v=>col(v.x)===0&&(provider==='jsb'?/^\d+$/.test(compact(v.str)):/^20\d{2}-\d{2}-\d{2}$/.test(compact(v.str)))).sort((a,b)=>b.y-a.y);
  if(!anchors.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  for(const [i,anchor] of anchors.entries()){
   const cells=Array.from({length:labels[provider].length},()=>[]),floor=anchors[i+1]?.y??bottom;
   for(const item of body.filter(v=>v.y<=anchor.y+1&&v.y>floor+1).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x))cells[col(item.x)].push(item.str);
   const row=cells.map(c=>compact(c.join('')));
   if(provider==='jsb'&&Number(row[0])!==++serial)fail('BILL_BANK_COUNT_INVALID');
   rows.push(row);
  }
  const markerColumn=provider==='jsb'?3:1;
  if(body.filter(v=>col(v.x)===markerColumn&&(provider==='jsb'?/^20\d{6}$/.test(compact(v.str)):compact(v.str)==='0001')).length!==anchors.length)fail('BILL_BANK_COUNT_INVALID');
 }
 return rows;
}
function parseDebitBankPdf(pages){
 const first=(pages?.[0]?.items||[]).map(i=>compact(i.str)).join('');
 const provider=first.includes('\u6c5f\u82cf\u94f6\u884c\u4ea4\u6613\u660e\u7ec6')?'jsb':first.includes('\u4e2d\u56fd\u90ae\u653f\u50a8\u84c4\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6(\u7535\u5b50\u7248)')?'psbc':null;
 if(!provider)return null;
 const result={provider,templateId:provider+'-debit-v1',records:[],errors:[],warnings:[]};
 try{
  const card=first.match(/\u5361\u53f7\/\u8d26\u53f7:(\d{12,24})/)?.[1],owner=first.match(provider==='jsb'?/\u5ba2\u6237\u540d\u79f0:([^:]+?)\u8d77\u59cb\u65e5\u671f:/:/\u6237\u540d:([^:]+?)\u8d77\u6b62\u65e5\u671f:/)?.[1];
  const period=provider==='jsb'?first.match(/\u8d77\u59cb\u65e5\u671f:(\d{8})\u7ed3\u675f\u65e5\u671f:(\d{8})/):first.match(/\u8d77\u6b62\u65e5\u671f:(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5-(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5/);
  if(!card||!owner||!period)fail('BILL_BANK_ACCOUNT_INVALID');
  const start=iso(provider==='jsb'?period[1]:period.slice(1,4).join('')),end=iso(provider==='jsb'?period[2]:period.slice(4,7).join(''));
  if(!validDate(start)||!validDate(end)||start>end)fail('BILL_BANK_PERIOD_INVALID');
  for(const page of pages){const t=page.items.map(i=>compact(i.str)).join('');if([...t.matchAll(/\u5361\u53f7\/\u8d26\u53f7:(\d{12,24})/g)].some(m=>m[1]!==card))fail('BILL_ACCOUNT_MIXED');}
  const entries=readRows(pages,provider),parsed=[];let lastTime='';
  for(const row of entries){
   const date=iso(provider==='jsb'?row[3]:row[0].slice(0,10)),time=provider==='jsb'?'23:59:59':row[0].slice(10),currency=provider==='jsb'?row[2]:row[3];
   if(!validDate(date)||date<start||date>end||!/^\d{2}:\d{2}:\d{2}$/.test(time)||Number(time.slice(0,2))>23||Number(time.slice(3,5))>59||Number(time.slice(6))>59||!['\u4eba\u6c11\u5e01','\u4eba\u6c11\u5e01\u5143'].includes(currency))fail('BILL_BANK_ROW_INVALID');
   if(provider==='psbc'&&(row[1]!=='0001'||row[2]!=='\u7ed3\u7b97\u6d3b\u671f'||row[4]!=='\u949e'))fail('BILL_BANK_SUBACCOUNT_UNSUPPORTED');
   if(provider==='jsb'&&!['\u6536\u5165','\u652f\u51fa'].includes(row[4]))fail('BILL_BANK_DIRECTION_INVALID');
   const amount=money(row[5]);if(provider==='jsb'&&amount<=0n)fail('BILL_BANK_AMOUNT_INVALID');
   const delta=provider==='jsb'?amount*(row[4]==='\u652f\u51fa'?-1n:1n):amount,balance=money(row[6]),stamp=date+'T'+time+'+08:00';
   if(lastTime&&stamp>lastTime)fail('BILL_BANK_ORDER_INVALID');lastTime=stamp;
   const description=provider==='jsb'?row[1]:row[9],counterparty=provider==='jsb'?row[8]:row[7],rawFields=Object.fromEntries(labels[provider].map((k,i)=>[k,mask(row[i])]));
   const kind=delta>0n&&/\u50a8\u84c4\u7ed3\u606f|^\u5229\u606f$/.test(description)?'income':delta>0n&&description==='\u8d37\u6b3e\u53d1\u653e'?'loan_drawdown':delta<0n&&/\u8d37\u6b3e\u8fd8\u6b3e|\u4fe1\u7528\u5361\u8fd8\u6b3e/.test(description)?'debt_payment':owner===counterparty||/\u57fa\u91d1\u8d4e\u56de|\u57fa\u91d1\u7533\u8d2d/.test(description)?'transfer':'unknown';
   if(delta===0n&&description!=='\u73b0\u91d1\u5f00\u5361')fail('BILL_BANK_ZERO_UNSUPPORTED');
   parsed.push({date,stamp,delta,balance,description,counterparty,rawFields,kind});
  }
  const bank=provider==='jsb'?'\u6c5f\u82cf\u94f6\u884c':'\u90ae\u50a8\u94f6\u884c',seen=new Map();let previous=null;
  for(const [index,row] of parsed.reverse().entries()){
   if(previous!==null&&previous+row.delta!==row.balance)fail('BILL_BANK_RECONCILIATION_FAILED');previous=row.balance;
   const raw={...row.rawFields};delete raw['\u5e8f\u53f7'];const key=JSON.stringify([card.slice(-4),row.stamp,row.delta.toString(),row.balance.toString(),raw]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   result.records.push({sourceTransactionId:provider+':'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:row.date,occurredAt:row.stamp,amountMinor:(row.delta<0n?-row.delta:row.delta).toString(),currency:'CNY',direction:row.delta<0n?'debit':row.delta>0n?'credit':'neutral',kind:row.kind,status:'completed',description:mask(row.description),counterparty:mask(row.counterparty),category:row.kind==='income'?'\u5229\u606f\u6536\u5165':row.kind==='transfer'?'\u8d26\u6237\u5212\u8f6c':'\u5f85\u6838\u5bf9',paymentChannel:bank+'\u50a8\u84c4\u5361('+card.slice(-4)+')',paymentAccountHint:'',balanceMinor:row.balance.toString(),relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:row.rawFields,statementFlow:{schema:provider+'-debit-v1',sequence:index+1,incomeMinor:String(row.delta>0n?row.delta:0n),expenseMinor:String(row.delta<0n?-row.delta:0n),balanceKind:'total',periodStart:start,periodEnd:end,timePrecision:provider==='jsb'?'day':'second',openingBeforeFirstMinor:index===0?String(row.balance-row.delta):null}});
  }
  result.accountIdentity={provider:bank,type:'debit_card',maskedIdentifier:card.slice(-4),currency:'CNY'};
 }catch(error){result.records=[];delete result.accountIdentity;result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'Bank statement account, pages, columns, dates or running balance validation failed'});}
 return result;
}
module.exports={parseDebitBankPdf};
