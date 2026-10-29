'use strict';
const {createHash}=require('node:crypto');
const {parseDocument}=require('htmlparser2');
const {validDate}=require('../../shared/personal-finance/ledger');
const {explicitCardFundingCredit,ambiguousCardCredit}=require('../../shared/personal-finance/accountProducts');
const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const bankNames={cib:'\u5174\u4e1a\u94f6\u884c',spdb:'\u6d66\u53d1\u94f6\u884c',bocom:'\u4ea4\u901a\u94f6\u884c',ccb:'\u5efa\u8bbe\u94f6\u884c',cgb:'\u5e7f\u53d1\u94f6\u884c',citic:'\u4e2d\u4fe1\u94f6\u884c',czbank:'\u6d59\u5546\u94f6\u884c',cmb:'\u62db\u5546\u94f6\u884c'};
const fail=code=>{throw Object.assign(new Error(code),{code});};
function money(v){const s=compact(v).replace(/\(\u5df2\u7acb\u51cf\d+\.\d{2}\)$/,'').replace(/(?:CNY|RMB|\u4eba\u6c11\u5e01|[\u00a5\uffe5,])/g,'');if(!/^[+-]?\d+\.\d{2}$/.test(s))fail('BILL_BANK_AMOUNT_INVALID');const[a,b]=s.replace(/^[+-]/,'').split('.');return(BigInt(a)*100n+BigInt(b))*(s[0]==='-'?-1n:1n);}
function date(v){const s=compact(v).replace(/\//g,'-'),d=/^\d{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6):s;return validDate(d)?d:null;}
function htmlRows(html){
 const dom=parseDocument(html,{decodeEntities:true}),rows=[];let count=0,priorText='';
 const text=n=>['script','style','title'].includes(n.name)?'':n.type==='text'?n.data:(n.children||[]).map(text).join(n.name==='br'?'\n':'');
 const hasTable=n=>(n.children||[]).some(c=>c.name==='table'||hasTable(c));
 const visit=n=>{if(++count>300000)fail('BILL_HTML_SIZE_LIMIT');if(n.name==='tr'){const c=(n.children||[]).filter(c=>['td','th'].includes(c.name));if(c.length&&!c.some(hasTable)){const row=c.map(c=>text(c).replace(/\s+/g,' ').trim());row.context=compact(priorText);rows.push(row);}}if(n.type==='text')priorText=(priorText+n.data).slice(-2000);for(const c of n.children||[])visit(c);};
 visit(dom);return{rows,text:text(dom)};
}
function kindFor(s,credit){
 if(credit&&ambiguousCardCredit(s))return 'unknown';
 if(credit&&explicitCardFundingCredit(s))return 'debt_payment';
 if(/\u81ea\u52a8\u8fd8\u6b3e\u5931\u8d25|\u8fd8\u6b3e\u5931\u8d25/.test(s))return'unknown';
 if(credit)return /\u8fd8\u6b3e|\u8fd8\u8d37|\u94f6\u8054\u5165\u8d26|\u94f6\u8054\u5165\u5e10|\u8f6c\u5e10\u8fd8\u6b3e|\u8f6c\u8d26\u8fd8\u6b3e|\u81ea\u52a8\u6263\u6b3e|\u5b58\u6b3e|\u7f34\u6b3e|Payment/i.test(s)?'debt_payment':'refund';
 if(/^\u5206\u671f\u6263\u6b3e|\u5206\u671f.*\u672c\u91d1|\u672c\u91d1.*\u7b2c\d+\/\d+\u671f|\u6d88\u8d39.*:\u5206$/.test(s))return'unknown';
 if(/\u5229\u606f|\u5faa\u73af\u606f|Interest/i.test(s))return'interest';
 if(/\u624b\u7eed\u8d39|\u5e74\u8d39|\u670d\u52a1\u8d39|\u8fdd\u7ea6\u91d1|\u6ede\u7eb3\u91d1|\u5de5\u672c\u8d39/.test(s))return'fee';
 return'expense';
}
function assemble({provider,statementDate,transactions,balances,check,detailOnly=false}){
 if(!detailOnly&&!validDate(statementDate)||detailOnly&&balances.length)fail('BILL_BANK_PERIOD_INVALID');if(!transactions.length&&!balances.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');if(check)check();
 const seen=new Map(),identities=new Map(),records=[],defaultStatementDate=statementDate;
 const identity=(tail,currency='CNY')=>{if(!['CNY','USD'].includes(currency))fail('BILL_BANK_CURRENCY_UNSUPPORTED');if(!/^\d{4}$/.test(tail))fail('BILL_BANK_CARD_INVALID');const a={provider:bankNames[provider],type:'credit_card',maskedIdentifier:tail,currency};identities.set(tail+':'+currency,a);return a;};
 const base={currency:'CNY',status:'completed',paymentChannel:'',paymentAccountHint:'',relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:null};
 for(const t of transactions){
  const statementDate=t.statementDate||defaultStatementDate;
  if(!validDate(t.trade)||!validDate(t.posted)||t.posted<t.trade||!detailOnly&&(t.posted>statementDate||(Date.parse(statementDate)-Date.parse(t.trade))/86400000>370))fail('BILL_BANK_ROW_INVALID');
  const bankAccount=identity(t.tail,t.currency),amount=t.amount<0n?-t.amount:t.amount,description=t.description.normalize('NFKC').replace(/\d{12,}/g,s=>'****'+s.slice(-4)).replace(/\s+/g,' ').trim(),kind=t.kind||kindFor(description,t.credit),nonCash=t.nonCash??(kind==='unknown'&&!(t.credit&&ambiguousCardCredit(description)));
  const key=JSON.stringify([provider,t.tail,t.trade,t.posted,compact(description),t.amount.toString(),t.credit,...(t.currency&&t.currency!=='CNY'?[t.currency]:[])]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
  records.push({...base,currency:bankAccount.currency,sourceTransactionId:provider+':'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:t.trade,occurredAt:t.posted+'T23:59:59+08:00',amountMinor:amount.toString(),direction:nonCash?'neutral':t.credit?'credit':'debit',kind,description,counterparty:description,category:kind==='unknown'&&!nonCash?'\u5f85\u6838\u5bf9':nonCash?'\u5206\u671f\u672c\u91d1\u6216\u975e\u73b0\u91d1\u8bb0\u5f55':kind==='expense'?'\u5f85\u5206\u7c7b':kind==='interest'?'\u501f\u8d37\u5229\u606f':kind==='fee'?'\u624b\u7eed\u8d39':'\u4fe1\u7528\u5361\u8fd8\u6b3e\u4e0e\u9000\u6b3e',balanceMinor:null,rawFields:{...(t.sourceTradeDateTime?{sourceTradeDateTime:t.sourceTradeDateTime}:{}),dateBasis:t.dateBasis||'transaction_date',tradeDate:t.trade,postedDate:t.posted,cardTail:t.tail,statementDate,statementAmountMinor:t.amount.toString(),statementCredit:t.credit,excludedFromBilledTotal:!!t.excludedFromBilledTotal},bankStatement:{schema:detailOnly?'bank-credit-detail-v1':'bank-credit-v1',...(detailOnly?{}:{statementDate}),postedDate:t.posted,cardTail:t.tail,provider,nonCash},bankAccount});
 }
 for(const b of balances){const statementDate=b.statementDate||defaultStatementDate;records.push({...base,currency:b.currency||'CNY',bankAccount:identity(b.tail,b.currency),sourceTransactionId:provider+':billed:'+statementDate+':'+b.tail+(b.currency&&b.currency!=='CNY'?':'+b.currency:''),date:statementDate,occurredAt:statementDate+'T23:59:59+08:00',amountMinor:'0',direction:'neutral',kind:'unknown',description:'\u4fe1\u7528\u5361\u672c\u671f\u8d26\u5355\u5e94\u8fd8\u4f59\u989d',counterparty:bankNames[provider],category:'',balanceMinor:(-b.amount).toString(),balanceConvention:'signed',rawFields:{statementDate,newBalance:b.amount.toString(),...(b.extra||{})},balanceEvidence:{schema:'bank-credit-balance-v1',sequence:1,incomeMinor:'0',expenseMinor:'0',balanceKind:'billed_debt'}});}
 const accounts=[...identities.values()];if(!accounts.length)fail('BILL_BANK_CARD_INVALID');
 return{provider,templateId:'bank-credit-'+provider+'-v1',records,accountIdentity:accounts[0],errors:[],warnings:[{line:1,code:'BILL_CREDIT_BILLED_BALANCE',message:'\u5df2\u51fa\u8d26\u5e94\u8fd8\u4f59\u989d\u4e0d\u7b49\u4e8e\u5f53\u524d\u603b\u6b20\u6b3e\uff1b\u5206\u671f\u672c\u91d1\u53ca\u975e\u73b0\u91d1\u8bb0\u5f55\u4fdd\u7559\u539f\u59cb\u91d1\u989d\uff0c\u4e0d\u91cd\u590d\u8ba1\u5165\u6d88\u8d39\u3002'}]};
}
const amounts=row=>row.flatMap(v=>{try{return[money(v)];}catch{return[];}});
function parseCreditBankHtml(html){
 const{rows,text}=htmlRows(html),all=compact(text),raw=compact(html);
 const provider=all.includes('\u4ea4\u901a\u94f6\u884c')||raw.includes('bankcomm.com')?'bocom':all.includes('\u9f99\u5361\u4fe1\u7528\u5361\u5bf9\u8d26\u5355')?'ccb':all.includes('\u5e7f\u53d1\u94f6\u884c\u4fe1\u7528\u5361')||raw.includes('cgbchina.com')?'cgb':raw.includes('czbank.com')?'czbank':all.includes('\u4e2d\u4fe1\u94f6\u884c\u4fe1\u7528\u5361')||raw.includes('ecitic.com')?'citic':null;
 if(!provider)return null;const result={provider,templateId:'bank-credit-'+provider+'-v1',records:[],errors:[],warnings:[]};
 try{
  const transactions=[],balances=[];let statementDate,check=null,section='debit',tail=null,detailUnavailable=false;
  const period=all.match(/\u8d26\u5355\u5468\u671f(?:StatementCycle)?[:\uff1a]?(\d{4}\/\d{2}\/\d{2})-(\d{4}\/\d{2}\/\d{2})/);if(period)statementDate=date(period[2]);
  if(provider==='czbank'){
   const h=rows.findIndex(r=>r.some(c=>compact(c)==='CreditLimit'));if(h<0)fail('BILL_BANK_HEADER_INVALID');statementDate=date(rows[h+1][2]);
   const summary=rows.find((r,i)=>i>h&&r.includes('=')&&amounts(r).length===6);if(!summary)fail('BILL_BANK_TOTAL_INVALID');const n=amounts(summary);
   for(const r of rows){if(!date(r[0]))continue;if(r.length!==5)fail('BILL_BANK_ROW_INVALID');const a=money(r[3]);transactions.push({trade:date(r[0]),posted:date(r[1]),description:r[2],amount:a,tail:compact(r[4]),credit:a<0n});}
   const tails=[...new Set(transactions.map(t=>t.tail))];if(tails.length!==1)fail('BILL_BANK_CARD_INVALID');balances.push({tail:tails[0],amount:n[0]});
   check=()=>{if(n[0]!==n[1]-n[2]+n[3]+n[4]+n[5]||transactions.reduce((s,t)=>s+t.amount,0n)!==n[0]-n[1])fail('BILL_BANK_TOTAL_INVALID');};
  }else if(provider==='bocom'){
   if(!statementDate)fail('BILL_BANK_PERIOD_INVALID');
   const initialTail=all.match(/(\d{6}[*Xx\uFF0D-]{3,}\d{4})/)?.[1].slice(-4);if(!initialTail)fail('BILL_BANK_CARD_INVALID');
   const groups=new Map();let currentDate=statementDate;tail=initialTail;
   const periodRegex=/\u8d26\u5355\u5468\u671f(?:StatementCycle)?[:\uFF1A]?(\d{4}\/\d{2}\/\d{2})-(\d{4}\/\d{2}\/\d{2})/g;
   for(const row of rows){
    const context=(row.context||'')+compact(row.join('')),periods=[...context.matchAll(periodRegex)],lastPeriod=periods.at(-1);if(lastPeriod)currentDate=date(lastPeriod[2]);
    const creditAt=Math.max(context.lastIndexOf('\u4ee5\u4e0b\u662f\u60a8\u7684\u8fd8\u6b3e'),context.lastIndexOf('\u8fd8\u6b3e/\u9000\u8d27/\u8d39\u7528\u8fd4\u8fd8\u660e\u7ec6'),context.lastIndexOf('\u8fd8\u6b3e\u3001\u9000\u8d27\u3001\u8d39\u7528\u8fd4\u8fd8\u660e\u7ec6'));
    const debitAt=Math.max(context.lastIndexOf('\u4ee5\u4e0b\u662f\u60a8\u7684\u6d88\u8d39'),context.lastIndexOf('\u6d88\u8d39/\u53d6\u73b0/\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'),context.lastIndexOf('\u6d88\u8d39\u3001\u53d6\u73b0\u3001\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'));if(creditAt>=0||debitAt>=0)section=creditAt>debitAt?'credit':'debit';
    const card=context.match(/(\d{6}[*Xx-]{3,}\d{4})(?![\s\S]*\d{6}[*Xx-]{3,}\d{4})/);if(card)tail=card[1].slice(-4);
    const mention=compact(row.join('')).match(/\u4e3b\u5361\u5361\u53f7\u672b\u56db\u4f4d(\d{4})/);if(mention)tail=mention[1];
    const currency=row.some(c=>/USD|\u7f8e\u5143|\$/.test(c))?'USD':'CNY',key=currentDate+':'+currency,n=amounts(row);
    if([4,6].includes(n.length)&&row.some(c=>/[\u00a5\uFFE5]|\u4eba\u6c11\u5e01|\u7f8e\u5143\u8d26\u6237|\$/.test(c))&&!groups.has(key)){groups.set(key,{n,date:currentDate,tail,currency});}
    const c=row.filter(c=>compact(c));const dated=v=>{if(date(v))return date(v);const md=compact(v);if(!/^\d{2}\/\d{2}$/.test(md))return null;const y=Number(currentDate.slice(0,4))-(md.replace('/','-')>currentDate.slice(5)?1:0);return date(y+'-'+md.replace('/','-'));};if(!dated(c[0])||!dated(c[1]))continue;
    const withTail=/^\d{4}$/.test(compact(c[2]));
    const amountStart=withTail?4:3;
    if(c.length===amountStart+4&&/^(?:RMB|CNY|USD)$/.test(compact(c[amountStart]))&&/^(?:RMB|CNY|USD)$/.test(compact(c[amountStart+2])))c.splice(amountStart,4,c[amountStart]+c[amountStart+1],c[amountStart+2]+c[amountStart+3]);
    if(c.length!==(withTail?6:5))fail('BILL_BANK_ROW_INVALID');
    const settlement=compact(c.at(-1)),settlementCurrency=/^(?:RMB|CNY)/.test(settlement)?'CNY':/^USD/.test(settlement)?'USD':null;if(!settlementCurrency)fail('BILL_BANK_CURRENCY_UNSUPPORTED');
    const a=money(c.at(-1).replace(/^USD\s*/,''));transactions.push({currency:settlementCurrency,...(/\u81ea\u52a8\u8d2d\u6c47\u4eba\u6c11\u5e01\u6263\u6b3e/.test(c[withTail?3:2])?{kind:'transfer'}:{}),trade:dated(c[0]),posted:dated(c[1]),excludedFromBilledTotal:all.includes('\u5df2\u8f6c\u5206\u671f\u7684\u5546\u6237\u5206\u671f')&&/^\u6d88\u8d39(?:\u5546\u6237\u5206\u671f|\u626b\u7801\u5206\u671f|\u597d\u5546\u8d37)/.test(compact(c[withTail?3:2])),statementDate:currentDate,tail:withTail?compact(c[2]):tail,description:c[withTail?3:2],amount:section==='credit'?-a:a,credit:section==='credit'});
   }
   for(const{n,date,tail,currency}of groups.values()){
    const t=transactions.filter(t=>t.statementDate===date&&t.currency===currency),tails=[...new Set(t.map(x=>x.tail))];
    if(tails.length<=1&&(currency==='CNY'||t.length||n.some(v=>v!==0n)))balances.push({tail:tails[0]||tail,amount:n[0],statementDate:date,currency});
    const debit=t.filter(t=>!t.credit&&!t.excludedFromBilledTotal).reduce((s,x)=>s+x.amount,0n),extra=debit-n.slice(3).reduce((s,v)=>s+v,0n);
    if(extra>0n){const originals=t.filter(x=>!x.credit&&!x.excludedFromBilledTotal&&/^\u6d88\u8d39\u5546\u6237\u5206\u671f/.test(compact(x.description))&&t.some(y=>y.tail===x.tail&&compact(y.description).startsWith('\u5206\u671f\u6263\u6b3e1/')&&compact(y.description).endsWith(compact(x.description).slice(2))));if(originals.reduce((s,x)=>s+x.amount,0n)===extra)for(const x of originals)x.excludedFromBilledTotal=true;}
   }
   check=()=>{if(!groups.size)fail('BILL_BANK_TOTAL_INVALID');for(const{n,date,currency}of groups.values()){const t=transactions.filter(t=>t.statementDate===date&&t.currency===currency),credit=t.filter(t=>t.credit).reduce((s,t)=>s-t.amount,0n),debit=t.filter(t=>!t.credit&&!t.excludedFromBilledTotal).reduce((s,t)=>s+t.amount,0n);if(n[0]!==n[1]-n[2]+n.slice(3).reduce((s,v)=>s+v,0n)||credit!==n[2]||debit!==n.slice(3).reduce((s,v)=>s+v,0n))fail('BILL_BANK_TOTAL_INVALID');}if(transactions.some(t=>!groups.has(t.statementDate+':'+t.currency)))fail('BILL_BANK_TOTAL_INVALID');};
  }else if(provider==='ccb'){
   const h=rows.findIndex(r=>compact(r[0]).startsWith('\u672c\u671f\u8d26\u5355\u65e5'));statementDate=date(rows[h]?.[1]);const summary=rows.find(r=>compact(r[0]).startsWith('\u4eba\u6c11\u5e01')&&amounts(r).length===4);if(!summary)fail('BILL_BANK_TOTAL_INVALID');const n=amounts(summary);
   for(const r of rows){const c=r.map(compact);if(/^\d{6,}[*Xx\uff0d-]+\d{4}$/.test(c[0])&&c[1]==='\u4eba\u6c11\u5e01(CNY)')balances.push({tail:c[0].slice(-4),amount:money(c[2])});if(!date(c[0])||!date(c[1]))continue;if(![6,8].includes(r.length))fail('BILL_BANK_ROW_INVALID');const settled=r.length===8?c[6]+c[7]:c[5];if(!/^CNY/.test(settled))fail('BILL_BANK_CURRENCY_UNSUPPORTED');const a=money(settled);transactions.push({trade:date(c[0]),posted:date(c[1]),tail:c[2].match(/^\d{4}/)?.[0],description:r[3],amount:a,credit:a<0n});}
   const unbilled=all.match(/\u4e13\u9879\u5206\u671f\u5269\u4f59\u603b\u91d1\u989d[:\uFF1A]CNY([\d,.]+)/);
   if(unbilled){for(const b of balances)b.extra={statementUnbilledInstallmentPrincipalMinor:money(unbilled[1]).toString(),unbilledScope:'statement'};}
   check=()=>{
    const credit=transactions.filter(t=>t.credit).reduce((s,t)=>s-t.amount,0n),debit=transactions.filter(t=>!t.credit).reduce((s,t)=>s+t.amount,0n),extra=debit-n[1];
    if(extra>0n&&unbilled){
     const principal=transactions.filter(t=>!t.credit&&/:\u5206$/.test(t.description)),tails=new Set(principal.map(t=>t.tail)),original=transactions.filter(t=>!t.credit&&tails.has(t.tail)&&kindFor(t.description,false)==='expense');
     const originalSum=original.reduce((s,t)=>s+t.amount,0n),principalSum=principal.reduce((s,t)=>s+t.amount,0n);
     if(tails.size===1&&originalSum===extra&&originalSum===money(unbilled[1])+principalSum)for(const t of original)t.excludedFromBilledTotal=true;
    }
    const billedDebit=transactions.filter(t=>!t.credit&&!t.excludedFromBilledTotal).reduce((s,t)=>s+t.amount,0n);
    if(n[0]+n[1]-n[2]!==n[3]||billedDebit!==n[1]||credit!==n[2]||balances.reduce((s,b)=>s+b.amount,0n)!==n[3])fail('BILL_BANK_TOTAL_INVALID');
   };
  }else if(provider==='cgb'){
   statementDate=date(all.match(/\u8d26\u5355\u65e5[:\uff1a](\d{4}\/\d{2}\/\d{2})/)?.[1])||date(all.match(/\u8d26\u5355\u5468\u671f[:\uff1a]\d{4}\/\d{2}\/\d{2}\u81f3(\d{4}\/\d{2}\/\d{2})/)?.[1])||statementDate;const summaries=[];
   for(const r of rows){const s=compact(r.join('')),card=s.match(/^\u5361\u53f7[:\uff1a]\d+[*]+(\d{4})$/);if(card)tail=card[1];const sr=r.filter(v=>compact(v)),summaryCard=compact(sr[0]);if((/^\d{4}$/.test(summaryCard)&&sr.includes('=')||/^\d{4}\*+\d{4}$/.test(summaryCard)&&amounts(sr).length===4)&&sr[1]==='\u4eba\u6c11\u5e01'){const n=amounts(sr);if(![4,7].includes(n.length))fail('BILL_BANK_TOTAL_INVALID');const summaryTail=summaryCard.slice(-4);summaries.push({tail:summaryTail,n,detailOnlySummary:summaryCard.includes('*')});balances.push({tail:summaryTail,amount:n[0]});}const undated=!compact(r[0])&&!compact(r[1])&&r.length===7&&/\u5229\u606f/.test(r[2]);if(!undated&&(!date(r[0])||!date(r[1])))continue;if(![6,7].includes(r.length)||r[4]!=='\u4eba\u6c11\u5e01')fail('BILL_BANK_ROW_INVALID');const a=money(r[5]);transactions.push({trade:undated?statementDate:date(r[0]),posted:undated?statementDate:date(r[1]),dateBasis:undated?'statement_date':'transaction_date',tail,description:r[2],amount:a,credit:a<0n});}
   detailUnavailable=!transactions.length&&summaries.every(s=>s.detailOnlySummary);
   check=()=>{if(!summaries.length)fail('BILL_BANK_TOTAL_INVALID');for(const{tail,n}of summaries){const delta=transactions.filter(t=>t.tail===tail).reduce((s,t)=>s+t.amount,0n);const expected=n.length===4?n[2]-n[3]:n[3]-n[2]-n[4]+n[5]+n[6];if(n[0]!==n[1]+expected||delta!==expected&&!(detailUnavailable&&summaries.find(s=>s.tail===tail)?.detailOnlySummary))fail('BILL_BANK_TOTAL_INVALID');}};
  }else if(provider==='citic'){
   const m=all.match(/(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5\u8d26\u6237\u53d8\u52a8\u4fe1\u606f/);statementDate=m?m.slice(1).join('-'):null;
   for(const r of rows){const c=r.map(compact).filter(Boolean);if(/^\d{4}[-*\d]+\d{4}$/.test(c[0])&&c[0].includes('*')&&c[1]==='RMB'){const n=amounts(r);if(n.length!==5||n[0]-n[1]+n[2]!==n[3])fail('BILL_BANK_TOTAL_INVALID');balances.push({tail:c[0].slice(-4),amount:n[3],extra:{previousBalance:n[0].toString()}});}if(!date(c[0])||!date(c[1]))continue;if(![6,8].includes(c.length))fail('BILL_BANK_ROW_INVALID');const settled=c.length===8?c[6]+c[7]:c[5];if(!settled.startsWith('RMB'))fail('BILL_BANK_CURRENCY_UNSUPPORTED');const a=money(settled);transactions.push({trade:date(c[0]),posted:date(c[1]),tail:c[2].match(/^\d{4}/)?.[0],description:r.filter(v=>compact(v))[3],amount:a,...(a<0n&&/^\u7f51\u8054\u5165\u8d26/.test(c[3])?{kind:'unknown',nonCash:false}:{}),credit:a<0n});}
   check=()=>{if(!balances.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');for(const b of balances)if(transactions.filter(t=>t.tail===b.tail).reduce((s,t)=>s+t.amount,0n)!==b.amount-BigInt(b.extra.previousBalance))fail('BILL_BANK_TOTAL_INVALID');};
  }
  const parsed=assemble({provider,statementDate,transactions,balances,check});if(detailUnavailable)parsed.warnings.push({line:1,code:'BILL_BANK_SUMMARY_ONLY',message:'\u539f\u90ae\u4ef6\u4ec5\u63d0\u4f9b\u8d26\u5355\u6c47\u603b\uff0c\u5df2\u4fdd\u7559\u5df2\u51fa\u8d26\u5e94\u8fd8\u4f59\u989d\u51ed\u8bc1\uff1b\u7f3a\u5c11\u9010\u7b14\u660e\u7ec6\uff0c\u4e0d\u5c06\u6c47\u603b\u989d\u5f53\u6210\u6536\u652f\u4ea4\u6613\u3002'});return parsed;
 }catch(error){result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:error.message});return result;}
}
module.exports={parseCreditBankHtml,htmlRows,money,date,assemble,bankNames};
