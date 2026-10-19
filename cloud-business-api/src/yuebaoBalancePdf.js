'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const clean=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>Object.assign(new Error(code),{code});
function minor(value){const v=clean(value);if(!/^-?\d+\.\d{2}$/.test(v))throw fail('BILL_BALANCE_AMOUNT_INVALID');const [a,b]=v.replace('-','').split('.');return(BigInt(a)*100n+BigInt(b))*(v.startsWith('-')?-1n:1n);}
function parseYuebaoBalancePdf(pages){
 const result={provider:'alipay',templateId:'alipay-yuebao-balance-v1',records:[],errors:[],warnings:[{line:1,code:'BILL_AVAILABLE_BALANCE_ONLY',message:'\u8fd9\u4efd\u6d41\u6c34\u5217\u793a\u4f59\u989d\u5b9d\u53ef\u7528\u4f59\u989d\uff1b\u4e0d\u7b49\u540c\u4e8e\u542b\u51bb\u7ed3\u8d44\u91d1\u7684\u603b\u8d44\u4ea7\uff0c\u4e5f\u4e0d\u91cd\u590d\u8ba1\u5165\u6536\u652f\u3002'}]};
 try{
  const items=pages[0]?.items||[],labels=['\u65f6\u95f4','\u91d1\u989d(\u5143)','\u4fe1\u606f','\u4f59\u989d\u5b9d\u53ef\u7528\u4f59\u989d'],heads=labels.map(label=>items.find(i=>clean(i.str)===label));
  if(heads.some(h=>!h))throw fail('BILL_BALANCE_HEADER_INVALID');
  const centers=heads.map(h=>h.x+h.width/2),boxes=heads.map((h,i)=>pages[0].bounds.find(b=>b[2]-b[0]>30&&b[2]-b[0]<250&&b[3]-b[1]>10&&b[0]<centers[i]&&b[2]>centers[i]&&b[1]<h.y&&b[3]>h.y));
  if(boxes.some(b=>!b))throw fail('BILL_BALANCE_GRID_INVALID');
  const edges=boxes.slice(1).map((b,i)=>(b[0]+boxes[i][2])/2),rows=[];
  if(centers.some((x,i)=>i&&x<=centers[i-1]))throw fail('BILL_BALANCE_GRID_INVALID');
  for(const page of pages){
   const times=page.items.filter(i=>/^20\d{2}-\d{2}-\d{2}\d{2}:\d{2}$/.test(clean(i.str))&&i.x<edges[0]).sort((a,b)=>b.y-a.y);
   for(const time of times){
    const cells=Array.from({length:4},()=>[]);
    for(const item of page.items.filter(i=>i.str.trim()&&Math.abs(i.y-time.y)<2)){const col=edges.filter(x=>item.x>=x).length;cells[col].push(item);}
    const v=cells.map(c=>clean(c.sort((a,b)=>a.x-b.x).map(i=>i.str).join('')));
    if(!validDate(v[0].slice(0,10))||v[0]!==clean(time.str)||!v[2])throw fail('BILL_BALANCE_ROW_INVALID');
    rows.push({v,delta:minor(v[1]),balance:minor(v[3]),page:page.number});
   }
  }
  if(!rows.length)throw fail('BILL_BALANCE_NO_RECORDS');
  rows.reverse();let previous=null,previousTime=null;const occurrences=new Map();
  for(const [index,{v,delta,balance,page}] of rows.entries()){
   const date=v[0].slice(0,10),occurredAt=date+'T'+v[0].slice(10)+':00+08:00',time=Date.parse(occurredAt);
   if(!Number.isFinite(time)||previousTime!==null&&time<previousTime)throw fail('BILL_BALANCE_ORDER_INVALID');
   if(previous!==null&&previous+delta!==balance)throw fail('BILL_BALANCE_RECONCILIATION_FAILED');
   const key=JSON.stringify([occurredAt,String(delta),String(balance),v[2]]),occurrence=(occurrences.get(key)||0)+1;occurrences.set(key,occurrence);
   const eventKey=createHash('sha256').update(key+':'+occurrence).digest('hex');
   result.records.push({sourceTransactionId:'alipay_yuebao_balance:'+eventKey,occurredAt,date,amountMinor:'0',currency:'CNY',direction:'neutral',kind:'transfer',description:v[2],counterparty:'',category:'\u4f59\u989d\u6838\u5bf9',paymentChannel:'\u4f59\u989d\u5b9d',paymentAccountHint:'',balanceMinor:String(balance),relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{\u65f6\u95f4:v[0],\u91d1\u989d:v[1],\u4fe1\u606f:v[2],\u4f59\u989d\u5b9d\u53ef\u7528\u4f59\u989d:v[3]},accountRelations:[{product:'alipay_yuebao',role:'target',activity:'investment_confirmation'}],balanceEvidence:{schema:'alipay-yuebao-balance-v1',product:'alipay_yuebao',balanceKind:'available',incomeMinor:String(delta>0n?delta:0n),expenseMinor:String(delta<0n?-delta:0n),sourcePage:page,sequence:index+1,openingBeforeFirstMinor:index===0?String(balance-delta):null}});
   previous=balance;previousTime=time;
  }
 }catch(e){result.records=[];result.errors.push({line:1,code:e.code||'BILL_BALANCE_PDF_INVALID',message:'\u4f59\u989d\u5b9d\u6d41\u6c34\u7684\u8868\u683c\u3001\u91d1\u989d\u6216\u9010\u7b14\u4f59\u989d\u672a\u901a\u8fc7\u6838\u9a8c\uff0c\u8bf7\u68c0\u67e5\u539f\u4ef6\u3002'});}
 return result;
}
module.exports={parseYuebaoBalancePdf};
