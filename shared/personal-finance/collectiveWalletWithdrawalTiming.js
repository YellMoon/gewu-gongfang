'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const bankName=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');
const positive=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const withdrawal=o=>o.provider==='alipay'&&!o.balanceEvidence&&/^\u63d0\u73b0-(\u5feb\u901f|\u666e\u901a|\u5b9e\u65f6)\u63d0\u73b0$/.test(o.description);
const onlyEffect=(effects,id,amount)=>BigInt(effects?.[id]||0)===amount&&Object.entries(effects||{}).every(([other,v])=>other===id||BigInt(v)===0n);

// Project a previously bank-matched batch without assigning its native cash
// rows, or fabricated proportional amounts, to individual economic rows.
function planCollectiveWalletWithdrawalTiming(ledger,transactions,groups){
 const candidates=groups.filter(g=>g.method==='balanced_wallet_withdrawal_group');if(!candidates.length)return[];
 const rows=ledger.observations||[],accounts=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map(rows.map(o=>[o.id,o])),roots=new Map(transactions.map(t=>[t.id,t])),latest=new Map(),ties=new Set(),blocked=new Set(),claimed=new Set();
 for(const o of rows){const k=identity(o),prior=latest.get(k),v=o.sourceVersionOrdinal||0;if(!prior||v>(prior.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(prior.sourceVersionOrdinal||0)&&prior.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(identity(o));}
 for(const l of ledger.links||[])if(l.status!=='deleted'||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}
 for(const t of transactions){for(const id of t.observationIds||[])claimed.add(id);for(const p of t.cashPostingEvidence||[])claimed.add(p.proofObservationId);for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);for(const es of Object.values(t.balanceEffectEvents||{}))for(const e of es)if(e.observationId)claimed.add(e.observationId);}
 const clean=o=>o&&latest.get(identity(o))?.id===o.id&&!ties.has(identity(o))&&!blocked.has(identity(o));
 const native=validatedWalletProofs([...latest.values()],accounts),plans=[];
 for(const g of candidates){
  const e=g.evidence||{},wallet=accounts.get(e.walletAccountId),bank=accounts.get(e.financialAccountId),n=e.count;
  if(!Number.isInteger(n)||n<2||n>32||e.currency!=='CNY'||e.platform!=='alipay'||e.individualIdentity!=='undetermined'||e.ownerProvenByOriginalStatement!==true||e.netReceiptEqualsGross!==true||!positive(e.amountMinor)||e.totalMinor!==String(BigInt(e.amountMinor)*BigInt(n))||wallet?.status!=='active'||wallet.provider!=='alipay'||wallet.type!=='wallet'||wallet.sourceProduct||wallet.currency!=='CNY'||bank?.status!=='active'||bank.type!=='debit_card'||bank.currency!=='CNY'||!/^\d{4}$/.test(bank.maskedIdentifier||''))continue;
  const ps=(g.platformRootIds||[]).map(id=>roots.get(id)),bs=(g.bankRootIds||[]).map(id=>roots.get(id)),all=[...ps,...bs],amount=BigInt(e.amountMinor);
  if(ps.length!==n||bs.length!==n||all.some(t=>!t)||new Set(all.map(t=>t.id)).size!==2*n||all.some(t=>t.status!=='completed'||!['transfer','unknown'].includes(t.kind)||t.currency!=='CNY'||BigInt(t.incomeMinor)!==0n||BigInt(t.consumptionMinor)!==0n||t.appliedAnnotations?.length||t.balanceEffectEvents||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length||t.collectiveBalanceTiming||t.observationIds.length!==1||t.sources.length!==1||!clean(t.sources[0])||t.reconciliationGroup?.id!==g.id))continue;
  const sources=ps.map(t=>t.sources[0]),bankSources=bs.map(t=>t.sources[0]);
  if(new Set(g.observationIds||[]).size!==2*n||all.some(t=>!g.observationIds.includes(t.observationIds[0])))continue;
  if(ps.some(t=>t.kind!=='transfer'||!onlyEffect(t.balanceEffects,wallet.id,-amount)||!onlyEffect(t.cashEffects,wallet.id,-amount)||t.reconciliationGroup.role!=='platform_order'||(t.balanceEffectTimes[wallet.id]||t.occurredAt)!==t.sources[0].occurredAt))continue;
  if(bs.some(t=>!onlyEffect(t.balanceEffects,bank.id,amount)||!onlyEffect(t.cashEffects,bank.id,amount)||t.reconciliationGroup.role!=='bank_evidence'))continue;
  if(bankSources.some(s=>s.financialAccountId!==bank.id||s.date!==e.date||s.currency!=='CNY'||s.direction!=='credit'||s.amountMinor!==e.amountMinor||!s.statementFlow||s.statementFlow.incomeMinor!==e.amountMinor||s.statementFlow.expenseMinor!=='0'||s.bankStatement?.nonCash))continue;
  if(sources.some(s=>{const r=s.rawFields||{};return !withdrawal(s)||s.financialAccountId!==wallet.id||s.date!==e.date||s.currency!=='CNY'||s.kind!=='transfer'||s.direction!=='neutral'||s.status!=='completed'||s.amountMinor!==e.amountMinor||s.paymentAccountHint||s.accountRelations?.length||!['','\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d'].includes(s.paymentChannel)||bankName(s.counterparty)!==bankName(bank.provider)||s.feeMinor!=null&&s.feeMinor!=='0'||!s.sourceTransactionId||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||r['\u4ea4\u6613\u65f6\u95f4']!==s.occurredAt.slice(0,19).replace('T',' ')||r['\u5546\u54c1\u8bf4\u660e']!==s.description||r['\u4ea4\u6613\u5bf9\u65b9']!==s.counterparty||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==s.paymentChannel||r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u91d1\u989d']!==String(amount/100n)+'.'+String(amount%100n).padStart(2,'0');}))continue;
  // Count the entire day/bank/amount class before filtering edits or claims.
  const matching=native.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.date===e.date&&p.outgoing===-amount&&p.incoming===0n&&/^\u63d0\u73b0.+\u652f\u4ed8\u5b9d\u8f6c\u8d26$/.test(p.observation.description)&&p.bank===bankName(bank.provider));
  const rawCashCandidates=[...latest.values()].filter(o=>o.provider==='alipay'&&o.balanceEvidence&&o.financialAccountId===wallet.id&&o.date===e.date&&o.balanceEvidence.expenseMinor===e.amountMinor&&/^\u63d0\u73b0.+\u652f\u4ed8\u5b9d\u8f6c\u8d26$/.test(o.description)&&bankName(o.rawFields?.['\u8d44\u91d1\u6e20\u9053'])===bankName(bank.provider));
  const sameDayOrders=[...latest.values()].filter(s=>withdrawal(s)&&s.financialAccountId===wallet.id&&s.date===e.date&&s.amountMinor===e.amountMinor&&bankName(s.counterparty)===bankName(bank.provider));
  if(matching.length!==n||rawCashCandidates.length!==n||sameDayOrders.length!==n||sameDayOrders.some(s=>!sources.some(o=>o.id===s.id))||matching.some(p=>!clean(p.observation)||claimed.has(p.observation.id))||new Set(matching.map(p=>p.observation.importId)).size!==1||new Set(matching.map(p=>p.observation.relatedReference)).size!==n)continue;
  const importId=matching[0].observation.importId,document=[...latest.values()].filter(o=>o.importId===importId&&o.balanceEvidence),imports=(ledger.imports||[]).filter(i=>i.id===importId&&i.financialAccountId===wallet.id&&i.provider==='alipay'&&i.templateId==='alipay-wallet-balance-table-v1');
  if(imports.length!==1||imports[0].recordCount!==document.length||!document.length||document.some(o=>!clean(o)||!imports[0].observationIds?.includes(o.id))||native.filter(p=>p.observation.importId===importId).length!==document.length)continue;
  const evidence=imports[0].sourceEvidence;
  if(!/^[a-f0-9]{64}$/.test(imports[0].fileHash||'')||evidence?.kind!=='owner_authenticated_browser_table'||evidence.sourceRows!==document.length||!Number.isInteger(evidence.sourcePages)||evidence.sourcePages<1||!(evidence.periodStart<=e.date&&e.date<=evidence.periodEnd))continue;
  const requestTimes=sources.map(s=>Date.parse(s.occurredAt)),cashTimes=matching.map(p=>Date.parse(p.observation.occurredAt));
  // Only intraday, short processing delays of an already unique batch qualify.
  if([...requestTimes,...cashTimes].some(t=>!Number.isFinite(t))||Math.min(...cashTimes)<Math.max(...requestTimes)||Math.max(...cashTimes)-Math.min(...requestTimes)>300000)continue;
  const id='collective-wallet-timing:'+g.id;
  plans.push({id,schema:'collective-wallet-withdrawal-timing-v1',method:'unique_bank_matched_batch_and_complete_native_wallet_day',confidence:'inferred_collective_match',reconciliationGroupId:g.id,financialAccountId:wallet.id,bankAccountId:bank.id,date:e.date,currency:e.currency,totalMinor:String(-amount*BigInt(n)),platformRootIds:[...g.platformRootIds],bankRootIds:[...g.bankRootIds],sourceObservationIds:sources.map(s=>s.id),bankObservationIds:bankSources.map(s=>s.id),originalModeledEvents:ps.map(t=>({transactionId:t.id,occurredAt:t.balanceEffectTimes[wallet.id]||t.occurredAt,deltaMinor:String(t.balanceEffects[wallet.id])})),events:matching.map(p=>({occurredAt:p.observation.occurredAt,date:p.observation.date,deltaMinor:String(p.outgoing),observationId:p.observation.id})).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)),individualIdentity:'undetermined',sourceOrderReferencesMatched:false,bankAmountsAndTimesPreserved:true,originalEconomicRowsPreserved:true,noNewIncomeExpenseOrBankCash:true,reversible:true});
 }
 const uses=new Map();for(const p of plans)for(const id of [...p.platformRootIds,...p.bankRootIds,...p.events.map(e=>e.observationId)])uses.set(id,(uses.get(id)||0)+1);
 return plans.filter(p=>[...p.platformRootIds,...p.bankRootIds,...p.events.map(e=>e.observationId)].every(id=>uses.get(id)===1));
}

// Shared by account balances and independent equations. These events never
// create additional bill rows or change per-day cash/income/expense totals.
function* balancePostings(transactions,groups=[]){
 const suppressed=new Map();for(const g of groups)for(const id of g.platformRootIds){if(!suppressed.has(id))suppressed.set(id,new Set());suppressed.get(id).add(g.financialAccountId);}
 for(const t of transactions)for(const[id,total]of Object.entries(t.balanceEffects))if(!suppressed.get(t.id)?.has(id))for(const e of t.balanceEffectEvents?.[id]||[{occurredAt:t.balanceEffectTimes[id]||t.occurredAt,deltaMinor:total}])yield{...e,financialAccountId:id,transaction:t,transactionId:t.id};
 for(const g of groups)for(const e of g.events)yield{...e,financialAccountId:g.financialAccountId,transaction:{id:g.id,kind:'transfer',observationIds:g.sourceObservationIds,balanceEffects:{[g.financialAccountId]:g.totalMinor}},transactionId:g.id,sourceTransactionIds:g.platformRootIds,collectiveTimingGroupId:g.id};
}
function* accountBalancePostings(transactions,accountId,groups=[]){
 const scoped=groups.filter(g=>g.financialAccountId===accountId),suppressed=new Set(scoped.flatMap(g=>g.platformRootIds));
 // Preserve the existing zero-effect entries too: an unsplit settlement can
 // invalidate an account balance even before it has an allocated balance leg.
 for(const t of transactions)if(!suppressed.has(t.id))for(const e of t.balanceEffectEvents?.[accountId]||[{occurredAt:t.balanceEffectTimes[accountId]||t.occurredAt,deltaMinor:t.balanceEffects[accountId]||0n}])yield{...e,transaction:t};
 for(const g of scoped)for(const e of g.events)yield{...e,transaction:{id:g.id,kind:'transfer',observationIds:g.sourceObservationIds,balanceEffects:{[g.financialAccountId]:g.totalMinor}}};
}
module.exports={planCollectiveWalletWithdrawalTiming,balancePostings,accountBalancePostings};
