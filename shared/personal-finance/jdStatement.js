'use strict';
const {inferAccountRelations}=require('./accountProducts');
// UTF-8 source; JD payment exports are not full credit statement balances.
const HEADERS=['\u4ea4\u6613\u65f6\u95f4','\u5546\u6237\u540d\u79f0','\u4ea4\u6613\u8bf4\u660e','\u91d1\u989d','\u6536/\u4ed8\u6b3e\u65b9\u5f0f','\u4ea4\u6613\u72b6\u6001','\u6536/\u652f','\u4ea4\u6613\u5206\u7c7b','\u4ea4\u6613\u8ba2\u5355\u53f7','\u5546\u5bb6\u8ba2\u5355\u53f7','\u5907\u6ce8'];
const clean=v=>String(v??'').normalize('NFKC').trim();
const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function parseJdCsvRows(rows){
 const headerIndex=rows.findIndex(r=>HEADERS.every((v,i)=>clean(r.cells[i])===v));
 const intro=rows.slice(0,Math.max(0,headerIndex)).flatMap(r=>r.cells).map(clean).join('').replace(/\s/g,'');
 if(headerIndex<0||!intro.includes('\u4eac\u4e1c\u8d26\u53f7\u540d:'))return null;
 const result={provider:'jd',templateId:'jd-transactions-v1',records:[],errors:[],warnings:[]};
 try{
  const range=intro.match(/\u65e5\u671f\u533a\u95f4:(\d{4}-\d{2}-\d{2})\u81f3(\d{4}-\d{2}-\d{2})/),count=intro.match(/\u5171:(\d+)\u7b14\u8bb0\u5f55/),owner=intro.match(/\u4eac\u4e1c\u8d26\u53f7\u540d:(.+?)\u7533\u8bf7\u65f6\u95f4:/);
  if(!range||!count||!owner||!valid(range[1])||!valid(range[2])||range[1]>range[2])fail('BILL_JD_HEADER_INVALID');
  const data=rows.slice(headerIndex+1).filter(r=>r.cells.some(v=>clean(v))),seen=new Set();
  if(data.length!==Number(count[1])||data.length>10000)fail('BILL_JD_COUNT_INVALID');
  for(const row of data){
   if(row.issue||row.cells.slice(11).some(v=>clean(v)))fail('BILL_JD_COLUMNS_INVALID');
   const cells=row.cells.slice(0,11).map(clean),[stamp,counterparty,description,amount,paymentChannel,state,directionText,category,orderId,merchantOrderId,note]=cells,date=stamp.slice(0,10);
   const amountMatch=amount.match(/^(\d+\.\d{2})(?:\(\u5df2\u9000\u6b3e(\d+\.\d{2})\))?$/),sourceId=JSON.stringify([orderId,merchantOrderId,paymentChannel]);
   if(!/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(stamp)||!valid(date)||date<range[1]||date>range[2]||!amountMatch||!orderId||seen.has(sourceId)||!['\u6536\u5165','\u652f\u51fa','\u4e0d\u8ba1\u6536\u652f'].includes(directionText))fail('BILL_JD_ROW_INVALID');
   if(amountMatch[2]&&BigInt(amountMatch[2].replace('.',''))>BigInt(amountMatch[1].replace('.','')))fail('BILL_JD_REFUND_INVALID');
   seen.add(sourceId);
   if(!['\u4ea4\u6613\u6210\u529f','\u5145\u503c\u6210\u529f','\u8fd8\u6b3e\u6210\u529f','\u9884\u6388\u6743\u51bb\u7ed3\u6210\u529f','\u9884\u6388\u6743\u89e3\u51bb\u6210\u529f','\u9884\u6388\u6743\u652f\u4ed8\u6210\u529f'].includes(state))fail('BILL_JD_STATUS_UNKNOWN');
   const authorization=/^\u9884\u6388\u6743(?:\u51bb\u7ed3|\u89e3\u51bb)\u6210\u529f$/.test(state),repayment=/\u8fd8\u6b3e/.test(description),ambiguous=repayment&&/\u767d\u6761\/\u91d1\u6761/.test(description),refund=/^\u9000\u6b3e-/.test(description)&&directionText==='\u4e0d\u8ba1\u6536\u652f',amountMinor=BigInt(amountMatch[1].replace('.','')).toString(),direction=refund||directionText==='\u6536\u5165'?'credit':directionText==='\u652f\u51fa'?'debit':'neutral';
   const kind=authorization?'unknown':refund?'refund':repayment?'debt_payment':direction==='debit'?'expense':direction==='credit'?'income':'transfer',relations=[];
   if(!authorization){
    if(repayment&&!ambiguous&&(counterparty==='\u4eac\u4e1c\u767d\u6761'||category==='\u767d\u6761'))relations.push({product:'jd_baitiao',role:'target',activity:'repayment'});
    else if(description==='\u4eac\u4e1c\u5c0f\u91d1\u5e93-\u8f6c\u5165')relations.push({product:'jd_xiaojinku',role:'target',activity:'investment_deposit'});
    if(paymentChannel==='\u4eac\u4e1c\u767d\u6761'&&direction==='debit')relations.push({product:'jd_baitiao',role:'funding',activity:'credit_charge'});
    if(paymentChannel==='\u4eac\u4e1c\u5c0f\u91d1\u5e93')relations.push({product:'jd_xiaojinku',role:'funding',activity:direction==='credit'?'funding_inflow':'funding_outflow'});
   }
   result.records.push({sourceTransactionId:sourceId,date,occurredAt:stamp.replace(' ','T')+'+08:00',currency:'CNY',amountMinor,direction,kind,status:'completed',description,counterparty,paymentChannel,paymentAccountHint:'',relatedReference:merchantOrderId,category,balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{...Object.fromEntries(HEADERS.map((h,i)=>[h,cells[i]])),periodStart:range[1],periodEnd:range[2],creditProductAmbiguous:ambiguous,...(amountMatch[2]?{refundedMinor:BigInt(amountMatch[2].replace('.','')).toString()}: {})},...(relations.length?{accountRelations:relations}:{})});
  }
  result.warnings.push({line:1,code:'BILL_JD_CREDIT_FEES_NOT_INCLUDED',message:'\u53ef\u4f9d\u636e\u6d88\u8d39\u4e0e\u8fd8\u6b3e\u5efa\u7acb\u767d\u6761\u5f80\u6765\uff1b\u6b64\u5bfc\u51fa\u4e0d\u4fdd\u8bc1\u5305\u542b\u767d\u6761\u5168\u90e8\u8d39\u7528\u3001\u671f\u521d\u548c\u5f53\u524d\u6b20\u6b3e\u3002'});
 }catch(error){result.records=[];result.errors.push({line:1,code:error.code||'BILL_JD_INVALID',message:'\u4eac\u4e1c\u8d26\u5355\u7684\u8868\u5934\u3001\u7b14\u6570\u3001\u65e5\u671f\u3001\u91d1\u989d\u3001\u72b6\u6001\u6216\u8ba2\u5355\u53f7\u6821\u9a8c\u5931\u8d25'});}
 for(const record of result.records){const rewards=inferAccountRelations(record,'jd');if(rewards.length)record.accountRelations=[...(record.accountRelations||[]),...rewards];}
 return result;
}
module.exports={parseJdCsvRows};
