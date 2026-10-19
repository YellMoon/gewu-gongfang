'use strict';
const {money,date,assemble}=require('./creditBankStatements');
function parseCmbPdfRows(rows){
 const text=rows.flat().join('').normalize('NFKC').replace(/\s/g,'');
 if(!text.includes('\u62db\u5546\u94f6\u884c\u4fe1\u7528\u5361\u5bf9\u8d26\u5355')||!text.includes('TransactionDetails'))return null;
 const result={provider:'cmb',templateId:'bank-credit-cmb-v1',records:[],errors:[],warnings:[]};
 try{
  const stamp=text.match(/(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5/),statementDate=stamp?.slice(1).join('-');
  if(!date(statementDate))throw Object.assign(Error(),{code:'BILL_BANK_PERIOD_INVALID'});
  const full=md=>{const year=Number(statementDate.slice(0,4))-(md.replace('/','-')>statementDate.slice(5)?1:0);return date(year+'-'+md.replace('/','-'));};
  const transactions=[];let end=false,summary;
  for(const raw of rows){
   const r=raw.map(s=>s.normalize('NFKC').trim()).filter(Boolean);
   if(r[0]==='\u672c\u671f\u5e94\u8fd8\u91d1\u989d'&&r.includes('\u4e0a\u671f\u8d26\u5355\u91d1\u989d'))end=true;
   if(end&&r.length===6&&r.every(v=>/^[\u00a5\uffe5]/.test(v)))summary=r.map(money);
   if(end||!/^\d{2}\/\d{2}$/.test(r[0]))continue;
   const two=/^\d{2}\/\d{2}$/.test(r[1]);if(r.length!==(two?6:5))throw Object.assign(Error(),{code:'BILL_BANK_ROW_INVALID'});
   const amount=money(r[two?3:2]);transactions.push({trade:full(r[0]),posted:full(two?r[1]:r[0]),tail:r[two?4:3],description:r[two?2:1],amount,credit:amount<0n});
  }
  const tails=[...new Set(transactions.map(t=>t.tail))];
  if(tails.length!==1||!summary)throw Object.assign(Error(),{code:'BILL_BANK_TOTAL_INVALID'});
  return assemble({provider:'cmb',statementDate,transactions,balances:[{tail:tails[0],amount:summary[0]}],check(){
   const debit=transactions.filter(t=>!t.credit).reduce((s,t)=>s+t.amount,0n),credit=transactions.filter(t=>t.credit).reduce((s,t)=>s-t.amount,0n),n=summary;
   if(n[0]!==n[1]-n[2]+n[3]-n[4]+n[5]||debit-credit!==n[3]-n[2]-n[4]+n[5])throw Object.assign(Error(),{code:'BILL_BANK_TOTAL_INVALID'});
  }});
 }catch(error){result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'CMB statement rows or totals failed validation'});return result;}
}
module.exports={parseCmbPdfRows};
