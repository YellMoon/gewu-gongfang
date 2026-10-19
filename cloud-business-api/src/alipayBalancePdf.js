'use strict';
const {validDate}=require('../../shared/personal-finance/ledger');
const {createHash}=require('node:crypto');
const clean=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const error=code=>Object.assign(new Error(code),{code});
function minor(v){const s=clean(v);if(!/^-?\d+\.\d{2}$/.test(s))throw error('BILL_BALANCE_AMOUNT_INVALID');const [a,b]=s.replace('-','').split('.');return(BigInt(a)*100n+BigInt(b))*(s.startsWith('-')?-1n:1n);}
function parseAlipayBalancePdf(pages){
 const result={provider:'alipay',templateId:'alipay-balance-proof-v1',records:[],errors:[],warnings:[{line:1,code:'BILL_BALANCE_EVIDENCE_ONLY',message:'\u4f59\u989d\u8bc1\u660e\u7528\u4e8e\u9010\u7b14\u4f59\u989d\u6838\u5bf9\uff0c\u4e0d\u91cd\u590d\u8ba1\u5165\u5df2\u5bfc\u5165\u7684\u6d88\u8d39\u548c\u6536\u5165\u3002'}]};
 try{
  const header=pages[0].items,first=header.find(i=>clean(i.str)==='\u6d41\u6c34\u53f7'),second=header.find(i=>clean(i.str)==='\u65f6\u95f4');
  if(!first||!second)throw error('BILL_BALANCE_HEADER_INVALID');
  const x=first.x+first.width/2,step=second.x+second.width/2-x,rows=[];
  if(step<30||step>150)throw error('BILL_BALANCE_GRID_INVALID');
  for(const page of pages){
   // PDF text extraction may combine adjacent cells into one text item.
   // Split only a whitespace-delimited amount whose right edge crosses one grid column.
   const items=page.items.flatMap(i=>{const m=i.str.match(/^(.+?)\s+(-?\d+\.\d{2})$/),left=Math.floor((i.x-(x-step/2))/step),right=Math.floor((i.x+i.width-0.1-(x-step/2))/step);return m&&right===left+1&&right>=3&&right<=5?[{...i,str:m[1]},{...i,str:m[2],x:i.x+i.width-0.2,width:0}]:[i];});
   const groups=new Map();
   for(const b of page.bounds){
    if(Math.abs(b[2]-b[0]-step)>1||b[3]-b[1]<15)continue;
    const center=(b[0]+b[2])/2,col=Math.round((center-x)/step);
    if(col<0||col>6||Math.abs(center-(x+step*col))>1)continue;
    const key=b[1].toFixed(1)+':'+b[3].toFixed(1);
    if(!groups.has(key))groups.set(key,{top:b[3],bottom:b[1],cells:Array(7).fill(null)});
    groups.get(key).cells[col]=clean(items.filter(i=>i.str.trim()&&i.x>=b[0]-0.1&&i.x<b[2]-0.1&&i.y>b[1]&&i.y<b[3]).sort((a,b)=>Math.abs(a.y-b.y)>1?b.y-a.y:a.x-b.x).map(i=>i.str).join(''));
   }
   for(const row of [...groups.values()].sort((a,b)=>b.top-a.top)){
    const v=row.cells;
    if(!/^20\d{2}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}$/.test(v[1]||''))continue;
    if(v.some(c=>c===null)||!v[0]||!validDate(v[1].slice(0,10)))throw error('BILL_BALANCE_ROW_INVALID');
    const income=v[3]?minor(v[3]):0n,expense=v[4]?minor(v[4]):0n,balance=minor(v[5]);
    if(income<0n||expense>0n||income&&expense)throw error('BILL_BALANCE_DIRECTION_INVALID');
    rows.push({v,income,expense,balance,page:page.number});
   }
  }
  if(!rows.length)throw error('BILL_BALANCE_NO_RECORDS');
  rows.reverse();const ids=new Set();let previous=null,previousTime=null;
  for(let index=0;index<rows.length;index++){
   const {v,income,expense,balance,page}=rows[index],date=v[1].slice(0,10),occurredAt=date+'T'+v[1].slice(10)+'+08:00';
   const eventKey=createHash('sha256').update(JSON.stringify([v[0],occurredAt,String(income),String(expense),String(balance)])).digest('hex');
   if(ids.has(eventKey)||Number.isNaN(Date.parse(occurredAt))||previousTime&&Date.parse(occurredAt)<previousTime)throw error('BILL_BALANCE_ORDER_INVALID');
   if(previous!==null&&previous+income+expense!==balance)throw error('BILL_BALANCE_RECONCILIATION_FAILED');
   ids.add(eventKey);previous=balance;previousTime=Date.parse(occurredAt);
   result.records.push({sourceTransactionId:'alipay_balance:'+eventKey,occurredAt,date,amountMinor:'0',currency:'CNY',direction:'neutral',kind:'transfer',description:v[2],counterparty:'',category:'\u4f59\u989d\u6838\u5bf9',paymentChannel:'\u8d26\u6237\u4f59\u989d',paymentAccountHint:'',balanceMinor:String(balance),relatedReference:v[0],status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{\u6d41\u6c34\u53f7:v[0],\u65f6\u95f4:v[1],\u540d\u79f0\u5907\u6ce8:v[2],\u6536\u5165:v[3],\u652f\u51fa:v[4],\u8d26\u6237\u4f59\u989d:v[5],\u8d44\u91d1\u6e20\u9053:v[6]},balanceEvidence:{schema:'alipay-balance-proof-v1',incomeMinor:String(income),expenseMinor:String(-expense),sourcePage:page,sequence:index+1,openingBeforeFirstMinor:index===0?String(balance-income-expense):null}});
  }
 }catch(e){result.records=[];result.errors.push({line:1,code:e.code||'BILL_BALANCE_PDF_INVALID',message:'\u4f59\u989d\u8bc1\u660e\u7684\u8868\u683c\u3001\u91d1\u989d\u6216\u9010\u7b14\u4f59\u989d\u672a\u901a\u8fc7\u6838\u9a8c\uff0c\u8bf7\u68c0\u67e5\u539f\u4ef6\u3002'});}
 return result;
}
module.exports={parseAlipayBalancePdf};
