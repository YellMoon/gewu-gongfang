'use strict';
const {createHash}=require('node:crypto');
const compact=v=>String(v||'').normalize('NFKC').replace(/\s/g,''),mask=v=>String(v).replace(/\d{12,}/g,n=>'****'+n.slice(-4));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const iso=s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const money=s=>{if(!/^-?\d+\.\d{2}$/.test(s))fail('BILL_BANK_AMOUNT_INVALID');const [a,b]=s.replace('-','').split('.');return (BigInt(a)*100n+BigInt(b))*(s.startsWith('-')?-1n:1n);};
const labels=['交易日期','交易时间','交易账号','交易名称','交易金额','账户余额','对手姓名','对手账号','交易摘要'];
const headers=[91.22,133.06,181.18,235.57,289.96,338.08,379.92,423.85,467.78],lefts=[90.3,132.14,173.98,228.37,282.76,337.16,379,420.84,466.86,507.7];
function parseSpdbDebitPdf(pages){
 const first=pages?.[0]?.items||[],all=first.map(i=>compact(i.str)).join('');
 if(!all.includes('上海浦东发展银行个人客户交易流水专用回单'))return null;
 const result={provider:'spdb',templateId:'spdb-debit-v1',records:[],errors:[],warnings:[]};
 try{
  const card=all.match(/账号:(\d{12,24})/)?.[1],owner=all.match(/户名:([^:]+?)账号:/)?.[1],range=all.match(/起止日期:(\d{8})-(\d{8})/);
  if(!card||!owner||!range||!all.includes('币种:人民币')||!all.includes('交易类型:全部'))fail('BILL_BANK_ACCOUNT_INVALID');
  const start=iso(range[1]),end=iso(range[2]);if(!validDate(start)||!validDate(end)||end<start)fail('BILL_BANK_PERIOD_INVALID');
  const headerItems=labels.map((label,c)=>first.filter(i=>compact(i.str)===label&&Math.abs(i.x-headers[c])<2));
  if(headerItems.some(h=>h.length!==1)||headerItems.some(h=>Math.abs(h[0].y-headerItems[0][0].y)>1))fail('BILL_BANK_HEADER_INVALID');
  const accountIdentity={provider:'浦发银行',type:'debit_card',maskedIdentifier:card.slice(-4),currency:'CNY'},parsed=[];
  let lastTime='',balance=null;
  for(const [index,page]of pages.entries()){
   const items=page.items.filter(i=>compact(i.str)),text=items.map(i=>compact(i.str)).join(''),footers=items.map(i=>compact(i.str)).map(t=>t.match(/^\u7b2c(\d+)\u9875\/\u5171(\d+)\u9875,Page(\d+)of(\d+)$/)).filter(Boolean),footer=footers.length===1?footers[0]:null;
   if(!footer||+footer[1]!==index+1||+footer[2]!==pages.length||+footer[3]!==index+1||+footer[4]!==pages.length||page.number!==index+1)fail('BILL_BANK_PAGE_INVALID');
   if([...text.matchAll(/账号:(\d{12,24})/g)].some(m=>m[1]!==card))fail('BILL_ACCOUNT_MIXED');
   const col=x=>lefts.findIndex((left,c)=>c<9&&x>=left-0.8&&x<lefts[c+1]-0.8),body=items.filter(i=>i.y>40&&i.y<(index===0?headerItems[0][0].y-40:810)&&col(i.x)>=0);
   const anchors=body.filter(i=>col(i.x)===0&&/^\d{8}$/.test(compact(i.str))).sort((a,b)=>b.y-a.y);
   if(!anchors.length||body.filter(i=>col(i.x)===1&&/^\d{1,6}$/.test(compact(i.str))).length!==anchors.length)fail('BILL_BANK_COUNT_INVALID');
   for(const [j,anchor]of anchors.entries()){
    const cells=Array.from({length:9},()=>[]),floor=anchors[j+1]?.y??40;
    for(const i of body.filter(i=>i.y<=anchor.y+1&&i.y>floor+1).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x))cells[col(i.x)].push(compact(i.str));
    const row=cells.map(c=>c.join('')),date=iso(row[0]),time=row[1].padStart(6,'0');
    if(!/^\d{8}$/.test(row[0])||!validDate(date)||date<start||date>end||row[2]!==card||!/^\d{6}$/.test(time)||+time.slice(0,2)>23||+time.slice(2,4)>59||+time.slice(4)>59||!row[3])fail('BILL_BANK_ROW_INVALID');
    const occurredAt=date+'T'+time.slice(0,2)+':'+time.slice(2,4)+':'+time.slice(4)+'+08:00',delta=money(row[4]),nextBalance=money(row[5]);
    if(delta===0n||lastTime&&occurredAt<lastTime||balance!==null&&balance+delta!==nextBalance)fail('BILL_BANK_RECONCILIATION_FAILED');lastTime=occurredAt;balance=nextBalance;
    const bankReference=row[3].match(/\d{10,}$/)?.[0]||'',description=mask(bankReference?row[3].slice(0,-bankReference.length):row[3]),counterparty=mask(row[6]);
    const own=counterparty===owner||description==='支付宝-'+owner;
    const kind=delta>0n&&(/季息|^利息$|工资/.test(description))?'income':delta<0n&&/信用卡还款|贷款还款/.test(description)?'debt_payment':own||/银联入账:余额宝|基金赎回|基金申购/.test(description)?'transfer':'unknown';
    const rawFields=Object.fromEntries(labels.map((label,c)=>[label,mask(row[c])]));rawFields.counterAccount=rawFields['对手账号'];rawFields.counterparty=counterparty;rawFields.dateBasis='transaction_date';
    const key=JSON.stringify([card.slice(-4),occurredAt,String(delta),String(nextBalance),rawFields]);
    parsed.push({key,delta,balance:nextBalance,date,occurredAt,kind,description,counterparty,rawFields,bankReference:mask(bankReference),page:index+1,counterNumber:row[7]});
   }
  }
  const seen=new Map();
  for(const [i,r]of parsed.entries()){
   const ordinal=(seen.get(r.key)||0)+1;seen.set(r.key,ordinal);
   result.records.push({sourceTransactionId:'spdb-debit:'+createHash('sha256').update(r.key+':'+ordinal).digest('hex'),date:r.date,occurredAt:r.occurredAt,amountMinor:String(r.delta<0n?-r.delta:r.delta),currency:'CNY',direction:r.delta<0n?'debit':'credit',kind:r.kind,status:'completed',description:r.description,counterparty:r.counterparty,category:r.kind==='income'?(/工资/.test(r.description)?'工资收入':'利息收入'):'',paymentChannel:'',paymentAccountHint:'',balanceMinor:String(r.balance),balanceConvention:'signed',principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:r.bankReference,rawFields:r.rawFields,bankAccount:accountIdentity,statementFlow:{schema:'spdb-debit-v1',sequence:i+1,periodStart:start,periodEnd:end,incomeMinor:String(r.delta>0n?r.delta:0n),expenseMinor:String(r.delta<0n?-r.delta:0n),balanceKind:'total',timePrecision:'second',openingBeforeFirstMinor:i===0?String(r.balance-r.delta):null}});
  }
  result.statementAccountIdentities={schema:'bank-account-identities-v1',ownAccountFingerprint:createHash('sha256').update('bank-account-number-v1:'+card,'utf8').digest('hex'),ownMaskedIdentifier:card.slice(-4),counterpartFingerprints:parsed.flatMap((r,i)=>/^\d{12,24}$/.test(r.counterNumber)?[{sourceTransactionId:result.records[i].sourceTransactionId,fingerprint:createHash('sha256').update('bank-account-number-v1:'+r.counterNumber,'utf8').digest('hex'),maskedIdentifier:r.counterNumber.slice(-4)}]:[])};
  result.accountIdentity=accountIdentity;result.statementOwner=require('../../shared/personal-finance/statementOwnership').validateStatementOwner({schema:'bank-statement-owner-v1',fullName:owner});
 }catch(error){result.records=[];delete result.accountIdentity;delete result.statementOwner;delete result.statementAccountIdentities;result.errors.push({line:1,code:error.code||'BILL_BANK_INVALID',message:'SPDB debit statement account, page, columns, timestamps or balance chain validation failed'});}
 return result;
}
module.exports={parseSpdbDebitPdf};
