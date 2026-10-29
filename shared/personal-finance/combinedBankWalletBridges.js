'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {statementOwners}=require('./statementOwnership');
const {fundingIdentity}=require('./assetRegister');
const {isLegacyAlipayPurchase}=require('./legacyAlipayPurchases');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe)/,'');
const nonzero=e=>Object.entries(e||{}).filter(([,n])=>BigInt(n)!==0n);
const signedMinor=v=>/^-?\d[\d,]*\.\d{2}$/.test(v||'')?BigInt(v.replace(/[,.]/g,'')):null;

// Preserve the existing bank group's economic purpose and statistics. Only
// its independently proved, zero-net wallet transit is added to the bank root.
function addCombinedBankWalletBridges(ledger,transactions,plans){
 if(!transactions.some(t=>t.reconciliationGroup?.role==='bank_evidence'&&t.automaticAssociations?.some(g=>g.method==='combined_taobao_payment_group')))return plans;
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map((ledger.observations||[]).map(o=>[o.id,o])),latest=new Map(),ties=new Set(),blocked=new Set(),claimed=new Set(),roots=new Map(transactions.map(t=>[t.id,t]));
 for(const o of byId.values()){const k=key(o),p=latest.get(k),v=o.sourceVersionOrdinal||0;if(!p||v>(p.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(p.sourceVersionOrdinal||0)&&p.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(key(o));}
 for(const l of ledger.links||[])if(l.status!=='deleted'||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(key(o));}
 for(const t of transactions){for(const id of t.observationIds||[])claimed.add(id);for(const e of t.cashPostingEvidence||[])claimed.add(e.proofObservationId);for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);for(const es of Object.values(t.balanceEffectEvents||{}))for(const e of es)if(e.observationId)claimed.add(e.observationId);}
 for(const ps of plans.values())for(const p of ps)for(const id of p.proofObservationIds||[])claimed.add(id);
 const rows=[...latest.values()],owners=statementOwners(ledger.imports||[],rows),proofs=validatedWalletProofs(rows,am),refs=new Map(),seq=new Map(),orders=new Map(),refkey=(id,ref)=>JSON.stringify([id,ref]);
 for(const p of proofs){const o=p.observation,k=refkey(o.financialAccountId,o.relatedReference);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(p);seq.set(JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]),p);}
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=refkey(o.financialAccountId,o.sourceTransactionId);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const clean=o=>o&&latest.get(key(o))?.id===o.id&&!ties.has(key(o))&&!blocked.has(key(o)),free=p=>clean(p?.observation)&&!claimed.has(p.observation.id),proposals=[];
 for(const t of transactions){
  const gs=(t.automaticAssociations||[]).filter(g=>g.method==='combined_taobao_payment_group'&&g.id===t.reconciliationGroup?.id);if(gs.length!==1||t.reconciliationGroup.role!=='bank_evidence'||plans.has(t.id)||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length||t.balanceEffectEvents||t.cashEffectEvents||t.appliedAnnotations?.length)continue;
  const g=gs[0],e=g.evidence||{},ids=g.platformRootIds||[],b=byId.get(t.id),card=am.get(b?.financialAccountId),n=b?BigInt(b.amountMinor):0n,f=b?.statementFlow,raw=b?.rawFields||{},owner=owners.get(b?.id);
  if(ids.length<2||ids.length>32||new Set(ids).size!==ids.length||g.bankRootIds?.length!==1||g.bankRootIds[0]!==t.id||g.observationIds?.length!==ids.length+1||new Set(g.observationIds).size!==ids.length+1||!g.observationIds.every(id=>id===t.id||ids.includes(id))||e.count!==ids.length||e.platformCount!==ids.length||e.bankCount!==1||e.statisticsAuthority!=='complete_bank_statement'||e.individualIdentity!=='same_second_platform_orders_one_actual_bank_debit'||e.inferredPlatformKind!=='expense'||e.platform!=='alipay'||e.reciprocalUnique!==true||!clean(b)||b.provider!=='ccb'||b.direction!=='debit'||b.kind!=='expense'||b.status!=='completed'||b.currency!=='CNY'||card?.status!=='active'||card.type!=='debit_card'||card.currency!=='CNY'||norm(card.provider)!=='\u5efa\u8bbe\u94f6\u884c'||!/^\d{4}$/.test(card.maskedIdentifier||'')||!owner||e.financialAccountId!==card.id||e.date!==b.date||e.currency!=='CNY'||BigInt(e.totalMinor||0)!==n||f?.schema!=='ccb-debit-v1'||f.incomeMinor!=='0'||f.expenseMinor!==b.amountMinor||raw.dateBasis!=='transaction_date'||raw['\u4ea4\u6613\u65e5\u671f']!==b.date.replace(/-/g,'')||raw['\u6458\u8981']!=='\u6d88\u8d39'||!/^\u652f\u4ed8\u5b9d/.test(raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']||'')||signedMinor(raw['\u4ea4\u6613\u91d1\u989d'])!==-n||!String(raw['\u4ea4\u6613\u91d1\u989d']).startsWith('-'))continue;
  if(t.observationIds?.length!==1||t.observationIds[0]!==b.id||t.sources?.length!==1||t.kind!=='expense'||t.status!=='completed'||t.currency!=='CNY'||BigInt(t.consumptionMinor)!==n||BigInt(t.incomeMinor)!==0n||nonzero(t.balanceEffects).length!==1||BigInt(t.balanceEffects[card.id]||0)!==-n||nonzero(t.cashEffects).length!==1||BigInt(t.cashEffects[card.id]||0)!==-n)continue;
  const members=ids.map(id=>({t:roots.get(id),s:byId.get(id)}));let valid=true;
  for(const m of members){const s=m.s,p=m.t,sr=s?.rawFields||{},named=s&&fundingIdentity(s.paymentChannel),fund=p?.automaticFunding;
   if(!clean(s)||!p||s.provider!=='alipay'||s.balanceEvidence||s.currency!=='CNY'||s.status!=='completed'||s.kind!=='transfer'||s.direction!=='debit'||s.date!==b.date||s.occurredAt!==e.sameOriginalPaymentSecond||!s.occurredAt.endsWith('+08:00')||!isLegacyAlipayPurchase(s)||s.accountRelations?.length||s.investmentTrade||s.loanProof||[s.feeMinor,s.interestMinor,s.principalMinor].some(v=>v!=null&&v!=='0')||norm(s.paymentChannel).split('&')[0]!=='\u5efa\u8bbe\u94f6\u884c'&&!named||sr['\u4ea4\u6613\u65f6\u95f4']!==s.date+' '+s.occurredAt.slice(11,19)||sr['\u4ea4\u6613\u5bf9\u65b9']!==s.counterparty||sr['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||signedMinor(sr['\u91d1\u989d'])!==BigInt(s.amountMinor)||p.observationIds?.length!==1||p.observationIds[0]!==s.id||p.sources?.length!==1||p.kind!=='expense'||p.status!=='completed'||BigInt(p.consumptionMinor)!==0n||BigInt(p.incomeMinor)!==0n||nonzero(p.balanceEffects).length||nonzero(p.cashEffects).length||p.reconciliationGroup?.id!==g.id||p.reconciliationGroup.role!=='platform_order'||p.appliedAnnotations?.length||p.cashPostingEvidence?.length||p.walletIntermediaryPostings?.length||p.balanceEffectEvents||p.cashEffectEvents||plans.has(p.id)||!p.automaticAssociations?.some(a=>JSON.stringify(a)===JSON.stringify(g))){valid=false;break;}
   if(named?(named.bank!=='\u5efa\u8bbe\u94f6\u884c'||named.tail!==card.maskedIdentifier||named.type&&named.type!=='debit_card'):!(fund?.financialAccountId===card.id&&['owner_historical_card_binding','source_statement_legacy_card'].includes(fund.method))){valid=false;break;}
  }
  if(!valid||new Set(members.map(m=>m.s.financialAccountId)).size!==1||members.reduce((a,m)=>a+BigInt(m.s.amountMinor),0n)!==n)continue;
  const wallet=am.get(members[0].s.financialAccountId);if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY')continue;
  const credits=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.date===b.date&&p.bank==='\u5efa\u8bbe\u94f6\u884c'&&p.incoming===n&&p.outgoing===0n);if(credits.length!==1)continue;
  const positive=credits[0],credit=positive.observation;if(!free(positive)||credit.description!=='\u5145\u503c'||!new RegExp('^'+b.date.replace(/-/g,'')+'\\d+\\*+\\d+$').test(credit.relatedReference))continue;
  const debits=[];let paidAt=null;
  for(let i=1;i<=members.length;i++){
   const p=seq.get(JSON.stringify([wallet.id,credit.importId,credit.balanceEvidence.sequence+i])),o=p?.observation,member=o&&members.find(m=>m.s.sourceTransactionId===o.relatedReference),gap=o?Date.parse(o.occurredAt)-Date.parse(credit.occurredAt):NaN;
   if(!p||!free(p)||!member||o.date!==b.date||p.incoming!==0n||p.outgoing!==-BigInt(member.s.amountMinor)||p.bank!=='\u652f\u4ed8\u5b9d'||o.description!=='\u5728\u7ebf\u652f\u4ed8'||paidAt&&o.occurredAt!==paidAt||gap<0||gap>2000||Date.parse(o.occurredAt)<Date.parse(member.s.occurredAt)||refs.get(refkey(wallet.id,o.relatedReference))?.length!==1||orders.get(refkey(wallet.id,o.relatedReference))?.length!==1){valid=false;break;}
   paidAt=o.occurredAt;debits.push(p);
  }
  if(!valid||new Set(debits.map(p=>p.observation.relatedReference)).size!==members.length||debits.reduce((a,p)=>a-p.outgoing,0n)!==n)continue;
  const next=seq.get(JSON.stringify([wallet.id,credit.importId,credit.balanceEvidence.sequence+members.length+1]));if(next&&next.observation.occurredAt===paidAt&&next.outgoing<0n)continue;
  proposals.push({t,g,b,card,wallet,owner,positive,debits,members,n});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.b,...p.members.map(m=>m.s),p.positive.observation,...p.debits.map(q=>q.observation)])uses.set(key(o),(uses.get(key(o))||0)+1);
 for(const p of proposals){if([p.b,...p.members.map(m=>m.s),p.positive.observation,...p.debits.map(q=>q.observation)].some(o=>uses.get(key(o))!==1))continue;
  const cash=[p.positive,...p.debits],bridge={financialAccountId:p.wallet.id,sourceObservationId:p.b.id,method:'native_wallet_intermediary_postings',path:'combined_bank_top_up_and_exact_order_payments',confidence:'exact_full_order_cash_references_and_previously_resolved_combined_bank_group',cashEvidenceConfidence:'explicit_original_cash_postings',amountMinor:String(p.n),netDeltaMinor:'0',proofObservationIds:cash.map(q=>q.observation.id),payerAccountId:p.card.id,payerIdentityBasis:'existing_combined_bank_payment_group',bankStatementOwner:p.owner,nativeStatementCardTailPrinted:false,originalBankCashAndDatePreserved:true,originalConsumptionAndOrderGroupingPreserved:true,originalGroupId:p.g.id,sourceOrderObservationIds:p.members.map(m=>m.s.id),originalBankFundingReferenceMasked:true,reversible:true,events:cash.map(q=>({occurredAt:q.observation.occurredAt,date:q.observation.date,deltaMinor:q.delta,observationId:q.observation.id}))};plans.set(p.t.id,[bridge]);
 }
 return plans;
}
module.exports={addCombinedBankWalletBridges};
