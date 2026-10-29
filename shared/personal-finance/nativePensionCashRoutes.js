'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {refreshHistoricalInvestmentRoute}=require('./historicalInvestmentRoutes');
const {actualSecond}=require('./mixedPayments');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
// A named native cash row proves receipt; it does not prove a later investment
// destination unless that destination and its separate bank cash legs exist.
function findNativePensionCashRoutes(observations,accounts,{balanceEvidenceObservations=[],annotatedIds=new Set(),links=[]}={}){
 if(!balanceEvidenceObservations.length&&!observations.some(o=>o.balanceEvidence?.schema==='alipay-balance-proof-v1'))return{funding:new Map(),bankDestinations:new Map(),bridges:[]};
 const all=[...observations,...balanceEvidenceObservations],byId=new Map(all.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a])),latest=new Map();
 for(const o of all)if(!latest.has(identity(o))||(o.sourceVersionOrdinal||0)>(latest.get(identity(o)).sourceVersionOrdinal||0))latest.set(identity(o),o);
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am),funding=new Map(),bankDestinations=new Map(),bridges=[];
 if(!proofs.length)return{funding,bankDestinations,bridges};
 const blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),active=links.filter(l=>l.status!=='deleted'),activeSets=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeSets.has([...l.observationIds].sort().join('|')));
 const rejects=members=>{const keys=new Set(members.map(identity));return members.some(o=>blocked.has(identity(o)))||vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?ids.some(k=>keys.has(k)):ids.length===l.observationIds.length&&ids.every(k=>keys.has(k));})||active.some(l=>l.type==='duplicate'&&l.observationIds.some(id=>byId.has(id)&&keys.has(identity(byId.get(id))))&&l.observationIds.some(id=>!byId.has(id)||!keys.has(identity(byId.get(id)))));};
 const cashKey=o=>JSON.stringify([o.date,o.amountMinor,o.currency]),banks=new Map();
 for(const b of rows)if(b.statementFlow&&b.status==='completed'){const k=cashKey(b);if(!banks.has(k))banks.set(k,[]);banks.get(k).push(b);}
 const candidates=[],possibleRedemptions=rows.filter(o=>!o.balanceEvidence&&o.provider==='alipay'&&o.status==='completed'&&o.kind==='transfer'&&o.direction==='neutral'&&actualSecond(o)&&/^\u5b9a\u671f\u7406\u8d22\u8d4e\u56de-/.test(o.description||''));
 for(const original of rows){
  if(original.balanceEvidence||original.provider!=='alipay'||original.status!=='completed'||original.kind!=='transfer'||original.direction!=='neutral'||original.paymentChannel||original.paymentAccountHint||original.automaticFunding||!actualSecond(original)||!/^\u5b9a\u671f\u7406\u8d22\u8d4e\u56de-(?:\u5efa\u4fe1\u517b\u8001\u98de\u6708\u5b9d|\u56fd\u5bff\u8d85\u6708\u5b9d)$/.test(original.description||''))continue;
  const p=refreshHistoricalInvestmentRoute(original,accounts),wallet=am.get(p.financialAccountId),r=p.rawFields||{},relations=p.accountRelations||[],relation=relations.length===1?relations[0]:null,product=am.get(relation?.financialAccountId);
  if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||p.currency!=='CNY'||relation?.role!=='target'||relation.activity!=='investment_withdrawal'||product?.status!=='active'||product.currency!==p.currency||product.sourceProduct!==relation.product||r['\u5546\u54c1\u8bf4\u660e']!==p.description||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==p.sourceTransactionId||r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==''||!/^\d+\.\d{2}$/.test(r['\u91d1\u989d']||'')||BigInt(r['\u91d1\u989d'].replace('.',''))!==BigInt(p.amountMinor))continue;
  const amount=BigInt(p.amountMinor);if(amount<=0n)continue;
  const credits=proofs.filter(q=>{const o=q.observation,seconds=(Date.parse(o.occurredAt)-Date.parse(p.occurredAt))/1000;return o.financialAccountId===wallet.id&&o.date===p.date&&q.bank==='\u652f\u4ed8\u5b9d'&&o.description==='\u8f6c\u8d26\u7406\u8d22\u4ea7\u54c1\u8d44\u4ea7\u8d4e\u56de'&&q.incoming===amount&&q.outgoing===0n&&Number.isInteger(seconds)&&seconds>=0&&seconds<=5;});
  for(const credit of credits){
   const c=credit.observation;
   if(possibleRedemptions.filter(o=>o.financialAccountId===p.financialAccountId&&o.date===p.date&&o.amountMinor===p.amountMinor&&o.currency===p.currency&&Date.parse(c.occurredAt)-Date.parse(o.occurredAt)>=0&&Date.parse(c.occurredAt)-Date.parse(o.occurredAt)<=5000).length!==1)continue;
   const bankRows=banks.get(cashKey(p))||[],nearCredits=bankRows.filter(b=>b.direction==='credit'&&Math.abs(Date.parse(b.occurredAt)-Date.parse(c.occurredAt))<=10000);
   // Any competing actual bank receipt blocks the standalone wallet inference.
   if(!nearCredits.length){candidates.push({p,credit:c,product,wallet,members:[original,c],type:'wallet_receipt'});continue;}
   const negatives=proofs.filter(q=>{const o=q.observation,seconds=(Date.parse(o.occurredAt)-Date.parse(c.occurredAt))/1000;return o.importId===c.importId&&o.financialAccountId===wallet.id&&o.date===c.date&&q.bank==='\u652f\u4ed8\u5b9d'&&o.description==='\u8f6c\u8d26\u4f59\u989d\u5b9d-\u7406\u8d22\u8d4e\u56de'&&q.incoming===0n&&q.outgoing===-amount&&Number.isInteger(seconds)&&seconds>=0&&seconds<=10;});
   const destinations=accounts.filter(a=>a.status==='active'&&a.sourceProduct==='alipay_yuebao'&&a.currency==='CNY');
   if(nearCredits.length!==1||negatives.length!==1||destinations.length!==1)continue;
   const b=nearCredits[0],bank=am.get(b.financialAccountId),d=negatives[0].observation;
   const nativeBank=(o,direction,name)=>{const rawAmount=o.rawFields?.['\u4ea4\u6613\u91d1\u989d'];return o.provider==='mybank'&&o.statementFlow?.schema==='mybank-current-v1'&&o.direction===direction&&o.description===name&&o.rawFields?.['\u4ea4\u6613\u540d\u79f0']===name&&o.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u652f\u4ed8\u5b9d'&&actualSecond(o)&&o.currency==='CNY'&&/^[+-]\d+\.\d{2}$/.test(rawAmount||'')&&rawAmount[0]===(direction==='credit'?'+':'-')&&BigInt(rawAmount.slice(1).replace('.',''))===amount&&o.statementFlow[direction==='credit'?'incomeMinor':'expenseMinor']===p.amountMinor&&o.statementFlow[direction==='credit'?'expenseMinor':'incomeMinor']==='0';};
   if(bank?.status!=='active'||bank.type!=='debit_card'||bank.provider!=='\u7f51\u5546\u94f6\u884c'||!/^\d{4}$/.test(bank.maskedIdentifier||'')||!nativeBank(b,'credit','\u652f\u4ed8\u5b9d\u8f6c\u5165'))continue;
   const debits=bankRows.filter(o=>o.financialAccountId===bank.id&&o.direction==='debit'&&o.occurredAt===b.occurredAt);
   if(debits.length!==1||!nativeBank(debits[0],'debit','\u8d2d\u4e70\u7406\u8d22')||debits[0].counterparty!=='\u652f\u4ed8\u5b9d'||!['unknown','transfer'].includes(debits[0].kind))continue;
   candidates.push({p,credit:c,debit:d,product,wallet,bankCredit:b,bankDebit:debits[0],bank,destination:destinations[0],members:[original,c,d,b,debits[0]],type:'bank_route'});
  }
 }
 // Count rivals before owner overrides are excluded; an edited rival cannot
 // manufacture uniqueness for another order, source version or native row.
 const uses=new Map();for(const c of candidates)for(const o of c.members)uses.set(identity(o),(uses.get(identity(o))||0)+1);
 for(const c of candidates){if(c.members.some(o=>uses.get(identity(o))!==1)||rejects(c.members))continue;
  const evidenceObservationIds=c.members.map(o=>o.id),base={method:'native_pension_wallet_cash_receipt',confidence:'inferred_unique_named_native_cash_route',cashEvidenceConfidence:'explicit_original_cash_posting',evidenceObservationIds,reciprocalUnique:true,sharedOrderReference:false,reversible:true,amountMinor:c.p.amountMinor,proofOccurredAt:c.credit.occurredAt};
  if(c.type==='wallet_receipt')funding.set(c.p.id,{...base,financialAccountId:c.wallet.id,destinationBasis:'explicit_native_wallet_redemption_receipt'});
  else{bankDestinations.set(c.bankDebit.id,{financialAccountId:c.destination.id,method:'native_named_investment_destination',confidence:base.confidence,evidenceObservationIds,reciprocalUnique:true,reversible:true,sourceKind:c.bankDebit.kind,product:c.destination.sourceProduct});bridges.push(c);}
 }
 return{funding,bankDestinations,bridges};
}
function addNativePensionBridges(transactions,routes,plans){
 const bySource=new Map();for(const t of transactions)for(const id of t.observationIds)bySource.set(id,t);
 for(const c of routes.bridges){const t=bySource.get(c.p.id),next=bySource.get(c.bankDebit.id),amount=BigInt(c.p.amountMinor);
  if(!t?.observationIds.includes(c.bankCredit.id)||!next||next===t||BigInt(t.balanceEffects[c.product.id]||0)!==-amount||BigInt(t.balanceEffects[c.bank.id]||0)!==amount||BigInt(t.balanceEffects[c.wallet.id]||0)!==0n||BigInt(t.cashEffects[c.wallet.id]||0)!==0n||BigInt(next.balanceEffects[c.bank.id]||0)!==-amount||BigInt(next.balanceEffects[c.destination.id]||0)!==amount)continue;
  const proofObservationIds=[c.credit.id,c.debit.id];if((plans.get(t.id)||[]).some(p=>p.proofObservationIds.some(id=>proofObservationIds.includes(id))))continue;
  const plan={financialAccountId:c.wallet.id,sourceObservationId:c.p.id,method:'native_wallet_intermediary_postings',confidence:'inferred_unique_named_native_cash_route',cashEvidenceConfidence:'explicit_original_cash_postings',path:'pension_redemption_via_mybank_to_yuebao',amountMinor:String(amount),netDeltaMinor:'0',proofObservationIds,routeEvidenceObservationIds:c.members.map(o=>o.id),reversible:true,events:[{occurredAt:c.credit.occurredAt,date:c.credit.date,deltaMinor:amount,observationId:c.credit.id},{occurredAt:c.debit.occurredAt,date:c.debit.date,deltaMinor:-amount,observationId:c.debit.id}]};
  plans.set(t.id,[...(plans.get(t.id)||[]),plan]);
 }
 return plans;
}
module.exports={findNativePensionCashRoutes,addNativePensionBridges};
