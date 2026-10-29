'use strict';
const {money,date,assemble}=require('./creditBankStatements');
const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>{throw Object.assign(Error(code),{code});};
const printMoney=v=>{let s=compact(v).replace(/,/g,'');const deposit=s.endsWith('(\u5b58\u6b3e)');if(deposit)s=s.slice(0,-4);if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s)||deposit&&s.startsWith('-'))fail('BILL_BANK_AMOUNT_INVALID');const [a,b='']=s.split('.'),amount=money(a+'.'+b.padEnd(2,'0'));return deposit?-amount:amount;};
function joinedRows(input) {
  const rows=[];
  for(let i=0;i<input.length;i++) {
    const r=input[i].map(s=>String(s).normalize('NFKC').trim()).filter(Boolean),next=input[i+1]?.map(s=>String(s).normalize('NFKC').trim()).filter(Boolean),last=input[i+2]?.map(s=>String(s).normalize('NFKC').trim()).filter(Boolean);
    if(r.length===1&&/^\((?:\u6d88\u8d39|\u8fd8\u6b3e|\u9000\u8d27|\u9000\u6b3e)\)/.test(r[0])&&next?.length===6&&/^\d{4}\/\d{2}\/\d{2}$/.test(next[0])&&last?.length===1&&/^[\u4e00-\u9fffA-Za-z().&-]{1,30}$/.test(compact(last[0]))&&!/^\u5361\u53f7|^\u4ea4\u6613|^\u6ce8/.test(last[0])){rows.push([next[0],next[1],r[0]+(/[A-Za-z]$/.test(r[0])&&/^[A-Za-z]/.test(last[0])?' ':'')+last[0],...next.slice(2)]);i+=2;}else rows.push(r);
  }
  return rows;
}
function parseCgbPdfRows(rows) {
  const text=compact(rows.flat().join(''));
  if(!text.includes('\u53d1\u73b0\u7cbe\u5f69')||!text.includes('\u4fe1\u7528\u5361\u8d26\u6237\u4fe1\u606f')||!text.includes('\u5361\u53f7\u672b\u56db\u4f4d\u672c\u671f\u8d26\u5355\u91d1\u989d\u6700\u4f4e\u8fd8\u6b3e\u989d'))return null;
  const result={provider:'cgb',templateId:'bank-credit-cgb-v1',records:[],errors:[],warnings:[]};
  try {
    const period=text.match(/\u8d26\u5355\u5468\u671f(\d{4}\/\d{2}\/\d{2})-(\d{4}\/\d{2}\/\d{2})/),start=date(period?.[1]),end=date(period?.[2]);
    if(!start||!end||start>end||Date.parse(end)-Date.parse(start)>32*86400000)fail('BILL_BANK_PERIOD_INVALID');
    const summaries=new Map(),totals=new Map(),transactions=[],pages=[];let tail=null,section='head',footer=false;
    for(const raw of joinedRows(rows)) {
      const r=raw.map(s=>String(s).normalize('NFKC').trim()).filter(Boolean),s=compact(r.join(''));
      const pagination=s.match(/^(\d{1,3})\/(\d{1,3})$/);if(pagination){pages.push(pagination.slice(1).map(Number));continue;}
      if(s==='\u4ea4\u6613\u660e\u7ec6')section='detail';
      if(['\u672c\u671f\u8d26\u5355\u91d1\u989d\u60c5\u51b5','\u672c\u671f\u8d26\u5355\u91d1\u989d'].includes(s)){section='total';footer=true;}
      if(['\u79ef\u5206\u6c47\u603b\u60c5\u51b5','\u79ef\u5206\u4f59\u989d','\u5206\u671f\u660e\u7ec6'].includes(s))section='other';
      if(section==='head'&&/^\d{4}$/.test(r[0])&&r.length===7&&r[4]==='\u4eba\u6c11\u5e01') {
        const [bill,minimum,deposit,limit]=[r[1],r[2],r[5],r[6]].map(v=>v==='\u65e0\u6b20\u6b3e'?0n:printMoney(v));if(summaries.has(r[0])||!date(r[3])||minimum<0n||deposit<0n||limit<0n)fail('BILL_BANK_TOTAL_INVALID');
        summaries.set(r[0],{bill,deposit,minimum,due:date(r[3])});continue;
      }
      if(section==='total'&&/^\d{4}$/.test(r[0])) {
        if(r[1]!=='\u4eba\u6c11\u5e01'||totals.has(r[0]))fail('BILL_BANK_TOTAL_INVALID');let previous,debit,credit,current;
        if(r.length===9&&r[3]==='+'&&r[5]==='-'&&r[7]==='=')[previous,debit,credit,current]=[r[2],r[4],r[6],r[8]].map(printMoney);
        else if(r.length===15&&r[3]==='='&&r[5]==='-'&&r[7]==='+'&&r[9]==='-'&&r[11]==='+'&&r[13]==='+'){
          const [now,prior,repayment,consumption,adjustment,interest,installmentInterest]=[r[2],r[4],r[6],r[8],r[10],r[12],r[14]].map(printMoney);current=now;previous=prior;debit=consumption+interest+installmentInterest+(adjustment<0n?-adjustment:0n);credit=repayment+(adjustment>0n?adjustment:0n);
        } else fail('BILL_BANK_TOTAL_INVALID');
        if(debit<0n||credit<0n||previous+debit-credit!==current)fail('BILL_BANK_TOTAL_INVALID');totals.set(r[0],{previous,debit,credit,current});continue;
      }
      const card=s.match(/^\u5361\u53f7[:\uff1a]\d{4,6}\*{3,}(\d{4})$/);
      if(card){if(section!=='detail'||!summaries.has(card[1]))fail('BILL_BANK_CARD_INVALID');tail=card[1];continue;}
      if(section==='detail'&&['\u6d88\u8d39\u5229\u606f','\u73b0\u91d1\u5229\u606f'].includes(r[0])){
        if(!tail||r.length!==5||r[2]!=='\u4eba\u6c11\u5e01'||r[4]!=='\u4eba\u6c11\u5e01')fail('BILL_BANK_ROW_INVALID');const amount=money(r[3]);if(amount<0n||money(r[1])!==amount)fail('BILL_BANK_ROW_INVALID');transactions.push({trade:end,posted:end,dateBasis:'statement_date',tail,description:r[0],amount,credit:false,kind:'interest'});continue;
      }
      if(!/^\d{4}\/\d{2}\/\d{2}$/.test(r[0]))continue;
      if(section!=='detail'||!tail||r.length!==7||r[4]!=='\u4eba\u6c11\u5e01'||r[6]!=='\u4eba\u6c11\u5e01')fail('BILL_BANK_ROW_INVALID');
      const trade=date(r[0]),posted=date(r[1]),original=money(r[3]),amount=money(r[5]);if(!trade||!posted||posted<start||posted>end||original!==amount)fail('BILL_BANK_ROW_INVALID');
      const installment=/^\(\u5206\u671f\)\u94f6\u8054\u5206\u671f\d{6,32}\/\d{2}\/\d{2}\u671f$/.test(r[2]);
      transactions.push({trade,posted,tail,description:r[2],amount,credit:amount<0n,...(installment&&amount>=0n?{kind:'unknown',nonCash:true}:{})});
    }
    if(!pages.length||pages.some(([p,n])=>n!==pages.length||p<1||p>n)||new Set(pages.map(([p])=>p)).size!==pages.length)fail('BILL_BANK_PAGE_SEQUENCE_INVALID');
    if(!summaries.size||summaries.size!==totals.size||!footer)fail('BILL_BANK_TOTAL_INVALID');
    const balances=[];
    for(const [card,t] of totals) {
      const head=summaries.get(card);if(!head||head.bill-head.deposit!==t.current)fail('BILL_BANK_TOTAL_INVALID');
      const rows=transactions.filter(x=>x.tail===card),debit=rows.filter(x=>!x.credit).reduce((s,x)=>s+x.amount,0n),credit=rows.filter(x=>x.credit).reduce((s,x)=>s-x.amount,0n);
      if(debit!==t.debit||credit!==t.credit)fail('BILL_BANK_TOTAL_INVALID');
      balances.push({tail:card,amount:t.current,extra:{previousBalance:t.previous.toString(),statementDebitMinor:t.debit.toString(),statementCreditMinor:t.credit.toString(),periodStart:start,periodEnd:end}});
    }
    return assemble({provider:'cgb',statementDate:end,transactions,balances});
  } catch(error) {result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'CGB PDF statement rows, cards, pages or totals failed validation'});return result;}
}
module.exports={parseCgbPdfRows};
