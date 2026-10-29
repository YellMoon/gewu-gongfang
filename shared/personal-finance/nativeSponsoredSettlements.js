'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {nativeSponsoredPaymentBatches}=require('./nativeWalletPurchases');
const {isLegacyAlipayPurchase}=require('./legacyAlipayPurchases');
const {annotatedSettlementAccount}=require('./counterpartySettlements');
const RECEIPT='\u4ee3\u4ed8\u8d44\u91d1\u8f6c\u5165\uff08\u7528\u6237\u786e\u8ba4\uff09\uff1a',ORDER='\u4ee3\u4ed8\u8ba2\u5355\u7ed3\u7b97\uff08\u7528\u6237\u786e\u8ba4\uff09\uff1a';
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const fail=()=>Object.assign(new Error('SPONSORED_SETTLEMENT_CASH_PROOF_REQUIRED'),{code:'SPONSORED_SETTLEMENT_CASH_PROOF_REQUIRED'});
function annotationRole(a){if(a?.reset||typeof a?.patch?.category!=='string')return null;return a.patch.category.startsWith(RECEIPT)?'receipt':a.patch.category.startsWith(ORDER)?'order':null;}
function originalOrder(s,p){
 const r=s.rawFields||{},amount=r['\u91d1\u989d'];
 if(s.provider!=='alipay'||s.status!=='completed'||s.kind!=='transfer'||s.direction!=='neutral'||s.currency!=='CNY'||s.financialAccountId!==p.financialAccountId||s.accountRelations?.length||s.paymentAccountHint||s.investmentTrade||s.loanProof||s.balanceEvidence||s.bankStatement||s.statementFlow||s.brokerage||!['','\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u8d26\u6237\u4f59\u989d'].includes(s.paymentChannel)||r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u5546\u54c1\u8bf4\u660e']!==s.description||r['\u4ea4\u6613\u5bf9\u65b9']!==s.counterparty||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==s.paymentChannel||r['\u5546\u5bb6\u8ba2\u5355\u53f7']!==s.relatedReference||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||r['\u4ea4\u6613\u65f6\u95f4']!==s.date+' '+s.occurredAt.slice(11,19)||typeof amount!=='string'||!/^\d+\.\d{2}$/.test(amount)||BigInt(amount.replace('.',''))!==BigInt(s.amountMinor)||p.balanceEvidence.expenseMinor!==s.amountMinor||p.relatedReference!==s.sourceTransactionId||Date.parse(p.occurredAt)<Date.parse(s.occurredAt)||Date.parse(p.occurredAt)-Date.parse(s.occurredAt)>31*86400000)return false;
 const semantic={...s,direction:'debit',rawFields:{...r,'\u6536/\u652f':'\u652f\u51fa'}},service=s.counterparty==='\u6dd8\u5b9d\uff08\u4e2d\u56fd\uff09\u8f6f\u4ef6\u6709\u9650\u516c\u53f8'&&/^\u5145\u503c:\u670d\u52a1\u5e02\u573a.+\u8ba2\u5355\u4ed8\u6b3e \u4e1a\u52a1\u4ea4\u6613\u53f7:\d+$/.test(s.description)&&/^\d{16,32}$/.test(s.relatedReference)&&!/[\u501f\u8d37]|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9000\u6b3e|\u63d0\u73b0|\u7406\u8d22|\u57fa\u91d1/.test(s.description);
 return isLegacyAlipayPurchase(semantic)||service;
}
function context(ledger){
 const latest=new Map();for(const o of ledger.observations||[]){const prior=latest.get(key(o));if(!prior||(o.sourceVersionOrdinal||0)>(prior.sourceVersionOrdinal||0))latest.set(key(o),o);}
 const rows=[...latest.values()],byId=new Map(rows.map(o=>[o.id,o])),proofs=validatedWalletProofs(rows,new Map(ledger.accounts.map(a=>[a.id,a]))),batches=nativeSponsoredPaymentBatches(proofs),groups=[],bySource=new Map(),refs=new Map();
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=JSON.stringify([o.financialAccountId,o.sourceTransactionId]);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(o);}
 for(const batch of batches){
  const credit=byId.get(batch.creditProofObservationId),debits=batch.debitProofObservationIds.map(id=>byId.get(id)),orders=[];let valid=true;
  for(const p of debits){const sources=refs.get(JSON.stringify([p.financialAccountId,p.relatedReference]))||[];if(sources.length!==1||!originalOrder(sources[0],p)){valid=false;break;}orders.push(sources[0]);}if(!valid)continue;
  const ids=new Set([credit.id,...debits.map(o=>o.id),...orders.map(o=>o.id)]),veto=(ledger.links||[]).some(l=>{const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true,relevant=(l.observationIds||[]).filter(id=>ids.has(id));return l.type==='group_distinct'&&!deleted&&relevant.length>0||(l.type==='distinct'&&!deleted||['duplicate','transfer'].includes(l.type)&&deleted)&&relevant.length>=2&&relevant.length===l.observationIds.length;});if(veto)continue;
  const group={batch,credit,debits,orders};groups.push(group);bySource.set(credit.id,{group,role:'receipt',proof:credit});for(let i=0;i<orders.length;i++)bySource.set(orders[i].id,{group,role:'order',proof:debits[i]});
 }
 return{groups,bySource};
}
function validateNativeSponsoredAnnotation(source,annotation,ledger,prepared){
 const role=annotationRole(annotation),p=annotation?.patch,ctx=prepared||context(ledger),member=ctx.bySource.get(source.id);
 if(!role||!member||member.role!==role||p.kind!=='transfer'||Object.keys(p).some(k=>!['kind','category','settlementAccountId'].includes(k))||!p.category.slice((role==='receipt'?RECEIPT:ORDER).length).trim()||typeof p.settlementAccountId!=='string')throw fail();
 const proof=member.proof,amount=role==='receipt'?member.group.batch.amountMinor:source.amountMinor,direction=role==='receipt'?'credit':'debit',effective={...source,...p,amountMinor:amount,direction,date:proof.date,occurredAt:proof.occurredAt,paymentChannel:'\u4f59\u989d',balanceEvidence:undefined},target=annotatedSettlementAccount(effective,annotation,ledger.accounts);if(!target)throw fail();
 return {...effective,nativeSponsoredSettlement:{schema:'owner-confirmed-native-sponsored-settlement-v1',role,sourceObservationId:source.id,cashProofObservationId:proof.id,creditProofObservationId:member.group.credit.id,debitProofObservationIds:member.group.batch.debitProofObservationIds,payerHint:member.group.batch.payerHint,settlementAccountId:target.id,cashDeltaMinor:direction==='credit'?amount:String(-BigInt(amount)),cashDate:proof.date,cashOccurredAt:proof.occurredAt,sourceOccurredAt:source.occurredAt,originalSourceAmountMinor:source.amountMinor,ownerAnnotationId:annotation.id||null,reversible:true},automaticClassification:{method:'owner_confirmed_counterparty_settlement',confidence:'owner_confirmed_with_original_cash',financialAccountId:target.id,evidenceObservationIds:[source.id,proof.id,member.group.credit.id].filter((id,i,all)=>all.indexOf(id)===i),sourceDirection:source.direction,sourceAmountMinor:source.amountMinor,sponsorPayerHint:member.group.batch.payerHint}};
}
function findNativeSponsoredSettlements(ledger,annotations){
 if(![...annotations.values()].some(annotationRole))return new Map();const prepared=context(ledger),out=new Map();
 for(const group of prepared.groups){const members=[group.credit,...group.orders],anns=members.map(o=>annotations.get(o.id));if(anns.some(a=>!annotationRole(a))||new Set(anns.map(a=>a.patch.settlementAccountId)).size!==1)continue;
  try{const values=members.map((o,i)=>validateNativeSponsoredAnnotation(o,anns[i],ledger,prepared));for(let i=0;i<members.length;i++)out.set(members[i].id,values[i]);}catch{/* Incomplete or contradicted evidence stays visible for review. */}
 }return out;
}
function appendSponsoredCashPlans(sources,approved,flow,effects,plans){
 for(const source of sources){const expected=approved.get(source.id);if(!expected)continue;const p=expected.nativeSponsoredSettlement,account=expected.financialAccountId,delta=BigInt(p.cashDeltaMinor);if(source.amountMinor!==expected.amountMinor||source.direction!==expected.direction||flow.get(account)!==delta||effects.get(account)!==delta)throw fail();const existing=plans.find(v=>v.financialAccountId===account);if(existing){if(existing.deltaMinor!==p.cashDeltaMinor||existing.proofObservationId!==p.cashProofObservationId)throw fail();continue;}
  plans.push({method:p.role==='receipt'?'native_sponsored_receipt_cash_posting':'native_sponsored_order_cash_posting',sourceObservationId:source.id,proofObservationId:p.cashProofObservationId,financialAccountId:account,deltaMinor:p.cashDeltaMinor,sourceOccurredAt:p.sourceOccurredAt,occurredAt:p.cashOccurredAt,date:p.cashDate,confidence:'explicit_original_cash_posting',sponsorCreditProofObservationId:p.creditProofObservationId,reversible:true});
 }
}
module.exports={RECEIPT,ORDER,annotationRole,validateNativeSponsoredAnnotation,findNativeSponsoredSettlements,appendSponsoredCashPlans};
