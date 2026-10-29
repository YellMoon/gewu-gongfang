'use strict';
const {validateLoanProof}=require('../../shared/personal-finance/loanProofs');
const hash=v=>require('node:crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex');
const minor=s=>{if(!/^\d+\.\d{2}$/.test(s))throw Error('BILL_LOAN_PROOF_AMOUNT');return String(BigInt(s.replace('.','')));};
function parseJiebeiLoanProof(rows){
 const lines=rows.map(r=>r.join(' ').normalize('NFKC').replace(/\s+/g,' ').trim()),text=lines.join('\n');
 if(!text.includes('\u4e1a\u52a1\u8bc1\u660e(\u501f\u8fd8\u6b3e\u8bb0\u5f55)')||!text.includes('\u8682\u8681\u667a\u4fe1(\u676d\u5dde)\u4fe1\u606f\u6280\u672f\u6709\u9650\u516c\u53f8'))return null;
 const result={provider:'alipay',templateId:'ant-loan-flow-proof-v1',records:[],errors:[],warnings:[]};
 try{
  const owner=text.match(/\u501f\u6b3e\u59d3\u540d\s*(.+?)\s*\u8eab\u4efd\u8bc1\u53f7\s*(\d{17}[\dX])/),draw=text.match(/\u501f\u6b3e\u91d1\u989d\s*(\d+\.\d{2})\s*\u501f\u6b3e\u65f6\u95f4\s*(20\d\d-\d\d-\d\d \d\d:\d\d:\d\d)/),observed=text.match(/\u4fe1\u606f\u83b7\u53d6\u65f6\u95f4\s*(20\d\d-\d\d-\d\d \d\d:\d\d:\d\d)/),lender=text.match(/\u653e\u6b3e\u673a\u6784\s*([\s\S]+?)\s*\u4fe1\u606f\u83b7\u53d6\u65f6\u95f4/);
  if(!owner||!draw||!observed||!lender)throw Error('BILL_LOAN_PROOF_HEADER');
  const time=s=>{const iso=s.replace(' ','T')+'+08:00';if(!Number.isFinite(Date.parse(iso))||new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,19)!==s.replace(' ','T'))throw Error('BILL_LOAN_PROOF_DATE');return iso;};
  let institution=lender[1].replace(/\s/g,'');
  // PDF text order can put the wrapped value above its vertically centered label.
  if(institution==='\u53f8)'){
   const at=lines.findIndex(l=>l==='\u653e\u6b3e\u673a\u6784'),prefix=at>0?lines[at-1].replace(/\s/g,''):'';
   if(!/^[\u4e00-\u9fff]{2,100}\u516c\u53f8\(\u539f[\u4e00-\u9fff]{2,100}\u6709\u9650\u516c$/.test(prefix))throw Error('BILL_LOAN_PROOF_LENDER_INCOMPLETE');
   institution=prefix+institution;
  }
  const borrowedAt=time(draw[2]),original=minor(draw[1]),ownerFingerprint=hash(['ant-loan-owner-v1',owner[1].replace(/\s/g,''),owner[2]]),loanKey=hash(['ant-loan-v1',ownerFingerprint,borrowedAt,original]);
  const start=lines.findIndex(l=>l.includes('\u672c\u91d1\u4f59\u989d')&&l.includes('\u4ea4\u6613\u603b\u91d1\u989d')&&l.includes('\u4ea4\u6613\u65f6\u95f4'));
  if(start<0)throw Error('BILL_LOAN_PROOF_COLUMNS');let previous=null,sequence=0;
  for(const line of lines.slice(start+1)){
   if(line.startsWith('\u672c\u8bc1\u660e'))break;
   if(!line)continue;
   const m=line.match(/^(\d+\.\d{2})\s+(\d+\.\d{2})\s+(20\d\d-\d\d-\d\d \d\d:\d\d:\d\d)\s+(\u653e\u6b3e\u6210\u529f|\u8fd8\u6b3e\u6210\u529f)$/);
   if(!m)throw Error('BILL_LOAN_PROOF_ROW');
   const balance=minor(m[1]),amount=minor(m[2]),occurredAt=time(m[3]),activity=m[4]==='\u653e\u6b3e\u6210\u529f'?'drawdown':'repayment';
   if(previous===null&&activity!=='drawdown'||previous!==null&&(activity!=='repayment'||occurredAt<previous.time||BigInt(balance)>previous.balance))throw Error('BILL_LOAN_PROOF_SEQUENCE');
   const principal=activity==='drawdown'?BigInt(amount):previous.balance-BigInt(balance),cost=BigInt(amount)-principal;if(cost<0n)throw Error('BILL_LOAN_PROOF_CONSERVATION');
   const loanProof={schema:'ant-loan-flow-proof-v1',loanKey,activity,borrowedAt,observedAt:time(observed[1]),originalPrincipalMinor:original,principalBalanceMinor:balance,principalMinor:String(principal),financingCostMinor:String(cost),lender:institution,ownerFingerprint,sequence:++sequence,sourcePage:1};
   const record={sourceTransactionId:'ant_loan_proof:'+loanKey+':'+sequence+':'+hash([occurredAt,amount,balance]),occurredAt,date:m[3].slice(0,10),amountMinor:amount,currency:'CNY',direction:'neutral',kind:'transfer',status:'completed',description:'\u501f\u5457\u501f\u8fd8\u6d41\u6c34\u8bc1\u660e',counterparty:institution,category:'\u501f\u8d37\u539f\u4ef6\u8bc1\u636e',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:'',rawFields:{activity:m[4],principalBalance:m[1],transactionAmount:m[2]},accountRelations:[{product:'alipay_jiebei',role:'target',activity:activity==='drawdown'?'loan_drawdown':'repayment'}],loanProof};
   validateLoanProof(loanProof,record);result.records.push(record);previous={balance:BigInt(balance),time:occurredAt};
  }
  if(result.records.length<2||result.records[0].loanProof.principalBalanceMinor!==original||result.records[0].occurredAt!==borrowedAt)throw Error('BILL_LOAN_PROOF_INCOMPLETE');
 }catch(e){result.records=[];result.errors.push({line:1,code:e.message,message:'Loan proof header, rows or principal conservation failed validation'});}
 return result;
}
module.exports={parseJiebeiLoanProof};
