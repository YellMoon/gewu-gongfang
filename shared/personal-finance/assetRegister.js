'use strict';
const {statementBalances}=require('./balanceEvidence');
const {matchesMortgage}=require('./mortgages');
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const bankName=v=>norm(v).replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f|\u90ae\u653f)/,'').replace('\u90ae\u653f\u50a8\u84c4\u94f6\u884c','\u90ae\u50a8\u94f6\u884c');
function fundingIdentity(channel){
 const m=norm(channel).split('&')[0].match(/^(?:\u4e91\u95ea\u4ed8-)?(.+?\u94f6\u884c)(\u4fe1\u7528\u5361\u5206\u671f|\u4fe1\u7528\u5361|\u50a8\u84c4\u5361|\u501f\u8bb0\u5361)?\((\d{4})\)/);
 return m?{bank:bankName(m[1]),type:/\u4fe1\u7528/.test(m[2]||'')?'credit_card':m[2]?'debit_card':null,tail:m[3]}:null;
}
function sameBankAccount(a,f,currency){
 const tail=norm(a.maskedIdentifier).match(/(\d{4})\)?$/)?.[1],bank=fundingIdentity(a.label)?.bank||bankName(a.provider);
 return a.currency===currency&&(!f.type||a.type===f.type)&&tail===f.tail&&bank===f.bank;
}
function accountProposals(ledger){
 const accounts=ledger.accounts||[],candidates=new Map(),issues=new Map(),types=new Map();
 const sources=(ledger.observations||[]).filter(o=>o.status==='completed'&&!o.balanceEvidence);
 const found=sources.map(o=>({o,f:fundingIdentity(o.paymentChannel)})).filter(x=>x.f);
 for(const {f} of found)if(f.type){const k=f.bank+f.tail;if(!types.has(k))types.set(k,new Set());types.get(k).add(f.type);}
 for(const {o,f} of found){
  if(!f.type){const t=[...(types.get(f.bank+f.tail)||[])],known=[...new Set(accounts.filter(a=>sameBankAccount(a,f,o.currency)&&['debit_card','credit_card'].includes(a.type)).map(a=>a.type))];if(t.length===1)f.type=t[0];else if(!t.length&&known.length===1)f.type=known[0];}
  const key=[f.bank,f.type||'unknown',f.tail,o.currency].join(':');
  if(!f.type){issues.set(key,{reason:'bank_type_unknown',observationId:o.id,bank:f.bank,tail:f.tail});continue;}
  const matches=accounts.filter(a=>sameBankAccount(a,f,o.currency));
  if(matches.length>1||matches.some(a=>a.status==='archived')){issues.set(key,{reason:'bank_account_ambiguous',observationId:o.id,key});continue;}
  if(matches.length||candidates.has(key))continue;
  candidates.set(key,{key,label:f.bank+(f.type==='credit_card'?'\u4fe1\u7528\u5361':'\u50a8\u84c4\u5361')+'\uff08'+f.tail+'\uff09',provider:f.bank,type:f.type,maskedIdentifier:f.tail,currency:o.currency,balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,status:'active'});
 }
 if(sources.some(o=>norm(o.paymentChannel).startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d'))&&!accounts.some(a=>a.sourceProduct==='alipay_shanghai_credit'))
  candidates.set('alipay_shanghai_credit:CNY',{key:'alipay_shanghai_credit:CNY',label:'\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d',provider:'alipay',type:'credit_card',maskedIdentifier:'',currency:'CNY',sourceProduct:'alipay_shanghai_credit',balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,status:'active'});
 return {accounts:[...candidates.values()],unresolved:[...issues.values()]};
}
const unitsMinor=v=>{const[a,b='']=String(v).split('.');return BigInt(a)*1000000000000n+BigInt(b.padEnd(12,'0'));};
const unitsText=v=>{const a=v<0n?-v:v;return(v<0n?'-':'')+String(a/1000000000000n)+'.'+String(a%1000000000000n).padStart(12,'0').replace(/0+$/,'').padEnd(2,'0');};
function buildAssetRegister(ledger){
 const accounts=ledger.accounts||[],versions=new Map();
 for(const o of ledger.observations||[]){if(o.status!=='completed')continue;const key=[o.financialAccountId,o.provider,o.sourceIdentity||o.id].join(':');if(!versions.has(key)||(o.sourceVersionOrdinal||0)>(versions.get(key).sourceVersionOrdinal||0))versions.set(key,o);}
 const records=[...versions.values()].filter(o=>o.status==='completed'),confirmations=records.filter(o=>o.investmentTrade),funds=new Map();
 for(const o of confirmations){
  const t=o.investmentTrade;if(!t.fundCode)continue;const key=[o.financialAccountId,t.fundCode,o.currency].join(':');
  if(!funds.has(key))funds.set(key,{key,financialAccountId:o.financialAccountId,code:t.fundCode,name:t.fundName,currency:o.currency,boughtUnits:0n,grossMinor:0n,feeMinor:0n,count:0,conversionOutAppliedUnits:0n,conversionInMinor:0n,sourceObservationIds:[],status:'buy_confirmations',balanceMinor:null});
  const f=funds.get(key);if(t.tradeType==='buy'){f.boughtUnits+=unitsMinor(t.confirmedUnits);f.grossMinor+=BigInt(t.confirmedAmountMinor);f.feeMinor+=BigInt(t.feeMinor);f.count++;f.sourceObservationIds.push(o.id);}
 }
 const conversions=confirmations.filter(o=>o.investmentTrade.tradeType==='conversion').map(o=>{
  const t=o.investmentTrade,matches=records.filter(r=>!r.investmentTrade&&r.provider===o.provider&&r.financialAccountId===o.financialAccountId&&r.sourceTransactionId===t.orderId&&r.currency===o.currency&&r.amountMinor===t.appliedAmountMinor&&r.date===t.confirmedAt.slice(0,10)&&r.description.includes('\u300c\u8f6c\u6362\u81f3\u300d'));
  const result={id:o.id,orderId:t.orderId,appliedAt:o.occurredAt,confirmedAt:t.confirmedAt,amountMinor:t.appliedAmountMinor,feeMinor:t.feeMinor,appliedUnits:t.appliedUnits,sourceFundCode:null,targetFundCode:null,sourceFundName:null,targetFundName:null,confirmedInUnits:null,evidenceObservationIds:[o.id],status:'unresolved'};
  if(matches.length!==1)return result;const m=norm(matches[0].description).match(/^\u8682\u8681\u8d22\u5bcc-(.+?)-\u300c\u8f6c\u6362\u81f3\u300d-(.+?)-\u8f6c\u5165\u6210\u529f$/);if(!m)return result;
  const find=name=>[...funds.values()].filter(f=>f.financialAccountId===o.financialAccountId&&norm(f.name)===name&&f.currency===o.currency),from=find(m[1]),to=find(m[2]);
  result.sourceFundName=m[1];result.targetFundName=m[2];result.evidenceObservationIds.push(matches[0].id);
  if(from.length===1){result.sourceFundCode=from[0].code;from[0].conversionOutAppliedUnits+=unitsMinor(t.appliedUnits||'0');from[0].status='conversion_units_pending';}
  if(to.length===1){result.targetFundCode=to[0].code;to[0].conversionInMinor+=BigInt(t.appliedAmountMinor);to[0].status='conversion_units_pending';}
  result.status=from.length===1&&to.length===1?'products_matched':'unresolved';return result;
 });
 const statementAnchors=statementBalances(records,accounts,{includeAvailable:true});
 const accountRows=accounts.map(a=>{
  const evidence=records.filter(o=>o.financialAccountId===a.id||a.mortgage&&matchesMortgage(o,a.mortgage)||o.accountRelations?.some(r=>r.financialAccountId===a.id)||(()=>{const f=fundingIdentity(o.paymentChannel);return f&&sameBankAccount(a,f,o.currency);})());
  const snapshots=(ledger.balanceSnapshots||[]).filter(s=>s.financialAccountId===a.id);
  snapshots.push(...statementAnchors.filter(s=>s.financialAccountId===a.id));
  for(let i=0;i<snapshots.length;i++)if(['credit_card','loan'].includes(a.type)&&snapshots[i].balanceConvention!=='signed')snapshots[i]={...snapshots[i],balanceMinor:String(-BigInt(snapshots[i].balanceMinor)),balanceConvention:'signed'};
  snapshots.sort((a,b)=>Date.parse(b.asOf)-Date.parse(a.asOf)||(a.source==='statement_observation'?1:0)-(b.source==='statement_observation'?1:0)||Date.parse(b.createdAt||'1970-01-01')-Date.parse(a.createdAt||'1970-01-01'));
  const candidate=snapshots[0],tied=candidate?snapshots.filter(s=>s.asOf===candidate.asOf&&s.source===candidate.source&&s.balanceKind===candidate.balanceKind):[];
  const ambiguous=new Set(tied.map(s=>s.balanceMinor)).size>1;
  const dates=evidence.map(o=>o.date).sort();
  return{...a,group:['credit_card','loan'].includes(a.type)?'\u4fe1\u7528\u8d26\u6237':a.type==='investment'?'\u7406\u8d22\u8d26\u6237':['wallet','debit_card','bank','savings','cash'].includes(a.type)?'\u50a8\u84c4\u8d26\u6237':'\u5176\u4ed6\u8d26\u6237',evidenceCount:evidence.length,channels:[...new Set(evidence.map(o=>o.provider))],firstDate:dates[0]||null,lastDate:dates.at(-1)||null,verifiedBalance:ambiguous?null:candidate||null,balanceStatus:ambiguous?'\u4f59\u989d\u8bc1\u636e\u51b2\u7a81':snapshots.length?'\u6709\u4f59\u989d\u6838\u5bf9\u503c':'\u4f59\u989d\u5f85\u6838\u5bf9'};
 });
 return{accounts:accountRows,products:[...funds.values()].map(f=>({...f,boughtUnits:unitsText(f.boughtUnits),grossMinor:String(f.grossMinor),feeMinor:String(f.feeMinor),conversionOutAppliedUnits:unitsText(f.conversionOutAppliedUnits),conversionInMinor:String(f.conversionInMinor)})),conversions,proposals:accountProposals(ledger)};
}
module.exports={fundingIdentity,sameBankAccount,accountProposals,buildAssetRegister};
