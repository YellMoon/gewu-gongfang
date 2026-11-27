'use strict';

const {isNativeMortgageStatement}=require('./nativeMortgageStatements');
const {cashMortgageEvidence}=require('./mortgages');

const fundingTypes=['bank','debit_card','savings'];
const scopeKey=m=>JSON.stringify([m.sourceAccountId,m.loanType,m.statementReference]);
const paymentKey=o=>JSON.stringify([o.date,o.amountMinor]);
const isMortgageAccount=a=>a.type==='loan'&&a.currency==='CNY'&&(a.mortgage||a.mortgageEvidence);

function nativeEvidence(o,source) {
 const r=o.rawFields;
 if(!isNativeMortgageStatement(o)||source.type!=='debit_card'||source.provider!=='\u534e\u590f\u94f6\u884c'||
  !/^\d{4}$/.test(r.paymentCardTail||'')||source.maskedIdentifier!==r.paymentCardTail||
  !/^[a-f0-9]{64}$/.test(r.contractHash||'')||!o.sourceTransactionId?.startsWith('huaxia-mortgage:'+r.contractHash+':')||
  !/^[1-9]\d{0,29}$/.test(r.originalPrincipalMinor||'')||
  !/^[1-9]\d{0,6}$/.test(r.reportedCurrentAnnualRatePpm||'')||Number(r.reportedCurrentAnnualRatePpm)>1000000||
  !Number.isInteger(Number(r.reportedTermMonths))||Number(r.reportedTermMonths)<1||Number(r.reportedTermMonths)>600)return;
 return {loanType:'commercial',sourceAccountId:source.id,contractHash:r.contractHash,originalPrincipalMinor:r.originalPrincipalMinor,
  reportedTermMonths:Number(r.reportedTermMonths),annualRatePpm:r.reportedCurrentAnnualRatePpm};
}

function mortgageAccountDiscovery({accounts,observations}) {
 const funding=new Map(accounts.filter(a=>a.status==='active'&&a.currency==='CNY'&&fundingTypes.includes(a.type)).map(a=>[a.id,a]));
 const loans=accounts.filter(isMortgageAccount),cash=new Map(),proofs=new Map(),created=new Map(),updates=new Map();
 for(const o of observations){
  const source=funding.get(o.financialAccountId);
  if(!source||o.status!=='completed'||o.direction!=='debit'||o.currency!=='CNY')continue;
  const native=nativeEvidence(o,source);
  if(native){
   let group=proofs.get(native.contractHash);
   if(!group){group={evidence:native,printedDate:o.rawFields.printedDate,sources:new Map()};proofs.set(native.contractHash,group);}
   if(o.rawFields.printedDate>group.printedDate){group.evidence=native;group.printedDate=o.rawFields.printedDate;}
   if(!group.sources.has(source.id))group.sources.set(source.id,new Set());
   group.sources.get(source.id).add(paymentKey(o));
   continue;
  }
  const evidence=cashMortgageEvidence(o);
  if(!evidence)continue;
  const key=scopeKey(evidence);
  if(!cash.has(key))cash.set(key,{evidence,payments:new Set()});
  cash.get(key).payments.add(paymentKey(o));
 }
 const refsByContract=new Map(),contractsByRef=new Map();
 // Relate the debit and contract only when the same owned card, date and cents agree
 // and neither document has a competing mortgage identity.
 for(const [hash,group] of proofs){
  const keys=[];
  for(const [key,{evidence,payments}] of cash){
   if(evidence.loanType!=='commercial')continue;
   const proofPayments=group.sources.get(evidence.sourceAccountId);
   if(!proofPayments||![...payments].some(payment=>proofPayments.has(payment)))continue;
   keys.push(key);
   if(!contractsByRef.has(key))contractsByRef.set(key,[]);
   contractsByRef.get(key).push(hash);
  }
  refsByContract.set(hash,keys);
 }
 function upsert(loan,evidence,key) {
  if(loan){
   const prior=loan.mortgageEvidence;
   if(loan.status==='active'&&(!prior||Object.keys(prior).length!==Object.keys(evidence).length||
    Object.keys(evidence).some(field=>prior[field]!==evidence[field]))){
    updates.set(loan.id,{before:loan,after:{...loan,mortgageEvidence:evidence},key});
   }
   return;
  }
  const provider=evidence.loanType==='commercial'?funding.get(evidence.sourceAccountId).provider:'\u4f4f\u623f\u516c\u79ef\u91d1';
  const suffix=evidence.statementReference?'\uff08'+evidence.statementReference+'\uff09':'';
  const label=(evidence.loanType==='commercial'?provider+'\u623f\u8d37':'\u516c\u79ef\u91d1\u623f\u8d37')+suffix;
  created.set(key,{key,label,provider,type:'loan',currency:'CNY',maskedIdentifier:evidence.statementReference||'',balanceConvention:'signed',mortgageEvidence:evidence});
 }
 const claimed=new Set();
 for(const [hash,{evidence}] of proofs){
  const exact=loans.find(a=>a.mortgageEvidence?.contractHash===hash);
  const refs=refsByContract.get(hash),uniqueRef=refs.length===1&&contractsByRef.get(refs[0]).length===1?refs[0]:undefined;
  const fromCash=uniqueRef?cash.get(uniqueRef).evidence.statementReference:undefined;
  const sameFunding=loans.filter(a=>!a.mortgageEvidence?.contractHash&&!claimed.has(a.id)&&
   (a.mortgage||a.mortgageEvidence).loanType==='commercial'&&(a.mortgage||a.mortgageEvidence).sourceAccountId===evidence.sourceAccountId);
  const byRef=fromCash?sameFunding.filter(a=>(a.mortgageEvidence?.statementReference||a.mortgage?.statementReference)===fromCash&&
   (!a.mortgage||a.mortgage.originalPrincipalMinor===evidence.originalPrincipalMinor)):[];
  const byPrincipal=sameFunding.filter(a=>a.mortgage?.originalPrincipalMinor===evidence.originalPrincipalMinor);
  const samePrincipalProofs=[...proofs.values()].filter(g=>g.evidence.sourceAccountId===evidence.sourceAccountId&&g.evidence.originalPrincipalMinor===evidence.originalPrincipalMinor);
  const legacy=!refs.length&&samePrincipalProofs.length===1&&byPrincipal.length===1?byPrincipal[0]:undefined;
  const loan=exact||(byRef.length===1?byRef[0]:legacy);
  // Existing conflicts stay reviewable instead of creating another copy of a potentially known loan.
  if(!loan&&(byRef.length>1||byPrincipal.length>0))continue;
  if(loan)claimed.add(loan.id);
  const statementReference=loan?.mortgageEvidence?.statementReference||loan?.mortgage?.statementReference||fromCash;
  upsert(loan,{...evidence,...(statementReference?{statementReference}:{})},'mortgage:contract:'+hash);
 }
 const known=[...loans.map(a=>updates.get(a.id)?.after||a),...created.values()];
 for(const [key,{evidence}] of cash){
  if(known.some(a=>[a.mortgage,a.mortgageEvidence].some(m=>m&&scopeKey(m)===key)))continue;
  if(contractsByRef.has(key))continue;
  upsert(undefined,evidence,'mortgage:payment:'+key);
 }
 return {accounts:[...created.values()],updates:[...updates.values()]};
}

module.exports={mortgageAccountDiscovery};
