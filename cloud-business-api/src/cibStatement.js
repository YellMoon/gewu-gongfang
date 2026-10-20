'use strict';
const {money,date,assemble}=require('./creditBankStatements');
const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function parseCibPdfRows(rows){
 const text=compact(rows.flat().join(''));
 if(!text.includes('\u5174\u4e1a\u94f6\u884c\u4fe1\u7528\u5361\u5bf9\u8d26\u5355')||!text.includes('IndustrialBankCreditCardStatement'))return null;
 const result={provider:'cib',templateId:'bank-credit-cib-v1',records:[],errors:[],warnings:[]};
 try{
  if(/\u7f8e\u5143\u8d26\u6237|USDAccount/.test(text))fail('BILL_BANK_CURRENCY_UNSUPPORTED');
  const groups=new Map();let current,summaryPending=false;
  for(const raw of rows){
   const r=raw.map(v=>String(v).normalize('NFKC').trim()).filter(Boolean),joined=compact(r.join(''));
   if(joined.includes('\u8d26\u5355\u65e5')&&joined.includes('STATEMENTDATE')){
    const stamp=joined.match(/(20\d{2})\u5e74(\d{2})\u6708(\d{2})\u65e5/),statementDate=stamp&&date(stamp.slice(1).join('-'));
    if(!statementDate)fail('BILL_BANK_PERIOD_INVALID');
    if(groups.has(statementDate))fail('BILL_BANK_DUPLICATE_PERIOD');
    current={statementDate,transactions:[],tails:new Set(),summary:null,headerBalance:null};groups.set(statementDate,current);summaryPending=false;continue;
   }
   if(!current){if(/^20\d{2}-\d{2}-\d{2}/.test(r[0]||''))fail('BILL_BANK_PERIOD_INVALID');continue;}
   if(joined.startsWith('\u672c\u671f\u5e94\u8fd8\u6b3e\u603b\u989d'))current.headerBalance=money(r.at(-1));
   if(joined.includes('PreviousBalance')&&joined.includes('FinanceCharge')){summaryPending=true;continue;}
   if(summaryPending){
    if(r.length!==6||!r.every(v=>/^[+-]?[\d,]+\.\d{2}$/.test(v)))fail('BILL_BANK_TOTAL_INVALID');
    if(current.summary)fail('BILL_BANK_TOTAL_INVALID');current.summary=r.map(money);summaryPending=false;continue;
   }
   const card=joined.match(/\u5361\u53f7\u672b\u56db\u4f4d(\d{4})/);if(card){current.tail=card[1];current.tails.add(card[1]);}
   if(!/^20\d{2}-\d{2}-\d{2}/.test(r[0]||''))continue;
   if(r.length!==4||!/^20\d{2}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d)?$/.test(r[0]))fail('BILL_BANK_ROW_INVALID');
   const trade=date(r[0].slice(0,10)),posted=date(r[1]),amount=money(r[3]),description=r[2];
   if(!trade||!posted||!current.tail||!description)fail('BILL_BANK_ROW_INVALID');
   const installment=amount>0n&&/\u7b2c\d+\u671f\u5171\d+\u671f/.test(compact(description))&&!/\u624b\u7eed\u8d39|\u5229\u606f|\u670d\u52a1\u8d39|\u8fdd\u7ea6\u91d1|\u6ede\u7eb3\u91d1/.test(description);
   const refinanced=amount<0n&&/\u8f6c\u5206\u671f\u4ed8\u6b3e/.test(description);
   const repayment=amount<0n&&/^\u8f6c\u8d26$/.test(description);
   current.transactions.push({trade,posted,tail:current.tail,description,amount,credit:amount<0n,...(installment||refinanced?{kind:'unknown',nonCash:true}:repayment?{kind:'debt_payment'}:{}),...(r[0].length>10?{sourceTradeDateTime:r[0]}:{})});
  }
  if(!groups.size||summaryPending)fail('BILL_BANK_PERIOD_INVALID');
  for(const g of groups.values()){
   const n=g.summary;if(!n||g.headerBalance===null||n[0]!==g.headerBalance||g.tails.size!==1)fail('BILL_BANK_TOTAL_INVALID');
   const parsed=assemble({provider:'cib',statementDate:g.statementDate,transactions:g.transactions,balances:[{tail:[...g.tails][0],amount:n[0]}],check(){
    if(n[0]!==n[1]-n[2]+n[3]+n[4]+n[5]||g.transactions.reduce((sum,t)=>sum+t.amount,0n)!==n[3]-n[2]+n[4]+n[5])fail('BILL_BANK_TOTAL_INVALID');
   }});result.records.push(...parsed.records);result.accountIdentity??=parsed.accountIdentity;
  }
  result.warnings=[{line:1,code:'BILL_CREDIT_BILLED_BALANCE',message:'\u5df2\u6309\u6bcf\u4e2a\u8d26\u671f\u6838\u9a8c\u660e\u7ec6\u4e0e\u8d26\u5355\u5408\u8ba1\uff1b\u5df2\u51fa\u8d26\u5e94\u8fd8\u6b3e\u4e0d\u4ee3\u8868\u5f53\u524d\u603b\u6b20\u6b3e\u3002\u5206\u671f\u672c\u91d1\u548c\u8f6c\u5206\u671f\u8bb0\u5f55\u4fdd\u7559\uff0c\u4e0d\u91cd\u590d\u8ba1\u6d88\u8d39\u3002'}];return result;
 }catch(error){result.records=[];delete result.accountIdentity;result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'CIB statement dates, rows or per-period totals failed validation'});return result;}
}
module.exports={parseCibPdfRows};
