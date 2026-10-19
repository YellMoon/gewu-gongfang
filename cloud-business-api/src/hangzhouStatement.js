'use strict';
const {createHash}=require('node:crypto');
const {money,date}=require('./creditBankStatements');
function parseHangzhouPdf(pages){
 const all=pages.flatMap(p=>p.items).map(i=>i.str).join('').normalize('NFKC').replace(/\s/g,'');
 if(!all.includes('\u676d\u5dde\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6'))return null;
 const result={provider:'hangzhou',templateId:'hangzhou-debit-v1',records:[],errors:[],warnings:[]};
 try{
  const range=all.match(/\u8d77\u6b62\u65f6\u95f4[:\uff1a](\d{4})\.(\d{2})\.(\d{2})-(\d{4})\.(\d{2})\.(\d{2})/),account=all.match(/\u8d26\u53f7[:\uff1a](\d{12,})/),name=all.match(/\u6237\u540d[:\uff1a](.*?)\u5e01\u79cd/);
  if(!range||!account||!name)throw Error('BILL_BANK_HEADER_INVALID');
  const periodStart=range.slice(1,4).join('-'),lastDate=range.slice(4,7).join('-'),periodEnd=new Date(Date.parse(lastDate)+86400000).toISOString().slice(0,10),tail=account[1].slice(-4);
  if(!date(periodStart)||!date(lastDate)||periodEnd<=periodStart)throw Error('BILL_BANK_PERIOD_INVALID');
  const bankAccount={provider:'\u676d\u5dde\u94f6\u884c',type:'debit_card',maskedIdentifier:tail,currency:'CNY'},raw=[];
  for(const page of pages){
   const items=page.items.filter(i=>i.y>40);
   const starts=items.filter(i=>i.x<50&&/^\d+$/.test(i.str)&&items.some(j=>j.x>=50&&j.x<113&&Math.abs(j.y-i.y)<1&&date(j.str))).sort((a,b)=>b.y-a.y);
   for(let i=0;i<starts.length;i++){
    const at=starts[i],top=i?(starts[i-1].y+at.y)/2:at.y+15,bottom=i+1<starts.length?(at.y+starts[i+1].y)/2:40;
    const band=items.filter(j=>j.y<=top&&j.y>bottom).sort((a,b)=>b.y-a.y||a.x-b.x),column=(left,right)=>band.filter(j=>j.x>=left&&j.x<right).map(j=>j.str).join('').trim();
    raw.push({sequence:Number(at.str),date:date(column(50,113)),amount:money(column(113,175)),balance:money(column(175,240)),description:column(240,350),counterAccount:column(350,455),counterparty:column(455,610)});
   }
  }
  raw.sort((a,b)=>a.sequence-b.sequence);if(!raw.length||raw.some((r,i)=>r.sequence!==i+1||!date(r.date)||r.date<periodStart||r.date>lastDate||i&&r.balance-raw[i-1].balance!==r.amount))throw Error('BILL_BANK_BALANCE_CHAIN_INVALID');
  const income=raw.filter(r=>r.amount>0n).reduce((s,r)=>s+r.amount,0n),expense=raw.filter(r=>r.amount<0n).reduce((s,r)=>s-r.amount,0n),totalIn=all.match(/\u6536\u5165\u5408\u8ba1[:\uff1a]([\d,.]+)/),totalOut=all.match(/\u652f\u51fa\u5408\u8ba1[:\uff1a]([\d,.]+)/);
  if(!totalIn||!totalOut||money(totalIn[1])!==income||money(totalOut[1])!==expense)throw Error('BILL_BANK_TOTAL_INVALID');
  const seen=new Map();
  for(const r of raw){
   const credit=r.amount>=0n,amount=credit?r.amount:-r.amount,description=r.description.normalize('NFKC'),ownerTransfer=r.counterparty===name[1]||r.counterparty==='\u652f\u4ed8\u5b9d-'+name[1],investment=/\u7406\u8d22\u7533\u8d2d|\u7406\u8d22\u8d4e\u56de|\u57fa\u91d1\u8d4e\u56de|\u6295\u8d44\u8d4e\u56de/.test(description);
   const kind=/\u5229\u606f|\u7406\u8d22\u5206\u7ea2|\u5de5\u8d44/.test(description)&&credit?'income':/\u4fe1\u7528\u5361\u8fd8\u6b3e|\u8d37\u6b3e\u8fd8\u672c|\u8fd8\u672c\u4ed8\u606f/.test(description+r.counterparty)?'debt_payment':ownerTransfer||investment||/\u6c47\u5151|\u7f51\u8f6c|\u4e91\u95ea\u4ed8\u8f6c\u8d26/.test(description)?'transfer':!credit&&description==='\u6d88\u8d39'?'expense':'unknown';
   const key=JSON.stringify([tail,r.date,r.amount.toString(),r.balance.toString(),description,r.counterAccount,r.counterparty]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   result.records.push({sourceTransactionId:'hangzhou:'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:r.date,occurredAt:r.date+'T23:59:59+08:00',currency:'CNY',amountMinor:amount.toString(),direction:credit?'credit':'debit',kind,status:'completed',description,counterparty:r.counterparty,paymentChannel:'',paymentAccountHint:'',relatedReference:'',category:kind==='unknown'?'\u5f85\u5206\u7c7b':'',balanceMinor:r.balance.toString(),balanceConvention:'signed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{sequence:r.sequence,periodStart,periodLastDate:lastDate,description,counterAccount:'****'+r.counterAccount.replace(/\D/g,'').slice(-4),counterparty:r.counterparty},bankAccount,statementFlow:{schema:'hangzhou-debit-v1',sequence:r.sequence,periodStart,periodEnd,incomeMinor:(credit?amount:0n).toString(),expenseMinor:(credit?0n:amount).toString(),balanceKind:'total'}});
  }
  result.accountIdentity=bankAccount;
  result.warnings.push({line:1,code:'BILL_BANK_TRANSFERS_RETAINED',message:'\u5df2\u6821\u9a8c\u9010\u884c\u4f59\u989d\u548c\u6536\u5165\u3001\u652f\u51fa\u5408\u8ba1\uff1b\u672a\u6ce8\u660e\u7528\u9014\u7684\u6c47\u5151\u4fdd\u7559\u4e3a\u8f6c\u8d26\uff0c\u7406\u8d22\u7533\u8d2d\u8d4e\u56de\u4fdd\u7559\u8d44\u91d1\u5212\u8f6c\u8bb0\u5f55\u3002'});
 }catch(e){result.records=[];result.errors.push({line:1,code:e.code||e.message||'BILL_BANK_INVALID',message:'Hangzhou statement rows, totals or balance chain failed validation'});}
 return result;
}
module.exports={parseHangzhouPdf};
