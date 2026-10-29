'use strict';
const {createHash}=require('node:crypto');
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,''),money=s=>/^\d+\.\d{2}$/.test(s)?BigInt(s.replace('.','')):null;
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function parseHuaxiaMortgageRows(rows){
 const lines=rows.map(r=>r.map(compact).join('')),text=lines.join('');
 if(!lines.some(s=>s==='\u534e\u590f\u94f6\u884c\u4e2a\u4eba\u8d37\u6b3e\u8fd8\u6b3e\u8bb0\u5f55'))return null;
 const result={provider:'huaxia',templateId:'huaxia-mortgage-repayments-v1',records:[],errors:[],warnings:[]};
 try{
  const field=label=>text.match(new RegExp(compact(label).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':?(\\d+\\.\\d{2})'))?.[1],principal=money(field('\u8d37\u6b3e\u91d1\u989d')||''),remaining=money(field('\u8d37\u6b3e\u4f59\u989d')||''),total=money(field('\u5f52\u8fd8\u603b\u989d')||''),paidPrincipal=money(field('\u5df2\u5f52\u8fd8\u672c\u91d1')||''),paidInterest=money(field('\u5df2\u5f52\u8fd8\u5229\u606f\uff08\u542b\u7f5a\u606f\u3001\u606f\u5229\uff09')||'');
  const contract=text.match(/\u5408\u540c\u53f7:([A-Z0-9-]{6,64})/)?.[1],term=Number(text.match(/\u8d37\u6b3e\u671f\u9650:(\d{1,3})\u6708/)?.[1]),rate=text.match(/\u5e74\u5229\u7387:(\d+)\.(\d{4})%/),start=text.match(/\u67e5\u8be2\u5f00\u59cb\u65e5\u671f:(20\d{2}-\d{2}-\d{2})/)?.[1],end=text.match(/\u67e5\u8be2\u7ed3\u675f\u65e5\u671f:(20\d{2}-\d{2}-\d{2})/)?.[1],printed=text.match(/\u6253\u5370\u65e5\u671f:(20\d{2}-\d{2}-\d{2})/)?.[1];
  if([principal,remaining,total,paidPrincipal,paidInterest].some(v=>v===null)||!contract||!Number.isInteger(term)||term<1||term>600||!rate||!validDate(start||'')||!validDate(end||'')||!validDate(printed||'')||start>end||end>printed||paidPrincipal+remaining!==principal||paidPrincipal+paidInterest!==total||!text.includes('\u4e2a\u4eba\u4f4f\u623f\u6309\u63ed\u8d37\u6b3e(\u4e00\u624b)'))fail('BILL_MORTGAGE_HEADER_INVALID');
  const annualRatePpm=String(BigInt(rate[1])*10000n+BigInt(rate[2])),contractHash=createHash('sha256').update(contract).digest('hex'),entries=[];
  for(const [index,line]of lines.entries()){
   if(!/^\d+20\d{2}-\d{2}-\d{2}/.test(line))continue;
   const candidates=[];
   for(const cardPattern of ['\\*{4}\\d{4}','\\d{16}','\\d{19}']){
    const m=line.match(new RegExp('^(\\d{1,4})(20\\d{2}-\\d{2}-\\d{2})('+cardPattern+')(\\d+\\.\\d{2})(\\d+\\.\\d{2})(\\d+\\.\\d{2})(\\d+\\.\\d{2})(\\d{6,20})$'));
    if(!m)continue;const values=m.slice(4,8).map(money);if(values.some(v=>v===null)||values[0]!==values[1]+values[2]||values[0]<=0n)continue;
    candidates.push({sequence:Number(m[1]),date:m[2],cardTail:m[3].slice(-4),amount:values[0],principal:values[1],interest:values[2],balance:values[3],reference:m[8],sourceLine:index+1});
   }
   if(candidates.length!==1)fail('BILL_MORTGAGE_ROW_INVALID');entries.push(candidates[0]);
  }
  if(!entries.length||entries.some((e,i)=>e.sequence!==i+1||!validDate(e.date)||e.date<start||e.date>end||i&&e.date>entries[i-1].date)||new Set(entries.map(e=>e.cardTail)).size!==1||new Set(entries.map(e=>e.date+':'+e.reference)).size!==entries.length)fail('BILL_MORTGAGE_SEQUENCE_INVALID');
  const sum=key=>entries.reduce((s,e)=>s+e[key],0n),historyComplete=sum('principal')===paidPrincipal&&sum('interest')===paidInterest&&sum('amount')===total;
  let balance=entries.at(-1).balance+entries.at(-1).principal;
  if(historyComplete&&balance!==principal)fail('BILL_MORTGAGE_BALANCE_INVALID');
  for(const e of entries.slice().reverse()){if(balance-e.principal!==e.balance)fail('BILL_MORTGAGE_BALANCE_INVALID');balance=e.balance;}
  if(balance!==remaining||sum('principal')>paidPrincipal||sum('interest')>paidInterest)fail('BILL_MORTGAGE_TOTAL_INVALID');
  result.mortgageStatement={schema:'huaxia-mortgage-repayments-v1',contractHash,originalPrincipalMinor:String(principal),remainingPrincipalMinor:String(remaining),paidPrincipalMinor:String(paidPrincipal),paidInterestMinor:String(paidInterest),paidTotalMinor:String(total),termMonths:term,reportedAnnualRatePpm:annualRatePpm,periodStart:start,periodEnd:end,printedDate:printed,historyComplete,recordCount:entries.length,paymentCardTail:entries[0].cardTail};
  result.accountIdentity={provider:'\u534e\u590f\u94f6\u884c',type:'debit_card',maskedIdentifier:entries[0].cardTail,currency:'CNY'};
  for(const e of entries)result.records.push({sourceTransactionId:'huaxia-mortgage:'+contractHash+':'+e.date+':'+e.reference,date:e.date,occurredAt:e.date+'T23:59:59+08:00',amountMinor:String(e.amount),currency:'CNY',direction:'debit',kind:'debt_payment',status:'completed',description:'\u4e2a\u4eba\u4f4f\u623f\u6309\u63ed\u8d37\u6b3e\u8fd8\u6b3e\uff08\u94f6\u884c\u672c\u606f\u660e\u7ec6\uff09',counterparty:'\u534e\u590f\u94f6\u884c',category:'\u8d37\u6b3e\u8fd8\u6b3e',paymentChannel:'\u534e\u590f\u94f6\u884c\u50a8\u84c4\u5361('+e.cardTail+')',paymentAccountHint:'',balanceMinor:null,principalMinor:String(e.principal),interestMinor:String(e.interest),feeMinor:'0',relatedReference:e.reference,rawFields:{schema:'huaxia-mortgage-repayments-v1',contractHash,sequence:String(e.sequence),paymentCardTail:e.cardTail,amountMinor:String(e.amount),principalMinor:String(e.principal),interestMinor:String(e.interest),principalBalanceMinor:String(e.balance),originalPrincipalMinor:String(principal),reportedCurrentAnnualRatePpm:annualRatePpm,reportedTermMonths:String(term),reportedRemainingPrincipalMinor:String(remaining),periodStart:start,periodEnd:end,printedDate:printed,historyComplete:String(historyComplete),recordCount:String(entries.length),reference:e.reference}});
 }catch(error){result.records=[];result.errors.push({line:1,code:error.code||'BILL_MORTGAGE_INVALID',message:'Mortgage statement header, exact principal/interest totals or principal balance sequence failed validation'});delete result.mortgageStatement;delete result.accountIdentity;}
 return result;
}
module.exports={parseHuaxiaMortgageRows};
