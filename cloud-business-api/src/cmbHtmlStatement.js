'use strict';
const {htmlRows,money,date,assemble}=require('./creditBankStatements');

const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>{throw Object.assign(new Error(code),{code});};

// This layout has one CNY account, a six-value reconciliation and eight-cell
// transaction rows. Older image-only statements deliberately fail closed.
function parseCmbHtml(html){
 const {rows,text}=htmlRows(html),all=compact(text);
 if(!all.includes('\u62db\u5546\u94f6\u884c')&&!/(?:cmbchina\.com|cmbimg\.com)\//i.test(html))return null;
 const result={provider:'cmb',templateId:'bank-credit-cmb-v1',records:[],errors:[],warnings:[]};
 try{
  const periods=[...all.matchAll(/(\d{4}\/\d{2}\/\d{2})-(\d{4}\/\d{2}\/\d{2})/g)];
  if(periods.length!==1)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  const periodStart=date(periods[0][1]),statementDate=date(periods[0][2]);
  if(!periodStart||!statementDate||periodStart>statementDate||
    (Date.parse(statementDate)-Date.parse(periodStart))/86400000>32)fail('BILL_BANK_PERIOD_INVALID');
  const full=md=>{
   if(!/^\d{4}$/.test(md))fail('BILL_BANK_ROW_INVALID');
   const suffix=md.slice(0,2)+'-'+md.slice(2);
   const year=Number(statementDate.slice(0,4))-(suffix>statementDate.slice(5)?1:0);
   const value=date(year+'-'+suffix);if(!value)fail('BILL_BANK_ROW_INVALID');return value;
  };
  const transactions=[],summaries=[];
  for(const raw of rows){
   const r=raw.map(compact),nonempty=r.filter(Boolean);
   // The image headings do not contribute text; preserve cell positions.
   if(r.length===7&&!r[0]&&r.slice(1).every(v=>/^¥/.test(v))){
    summaries.push(r.slice(1).map(money));continue;
   }
   if(nonempty.length===6&&nonempty.every(v=>/^(?:¥|\$|USD|CNY|RMB|EUR)/.test(v))){
    fail('BILL_BANK_CURRENCY_UNSUPPORTED');
   }
   const looksLikeDetail=r.length>=6&&(!r[0]&&/^\d{4}$/.test(r[1]||r[2]))&&
    (/^[¥$]|^(?:CNY|RMB|USD|EUR)/.test(r[4]||'')||/^\d{4}$/.test(r[5]||''));
   if(!looksLikeDetail)continue;
   if(r.length!==8||r[0]||!r[3]||!/^\d{4}$/.test(r[5]))fail('BILL_BANK_ROW_INVALID');
   if(!/^¥/.test(r[4]))fail('BILL_BANK_CURRENCY_UNSUPPORTED');
   const posted=full(r[2]),trade=full(r[1]||r[2]),amount=money(r[4]);
   if(posted<periodStart||posted>statementDate)fail('BILL_BANK_ROW_INVALID');
   if(r[7])money(r[7]); // Original-currency amount may differ from the settled amount.
   transactions.push({trade,posted,tail:r[5],description:raw[3],amount,credit:amount<0n});
  }
  const tails=[...new Set(transactions.map(t=>t.tail))];
  if(!transactions.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');
  if(tails.length!==1)fail('BILL_BANK_CARD_INVALID');
  if(summaries.length!==1)fail('BILL_BANK_TOTAL_INVALID');
  const n=summaries[0];
  return assemble({provider:'cmb',statementDate,transactions,balances:[{tail:tails[0],amount:n[0]}],check(){
   const debit=transactions.filter(t=>!t.credit).reduce((s,t)=>s+t.amount,0n);
   const credit=transactions.filter(t=>t.credit).reduce((s,t)=>s-t.amount,0n);
   if(n[2]<0n||n[3]<0n||n[4]<0n||n[5]<0n||
      n[0]!==n[1]-n[2]+n[3]-n[4]+n[5]||
      debit!==n[3]+n[5]||credit!==n[2]+n[4])fail('BILL_BANK_TOTAL_INVALID');
  }});
 }catch(error){
  result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'CMB HTML detail, account or totals failed validation'});
  return result;
 }
}
module.exports={parseCmbHtml};
