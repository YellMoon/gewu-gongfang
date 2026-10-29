'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {validateWithdrawalFeeEvidence}=require('./withdrawalFeeEvidence');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=v=>String(v||'').replace(/^\u4e2d\u56fd/,'');
const minor=v=>/^\d+\.\d{2}$/.test(v||'')?String(BigInt(v.replace('.',''))):null;
function planGroupedWalletWithdrawalPostings(ledger,transactions){
 if(!(ledger.observations||[]).some(o=>o.provider==='alipay'&&!o.balanceEvidence&&/^\u63d0\u73b0-(\u5feb\u901f|\u666e\u901a|\u5b9e\u65f6)\u63d0\u73b0$/.test(o.description)))return [];
 const rows=ledger.observations||[],byId=new Map(rows.map(o=>[o.id,o])),am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),latest=new Map(),ties=new Set(),blocked=new Set(),claims=new Map();
 for(const o of rows){const k=key(o),p=latest.get(k),v=o.sourceVersionOrdinal||0;if(!p||v>(p.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(p.sourceVersionOrdinal||0)&&p.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(key(o));}
 for(const l of ledger.links||[]){const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true;if(!deleted||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(key(o));}}
 const claim=(id,root)=>{if(!claims.has(id))claims.set(id,new Set());claims.get(id).add(root);};
 for(const t of transactions){for(const id of t.observationIds)claim(id,t.id);for(const e of t.cashPostingEvidence||[])claim(e.proofObservationId,t.id);for(const b of t.walletIntermediaryPostings||[])for(const id of b.proofObservationIds||[])claim(id,t.id);for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claim(e.observationId,t.id);}
 const proofs=validatedWalletProofs([...latest.values()],am),refs=new Map(),orders=new Map();
 for(const p of proofs){const k=JSON.stringify([p.observation.financialAccountId,p.observation.relatedReference]);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(p);}
 for(const o of latest.values())if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=JSON.stringify([o.financialAccountId,o.sourceTransactionId]);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const clean=o=>latest.get(key(o))?.id===o.id&&!ties.has(key(o))&&!blocked.has(key(o));
 const plans=[];
 for(const t of transactions){
  if(t.kind!=='transfer'||t.status!=='completed'||t.currency!=='CNY'||BigInt(t.consumptionMinor)!==0n||BigInt(t.incomeMinor)!==0n||t.groupedWalletWithdrawalPostings||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length)continue;
  const sources=t.sources||[],feeSources=sources.filter(s=>s.withdrawalFeeEvidence);if(feeSources.length>1)continue;
  const fee=feeSources[0],withdrawals=sources.filter(s=>s.provider==='alipay'&&!s.balanceEvidence&&!s.withdrawalFeeEvidence&&/^\u63d0\u73b0-(\u5feb\u901f|\u666e\u901a|\u5b9e\u65f6)\u63d0\u73b0$/.test(s.description));
  if(!withdrawals.length)continue;
  const w=am.get(withdrawals[0].financialAccountId),receivers=Object.entries(t.balanceEffects).filter(([id,v])=>id!==w?.id&&BigInt(v)>0n&&am.get(id)?.type==='debit_card'),bank=receivers.length===1?am.get(receivers[0][0]):null,sourceDate=withdrawals[0].date;
  if(w?.status!=='active'||w.type!=='wallet'||w.provider!=='alipay'||w.currency!=='CNY'||w.sourceProduct||bank?.status!=='active'||bank.currency!=='CNY'||!/^\d{4}$/.test(bank.maskedIdentifier||'')||t.withdrawalDestination&&t.withdrawalDestination.financialAccountId!==bank.id)continue;
  let e;
  if(fee){
   try{e=validateWithdrawalFeeEvidence(fee.withdrawalFeeEvidence,fee);}catch{continue;}
   if(e.platform!=='alipay'||e.feeMinor!=='0'||!clean(fee)||fee.financialAccountId!==w.id||fee.date!==sourceDate)continue;
   const imports=(ledger.imports||[]).filter(i=>i.id===fee.importId&&i.provider==='alipay'&&i.financialAccountId===w.id&&i.templateId==='workbook-withdrawal-fees-v1'&&/^[a-f0-9]{64}$/.test(i.fileHash||'')&&i.observationIds?.includes(fee.id));if(imports.length!==1)continue;
  }
  const bankSources=sources.filter(s=>s!==fee&&!withdrawals.includes(s));
  if(bankSources.some(s=>!clean(s)||s.financialAccountId!==bank.id||s.status!=='completed'||s.direction!=='credit'||s.currency!=='CNY'||!s.statementFlow||s.bankStatement?.nonCash||!/^[1-9]\d*$/.test(s.amountMinor)))continue;
  if(!fee&&!bankSources.length&&t.withdrawalDestination?.financialAccountId!==bank.id)continue;
  if(withdrawals.length<1||withdrawals.length>126||t.balanceEffectEvents?.[w.id]||t.cashEffectEvents?.[w.id]||t.appliedAnnotations?.length)continue;
  let valid=true;const matched=[];
  for(const s of withdrawals){
   const raw=s.rawFields||{},k=JSON.stringify([w.id,s.sourceTransactionId]),cash=refs.get(k)||[],amount=BigInt(s.amountMinor||'0');
   if(!clean(s)||s.financialAccountId!==w.id||s.provider!=='alipay'||s.currency!=='CNY'||s.date!==sourceDate||s.status!=='completed'||s.kind!=='transfer'||s.direction!=='neutral'||!/^\u63d0\u73b0-(\u5feb\u901f|\u666e\u901a|\u5b9e\u65f6)\u63d0\u73b0$/.test(s.description)||s.paymentChannel!=='\u4f59\u989d'||s.paymentAccountHint||s.accountRelations?.length||norm(s.counterparty)!==norm(bank.provider)||amount<=0n||s.feeMinor!=null&&s.feeMinor!=='0'||raw['\u4ea4\u6613\u65f6\u95f4']!==s.occurredAt.slice(0,19).replace('T',' ')||!s.occurredAt.endsWith('+08:00')||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||raw['\u5546\u54c1\u8bf4\u660e']!==s.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==s.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!=='\u4f59\u989d'||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||minor(raw['\u91d1\u989d'])!==s.amountMinor||orders.get(k)?.length!==1||cash.length!==1){valid=false;break;}
   const p=cash[0],o=p.observation,delay=Date.parse(o.occurredAt)-Date.parse(s.occurredAt);
   if(!clean(o)||(claims.get(o.id)||new Set()).size||p.incoming!==0n||p.outgoing!==-amount||o.date!==s.date||!/^\u63d0\u73b0/.test(o.description)||!(p.bank.endsWith('\u94f6\u884c')||p.bank==='\u7f51\u8054')||delay<0||delay>60000){valid=false;break;}
   matched.push({source:s,proof:p});
  }
  const total=withdrawals.reduce((n,s)=>n+BigInt(s.amountMinor),0n);
  if(!valid||e&&BigInt(e.grossMinor)!==total||bankSources.length&&bankSources.reduce((n,s)=>n+BigInt(s.amountMinor),0n)!==total||BigInt(t.balanceEffects[w.id]||0)!==-total||BigInt(t.cashEffects[w.id]||0)!==-total||BigInt(t.balanceEffects[bank.id]||0)!==total||BigInt(t.cashEffects[bank.id]||0)!==total||Object.entries(t.balanceEffects).some(([id,v])=>![w.id,bank.id].includes(id)&&BigInt(v)!==0n)||Object.entries(t.cashEffects).some(([id,v])=>![w.id,bank.id].includes(id)&&BigInt(v)!==0n))continue;
  plans.push({t,w,bank,fee,total,matched});
 }
 const uses=new Map();for(const p of plans)for(const m of p.matched)uses.set(key(m.proof.observation),(uses.get(key(m.proof.observation))||0)+1);
 return plans.filter(p=>p.matched.every(m=>uses.get(key(m.proof.observation))===1));
}
function applyGroupedWalletWithdrawalPostings(ledger,transactions){
 for(const p of planGroupedWalletWithdrawalPostings(ledger,transactions)){
  const events=p.matched.map(m=>({date:m.proof.observation.date,occurredAt:m.proof.observation.occurredAt,deltaMinor:m.proof.outgoing,observationId:m.proof.observation.id})).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)),t=p.t;
  t.groupedWalletWithdrawalPostings={schema:'grouped-wallet-withdrawal-postings-v1',method:'exact_native_wallet_debits_preserve_collective_bank_receipt',walletAccountId:p.w.id,bankAccountId:p.bank.id,withdrawalCount:p.matched.length,totalMinor:String(p.total),feeMinor:p.fee?'0':null,...(p.fee?{}:{feeBasis:'existing_ledger_amounts_preserved_no_new_fee_assertion',nativeDisbursementChannelUsedToSelectReceivingAccount:false}),originalWalletEffectTime:t.balanceEffectTimes[p.w.id]||t.occurredAt,sourcePairs:p.matched.map(m=>({withdrawalObservationId:m.source.id,proofObservationId:m.proof.observation.id,fullOrderReference:m.source.sourceTransactionId,amountMinor:m.source.amountMinor})),feeEvidenceObservationId:p.fee?.id||null,bankIndividualReceiptsNotInferred:true,originalBankAggregateAndTimestampPreserved:true,noNewCashConsumptionOrIncome:true,reversible:true};
  t.balanceEffectEvents={...t.balanceEffectEvents,[p.w.id]:events};t.balanceEffectTimes={...t.balanceEffectTimes,[p.w.id]:events.at(-1).occurredAt};
  t.cashPostingEvidence=p.matched.map(m=>({method:t.groupedWalletWithdrawalPostings.method,proofObservationId:m.proof.observation.id,financialAccountId:p.w.id,deltaMinor:String(m.proof.outgoing),occurredAt:m.proof.observation.occurredAt,date:m.proof.observation.date,confidence:'exact_full_original_order_and_cash_debit',reversible:true}));
 }
}
module.exports={planGroupedWalletWithdrawalPostings,applyGroupedWalletWithdrawalPostings};
