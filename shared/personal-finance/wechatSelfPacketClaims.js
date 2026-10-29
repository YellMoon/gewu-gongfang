'use strict';
const F={type:'\u4ea4\u6613\u7c7b\u578b',flow:'\u6536/\u652f',order:'\u4ea4\u6613\u5355\u53f7',merchant:'\u5546\u6237\u5355\u53f7',time:'\u4ea4\u6613\u65f6\u95f4',amount:'\u91d1\u989d(\u5143)',state:'\u5f53\u524d\u72b6\u6001',payer:'\u652f\u4ed8\u65b9\u5f0f'};
const PACKET='\u5fae\u4fe1\u7ea2\u5305',WALLET='\u96f6\u94b1',CREDIT='\u6536\u5165',DEBIT='\u652f\u51fa',REFUND='\u5df2\u8f6c\u5165\u9000\u6b3e',RECEIVED='\u5df2\u5b58\u5165\u96f6\u94b1';
const active=l=>l.status!=='deleted'&&l.deleted!==true&&!l.deletedAt;
function nativeRecord(o){
 try{const r=o.rawFields||{};if(o.provider!=='wechat'||o.currency!=='CNY'||r[F.type]!==PACKET||r[F.order]!==o.sourceTransactionId||!/^\d{16,48}$/.test(r[F.merchant]||'')||r[F.time]!==o.occurredAt?.slice(0,19).replace('T',' ')||!o.occurredAt.endsWith('+08:00')||o.date!==o.occurredAt.slice(0,10)||r[F.payer]!==o.paymentChannel||!/^\d+(?:\.\d{1,2})?$/.test(r[F.amount]||''))return null;
  const [a,b='']=r[F.amount].split('.');if(BigInt(a)*100n+BigInt(b.padEnd(2,'0'))!==BigInt(o.amountMinor)||BigInt(o.amountMinor)<=0n)return null;
  const out=o.direction==='debit'&&o.kind==='expense'&&o.paymentChannel===WALLET&&r[F.flow]===DEBIT&&(o.status==='pending'&&r[F.state]===REFUND||o.status==='completed'&&['\u652f\u4ed8\u6210\u529f','\u5df2\u9886\u5b8c'].includes(r[F.state]));
  const claim=o.direction==='credit'&&o.kind==='income'&&o.status==='completed'&&r[F.flow]===CREDIT&&r[F.state]===RECEIVED;
  return out||claim?{merchantOrder:r[F.merchant],role:out?'payment':'claim'}:null;
 }catch{return null;}
}
function findNativeSelfPacketClaims(ledger){
 const accounts=new Map((ledger.accounts||[]).filter(a=>a.provider==='wechat'&&a.type==='wallet'&&a.currency==='CNY'&&!a.sourceProduct).map(a=>[a.id,a])),latest=new Map(),annotations=new Map();
 for(const a of ledger.annotations||[])if(!annotations.has(a.observationId)||BigInt(a.revision)>BigInt(annotations.get(a.observationId).revision))annotations.set(a.observationId,a);
 for(const o of ledger.observations||[]){if(o.provider!=='wechat'||!accounts.has(o.financialAccountId)||!o.sourceTransactionId)continue;const key=JSON.stringify([o.financialAccountId,o.sourceTransactionId]),version=o.sourceVersionOrdinal||0,entry=latest.get(key);if(!entry)latest.set(key,{source:o,version,aliases:[o.id],tie:false});else{entry.aliases.push(o.id);if(version>entry.version){entry.source=o;entry.version=version;entry.tie=false;}else if(version===entry.version&&o.id!==entry.source.id)entry.tie=true;}}
 const groups=new Map();for(const entry of latest.values()){
  if(entry.tie||entry.aliases.some(id=>annotations.has(id)&&annotations.get(id).reset!==true))continue;const n=nativeRecord(entry.source);if(!n)continue;const key=JSON.stringify([entry.source.financialAccountId,entry.source.currency,n.merchantOrder]);if(!groups.has(key))groups.set(key,{payment:[],claim:[]});groups.get(key)[n.role].push({...entry,...n});
 }
 const result=[];for(const g of groups.values()){
  if(g.payment.length!==1||g.claim.length!==1)continue;const a=g.payment[0],b=g.claim[0],seconds=(Date.parse(b.source.occurredAt)-Date.parse(a.source.occurredAt))/1000;
  if(!Number.isFinite(seconds)||seconds<0||seconds>86400||BigInt(b.source.amountMinor)>BigInt(a.source.amountMinor)||(ledger.links||[]).some(l=>active(l)&&['distinct','group_distinct'].includes(l.type)&&(l.observationIds||[]).some(id=>a.aliases.includes(id))&&(l.observationIds||[]).some(id=>b.aliases.includes(id))))continue;
  result.push({parent:a.source,claim:b.source,parentAliases:a.aliases,claimAliases:b.aliases,merchantOrder:a.merchantOrder});
 }return result;
}
function applyNativeSelfPacketClaims(ledger,transactions,selected){
 const roots=new Map();for(const t of transactions)for(const id of t.observationIds||[]){if(!roots.has(id))roots.set(id,new Set());roots.get(id).add(t);}
 const models=[];for(const match of findNativeSelfPacketClaims(ledger)){
  const parentRoots=new Set(match.parentAliases.flatMap(id=>[...(roots.get(id)||[])])),claimRoots=new Set(match.claimAliases.flatMap(id=>[...(roots.get(id)||[])]));if(parentRoots.size!==1||claimRoots.size!==1)continue;
  const parent=[...parentRoots][0],claim=[...claimRoots][0],accountId=match.parent.financialAccountId,amount=BigInt(match.claim.amountMinor),gross=BigInt(match.parent.amountMinor),settled=parent.status==='completed'&&parent.kind==='expense'&&BigInt(parent.consumptionMinor)===gross&&BigInt(parent.cashEffects?.[accountId]||0)===-gross,pending=parent.status==='pending'&&parent.kind==='expense'&&BigInt(parent.consumptionMinor)===0n;
  if(parent===claim||!(settled||pending)||claim.kind!=='income'||claim.status!=='completed'||BigInt(claim.incomeMinor)!==amount||BigInt(claim.consumptionMinor)!==0n||BigInt(claim.balanceEffects?.[accountId]||0)!==amount||BigInt(claim.cashEffects?.[accountId]||0)!==amount||claim.incomeExpenseAllocations||claim.reportingAccountIds.length!==1||claim.reportingAccountIds[0]!==accountId)continue;
  const model={schema:'wechat-self-packet-claim-v1',method:'exact_native_packet_merchant_order',financialAccountId:accountId,parentObservationId:match.parent.id,claimObservationId:match.claim.id,merchantOrder:match.merchantOrder,claimAmountMinor:String(amount),parentGrossMinor:String(gross),parentRefundAmountStillUnknown:pending,expenseOffsetDeferred:pending,confidence:'exact_shared_native_merchant_order',noCashPostingChange:true,reversible:true,undoLinkType:'distinct',evidenceObservationIds:[match.parent.id,match.claim.id]};
  claim.kind='refund';claim.category=parent.category;claim.incomeMinor=0n;claim.selectedIncomeMinor=0n;claim.consumptionMinor=settled?-amount:0n;claim.selectedConsumptionMinor=selected.has(accountId)?claim.consumptionMinor:0n;claim.relatedReference=match.parent.sourceTransactionId;claim.relatedTransactionId=parent.id;claim.ownPacketClaim=model;claim.automaticClassification={method:'native_wechat_self_packet_claim',confidence:model.confidence,evidenceObservationIds:model.evidenceObservationIds};claim.automaticAssociations=[...(claim.automaticAssociations||[]),{method:'native_wechat_self_packet_claim',confidence:model.confidence,observationIds:model.evidenceObservationIds}];models.push(model);
 }return models;
}
module.exports={findNativeSelfPacketClaims,applyNativeSelfPacketClaims};
