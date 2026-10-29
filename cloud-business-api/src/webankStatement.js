'use strict';
// UTF-8 source. Parse the actual WeBank columns and verify running balances.
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const mask=v=>v.replace(/\d{12,}/g,s=>'****'+s.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
function money(v){if(!/^-?\d+\.\d{2}$/.test(v))fail('BILL_BANK_AMOUNT_INVALID');return BigInt(v.replace('.',''));}
const columns=[37.2,82.04,140.06,224.46,282.49,340.51,385.35,450,520,570];
function parseWebankPdf(pages){
 const first=(pages?.[0]?.items||[]).map(i=>compact(i.str)).join('');
 if(!first.includes('\u6df1\u5733\u524d\u6d77\u5fae\u4f17\u94f6\u884c\u5ba2\u6237\u4ea4\u6613\u660e\u7ec6\u8868'))return null;
 const result={provider:'webank',templateId:'webank-debit-v1',records:[],errors:[],warnings:[]};
 try{
  const card=first.match(/\u8d26\u53f7\/\u5361\u53f7:(?:Account\/CardNo\.:)?(\d{12,24})/)?.[1],owner=first.match(/\u6237\u540d:(?:AccountName:)?([\u4e00-\u9fff]{2,80})/)?.[1],range=first.match(/\u8d77\u59cb\u65e5\u671f:.*?(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5.*?\u7ec8\u6b62\u65e5\u671f:.*?(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5/);
  if(!card||!owner||!range||!first.includes('Currency:\u4eba\u6c11\u5e01CNY'))fail('BILL_BANK_HEADER_INVALID');
  const start=range.slice(1,4).join('-'),end=range.slice(4,7).join('-');
  if(!validDate(start)||!validDate(end)||start>end)fail('BILL_BANK_PERIOD_INVALID');
  const rows=[];
  for(const [index,page]of pages.entries()){
   const text=page.items.map(i=>compact(i.str)).join(''),footer=text.match(/\u7b2c(\d+)\u9875\u5171(\d+)\u9875/);
   if(!footer||Number(footer[1])!==index+1||Number(footer[2])!==pages.length)fail('BILL_BANK_PAGE_INVALID');
   if([...text.matchAll(/\u8d26\u53f7\/\u5361\u53f7:(?:Account\/CardNo\.:)?(\d{12,24})/g)].some(m=>m[1]!==card))fail('BILL_ACCOUNT_MIXED');
   const header=page.items.find(i=>compact(i.str)==='\u4ea4\u6613\u65e5\u671f'&&Math.abs(i.x-columns[0])<1);
   if(!header||!['\u4ea4\u6613\u91d1\u989d','\u8d26\u6237\u4f59\u989d'].every(s=>page.items.some(i=>compact(i.str)===s&&Math.abs(i.y-header.y)<1)))fail('BILL_BANK_HEADER_INVALID');
   const anchors=page.items.filter(i=>Math.abs(i.x-columns[0])<1&&/^\d{8}$/.test(i.str)&&i.y<header.y-15&&i.y>55).sort((a,b)=>b.y-a.y);
   if(!anchors.length)fail('BILL_BANK_DETAIL_UNAVAILABLE');
   const footerY=page.items.find(i=>/^\u7b2c\d+\u9875$/.test(compact(i.str)))?.y;
   if(!Number.isFinite(footerY))fail('BILL_BANK_PAGE_INVALID');
   const continued=rows.length&&rows.at(-1).cells[6]&&rows.at(-1).cells[6]!==card,leading=continued?page.items.filter(i=>i.y<header.y-25&&i.y>anchors[0].y+14).sort((a,b)=>b.y-a.y||a.x-b.x):[];
   if(continued){
    const previous=rows.at(-1),parts=columns.slice(0,-1).map((x,c)=>compact(leading.filter(i=>i.x>=x-1&&i.x<columns[c+1]-1).map(i=>i.str).join('')));
    if(parts[0]||parts[7]||parts[8]||previous.cells[6]+parts[6]!==card)fail('BILL_BANK_CONTINUATION_INVALID');
    for(let c=1;c<7;c++)previous.cells[c]+=parts[c];
   }
   for(const [n,anchor]of anchors.entries()){
    const top=n?(anchors[n-1].y+anchor.y)/2:continued?anchor.y+14:header.y-25,bottom=n+1<anchors.length?(anchor.y+anchors[n+1].y)/2:footerY+2;
    const items=page.items.filter(i=>i.y<top&&i.y>bottom).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x);
    const cells=columns.slice(0,-1).map((x,c)=>compact(items.filter(i=>i.x>=x-1&&i.x<columns[c+1]-1).map(i=>i.str).join('')));
    const date=cells[0].replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),delta=money(cells[7]),balance=money(cells[8]);
    if(!validDate(date)||date<start||date>end||delta===0n)fail('BILL_BANK_ROW_INVALID');
    rows.push({date,delta,balance,cells});
   }
  }
  for(let i=0;i<rows.length;i++){const r=rows[i],next=rows[i+1];if(r.cells[6]&&r.cells[6]!==card)fail('BILL_BANK_CARD_INVALID');if(next&&(next.date>r.date||r.balance-r.delta!==next.balance))fail('BILL_BANK_RECONCILIATION_FAILED');}
  const bankAccount={provider:'\u5fae\u4f17\u94f6\u884c',type:'debit_card',maskedIdentifier:card.slice(-4),currency:'CNY'},seen=new Map(),counterpartFingerprints=[];
  for(const [index,r]of rows.reverse().entries()){
   const [,counterparty,counterAccount,counterBank,description,remark]=r.cells,credit=r.delta>0n,investment=/\u8d27\u57fa\u7533\u8d2d|\u8d27\u57fa\u8d4e\u56de|\u57fa\u91d1\u7533\u8d2d|\u57fa\u91d1\u8d4e\u56de|\u666e\u901a\u8d4e\u56de|\u6d3b\u671f\+Plus\u8f6c\u51fa|\u7406\u8d22\u5b50\u8f6c\u51fa/.test(description),deposit=/^\u5b9a\u671f\u5b58\u5165$|^\u5b9a\u671f\u652f\u53d6$/.test(description);
   const kind=credit&&description==='\u5165\u606f'?'income':counterparty===owner||investment||deposit?'transfer':'unknown';
   const key=JSON.stringify([card,r.date,r.delta.toString(),r.balance.toString(),r.cells.slice(1,6)]),ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);
   result.records.push({sourceTransactionId:'webank:'+createHash('sha256').update(key+':'+ordinal).digest('hex'),date:r.date,occurredAt:r.date+'T23:59:59+08:00',currency:'CNY',amountMinor:String(credit?r.delta:-r.delta),direction:credit?'credit':'debit',kind,status:'completed',description,counterparty,paymentChannel:'\u5fae\u4f17\u94f6\u884c\u50a8\u84c4\u5361('+card.slice(-4)+')',paymentAccountHint:'',relatedReference:'',category:kind==='income'?'\u5229\u606f\u6536\u5165':kind==='transfer'?'\u8d26\u6237\u5212\u8f6c':'\u5f85\u6838\u5bf9',balanceMinor:String(r.balance),balanceConvention:'signed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{transactionDate:r.date,counterparty,counterAccount:mask(counterAccount),counterBank,description,remark,transactionCard:mask(r.cells[6])},bankAccount,statementFlow:{schema:'webank-debit-v1',sequence:index+1,periodStart:start,periodEnd:end,incomeMinor:String(credit?r.delta:0n),expenseMinor:String(credit?0n:-r.delta),balanceKind:'total',timePrecision:'day',openingBeforeFirstMinor:index===0?String(r.balance-r.delta):null}});
  }
  result.accountIdentity=bankAccount;
  for(const [index,row]of rows.entries()){const number=row.cells[2];if(/^\d{12,24}$/.test(number))counterpartFingerprints.push({sourceTransactionId:result.records[index].sourceTransactionId,fingerprint:createHash('sha256').update('bank-account-number-v1:'+number,'utf8').digest('hex'),maskedIdentifier:number.slice(-4)});}
  result.statementAccountIdentities={schema:'bank-account-identities-v1',ownAccountFingerprint:createHash('sha256').update('bank-account-number-v1:'+card,'utf8').digest('hex'),ownMaskedIdentifier:card.slice(-4),counterpartFingerprints};
  result.warnings.push({line:1,code:'BILL_WEBANK_PRODUCT_DETAIL_REQUIRED',message:'\u5df2\u6838\u9a8c\u9010\u884c\u4f59\u989d\uff1b\u6d3b\u671f\u6d41\u6c34\u4e2d\u7684\u7406\u8d22\u7533\u8d4e\u4e0d\u7b49\u4e8e\u7406\u8d22\u4ea7\u54c1\u5b8c\u6574\u4ea4\u6613\u6216\u6301\u4ed3\u660e\u7ec6\u3002'});
 }catch(error){result.records=[];delete result.accountIdentity;result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'\u5fae\u4f17\u94f6\u884c\u6d41\u6c34\u7684\u8d26\u6237\u3001\u9875\u7801\u3001\u65e5\u671f\u3001\u5217\u6216\u9010\u884c\u4f59\u989d\u6821\u9a8c\u5931\u8d25'});}
 return result;
}
module.exports={parseWebankPdf};
