'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {statementOwners}=require('./statementOwnership');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const signature=o=>JSON.stringify([o.financialAccountId,o.date,o.currency,o.amountMinor]);
const bankName='\u5efa\u8bbe\u94f6\u884c',norm=v=>String(v||'').replace(/^\u4e2d\u56fd/,'');
const signedMinor=v=>/^-?\d[\d,]*\.\d{2}$/.test(v||'')?BigInt(v.replace(/[,.]/g,'')):null;
const only=(effects,id,amount)=>Object.entries(effects||{}).every(([k,v])=>k===id&&BigInt(v)===amount)&&BigInt(effects?.[id]||0)===amount;
// Equal-count batches identify the funding account without pairing their rows.
// A single receipt with no exported order needs one unique bank debit instead.
function planNativeGroupedBankTopUps(ledger,transactions){
 const originals=ledger.observations||[];
 if(!originals.some(o=>o.provider==='alipay'&&o.description==='\u5145\u503c\u4ea4\u6613\u6210\u529f'&&o.balanceEvidence))return [];
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map(originals.map(o=>[o.id,o])),latest=new Map(),ties=new Set(),blocked=new Set(),roots=new Map(),claimed=new Set();
 for(const o of originals){const k=identity(o),old=latest.get(k),v=o.sourceVersionOrdinal||0;if(!old||v>(old.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(old.sourceVersionOrdinal||0)&&old.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(identity(o));}
 for(const l of ledger.links||[]){const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true;if(!deleted||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}}
 for(const t of transactions){
  for(const id of t.observationIds||[])roots.set(id,t);
  for(const e of t.cashPostingEvidence||[])claimed.add(e.proofObservationId);
  for(const e of t.walletIntermediaryPostings||[])for(const id of e.proofObservationIds||[])claimed.add(id);
  for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);
 }
 const rows=[...latest.values()],owners=statementOwners(ledger.imports||[],rows),proofs=validatedWalletProofs(rows,am),groups=new Map(),allBank=new Map(),orders=new Map();
 const groupKey=(wallet,date,amount)=>JSON.stringify([wallet,date,'CNY',amount]);
 for(const p of proofs)if(p.bank===bankName&&p.incoming>0n&&p.outgoing===0n&&p.observation.description==='\u5145\u503c\u4ea4\u6613\u6210\u529f'){
  const k=groupKey(p.observation.financialAccountId,p.observation.date,String(p.incoming));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);
 }
 // Count every printed Alipay bank debit before checking its ownership or edits.
 for(const o of rows)if(!o.balanceEvidence&&o.status==='completed'&&o.currency==='CNY'&&o.direction==='debit'&&(o.statementFlow||o.bankStatement)&&/\u652f\u4ed8\u5b9d/.test([o.description,...Object.values(o.rawFields||{})].join(' '))){
  const k=JSON.stringify([o.date,o.currency,o.amountMinor]);if(!allBank.has(k))allBank.set(k,[]);allBank.get(k).push(o);
 }
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.description==='\u5145\u503c-\u666e\u901a\u5145\u503c'){
  const k=groupKey(o.financialAccountId,o.date,o.amountMinor);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);
 }
 const clean=o=>!ties.has(identity(o))&&!blocked.has(identity(o));
 const cleanRoot=(o,kind,consumption,id,delta)=>{
  const t=roots.get(o.id);
  return clean(o)&&t&&t.observationIds.length===1&&t.observationIds[0]===o.id&&t.status==='completed'&&t.currency==='CNY'&&t.kind===kind&&BigInt(t.consumptionMinor)===consumption&&BigInt(t.incomeMinor)===0n&&only(t.balanceEffects,id,delta)&&only(t.cashEffects,id,delta)&&!t.cashPostingEvidence?.length&&!t.walletIntermediaryPostings?.length&&!t.balanceEffectEvents&&!t.cashEffectEvents&&!t.automaticAssociations?.length&&!t.appliedAnnotations?.length&&!t.nativeGroupedBankTopUp;
 };
 const plans=[];
 for(const [k,ps]of groups){
  if(ps.length<1||ps.length>16)continue;
  const first=ps[0].observation,wallet=am.get(first.financialAccountId),amount=ps[0].incoming,bs=allBank.get(JSON.stringify([first.date,'CNY',String(amount)]))||[],os=orders.get(k)||[];
  if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||bs.length!==ps.length||os.length>ps.length||(ps.length===1?os.length!==0:os.length<1))continue;
  if(new Set(bs.map(o=>o.financialAccountId)).size!==1)continue;
  const bank=am.get(bs[0].financialAccountId);
  if(bank?.status!=='active'||bank.type!=='debit_card'||bank.currency!=='CNY'||norm(bank.provider)!==bankName||!/^\d{4}$/.test(bank.maskedIdentifier||''))continue;
  const ownerNames=new Set(bs.map(o=>owners.get(o.id)));if(ownerNames.size!==1||ownerNames.has(undefined))continue;
  if(bs.some(o=>{
   const raw=o.rawFields||{},f=o.statementFlow;
   return o.provider!=='ccb'||o.kind!=='expense'||o.date!==first.date||f?.schema!=='ccb-debit-v1'||f.incomeMinor!=='0'||f.expenseMinor!==String(amount)||raw['\u6458\u8981']!=='\u6d88\u8d39'||raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']!=='\u652f\u4ed8\u5b9d'||raw['\u4ea4\u6613\u65e5\u671f']!==o.date.replace(/-/g,'')||signedMinor(raw['\u4ea4\u6613\u91d1\u989d'])!==-amount||signedMinor(raw['\u8d26\u6237\u4f59\u989d'])===null||!/^\d+$/.test(String(raw['\u5e8f\u53f7']))||!cleanRoot(o,'expense',amount,bank.id,-amount);
  }))continue;
  if(ps.some(p=>!clean(p.observation)||claimed.has(p.observation.id)||roots.has(p.observation.id)||!p.observation.occurredAt.endsWith('+08:00')||!new RegExp('^'+first.date.replace(/-/g,'')+'\\d+\\*+\\d+$').test(p.observation.relatedReference)))continue;
  if(new Set(ps.map(p=>JSON.stringify([p.observation.relatedReference,p.observation.occurredAt]))).size!==ps.length)continue;
  // All same-day, same-amount native bank top-ups must participate, including
  // differently named receipts; otherwise an incomplete group can look unique.
  if(proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.date===first.date&&p.incoming===amount&&p.outgoing===0n&&p.bank===bankName).length!==ps.length)continue;
  // An already represented wallet receipt or bridge is a veto, never a match.
  if(ps.length===1&&transactions.some(t=>
   (t.date===first.date&&BigInt(t.balanceEffects?.[wallet.id]||0)===amount)||
   (t.balanceEffectEvents?.[wallet.id]||[]).some(e=>String(e.occurredAt||'').slice(0,10)===first.date&&BigInt(e.deltaMinor||0)===amount)
  ))continue;
  if(os.some(o=>{
   const raw=o.rawFields||{},t=roots.get(o.id),r=require('./unfundedWalletReceipts').explicitUnfundedWalletReceipt(o,wallet);
   return !r||o.automaticFunding||o.paymentChannel||o.paymentAccountHint||o.accountRelations?.length||raw['\u4ea4\u6613\u65f6\u95f4']!==o.occurredAt.slice(0,19).replace('T',' ')||!o.occurredAt.endsWith('+08:00')||!cleanRoot(o,'transfer',0n,wallet.id,amount)||!t.walletTopupReceipt||t.walletTopupReceipt.sourceAccountKnown!==false||ps.some(p=>Date.parse(p.observation.occurredAt)<Date.parse(o.occurredAt)||Date.parse(p.observation.occurredAt)-Date.parse(o.occurredAt)>30*60000);
  }))continue;
  plans.push({wallet,bank,proofs:ps,bankRows:bs,orders:os,roots,ownerName:[...ownerNames][0]});
 }
 const uses=new Map();for(const p of plans)for(const o of[...p.bankRows,...p.orders,...p.proofs.map(q=>q.observation)])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return plans.filter(p=>[...p.bankRows,...p.orders,...p.proofs.map(q=>q.observation)].every(o=>uses.get(identity(o))===1));
}
function appendNativeGroupedBankTopUps(ledger,transactions,selected,issues,buildRawTransactions){
 const plans=planNativeGroupedBankTopUps(ledger,transactions);if(!plans.length)return;
 const derived=[],byId=new Map(),accountIds=new Set(),evidences=new Map();
 for(const p of plans){
  const single=p.proofs.length===1;
  const e={schema:'native-grouped-bank-top-ups-v1',method:single?'unique_bank_debit_and_original_wallet_receipt':'equal_count_bank_debits_and_original_wallet_receipts',date:p.proofs[0].observation.date,currency:'CNY',walletAccountId:p.wallet.id,bankAccountId:p.bank.id,bankCardTail:p.bank.maskedIdentifier,bankStatementOwner:p.ownerName,bankCount:p.bankRows.length,nativeReceiptCount:p.proofs.length,exportOrderCount:p.orders.length,amountEachMinor:String(p.proofs[0].incoming),totalMinor:String(p.proofs[0].incoming*BigInt(p.proofs.length)),individualBankReceiptIdentity:single?'inferred_unique_bank_and_wallet_cash':'undetermined_within_group',exportOrderReceiptIdentity:single?'missing_export_order':'undetermined_within_group',bankCashAlreadyPosted:true,originalBankDatesPreserved:true,missingExportOrderNotInvented:true,exportOrderFinancialLegCoveredByNativeGroup:!single,evidenceObservationIds:[...p.bankRows,...p.orders,...p.proofs.map(q=>q.observation)].map(o=>o.id),reversible:true};
  evidences.set(p,e);accountIds.add(p.wallet.id);
  for(const proof of p.proofs){const s=proof.observation;byId.set(s.id,{p,proof,e});derived.push({...s,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(proof.incoming),direction:'credit',kind:'transfer',paymentChannel:'\u4f59\u989d',paymentAccountHint:'',relatedReference:'',category:'\u652f\u4ed8\u5b9d\u5145\u503c\uff08\u539f\u4ef6\u6574\u7ec4\u6838\u5bf9\uff09'});}
 }
 const accounts=ledger.accounts.filter(a=>accountIds.has(a.id)).map(a=>Object.fromEntries(['id','label','type','provider','status','currency','maskedIdentifier'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))),added=buildRawTransactions({accounts,observations:derived,annotations:[],links:[],imports:[],balanceSnapshots:[]},{accountIds:[...selected]});
 if(added.length!==derived.length)throw new Error('NATIVE_GROUPED_TOPUPS_UNEXPECTED_MERGE');
 for(const t of added){const q=byId.get(t.id);if(!q||t.observationIds.length!==1||t.consumptionMinor!==0n||t.incomeMinor!==0n||!only(t.balanceEffects,q.p.wallet.id,q.proof.incoming)||!only(t.cashEffects,q.p.wallet.id,q.proof.incoming))throw new Error('NATIVE_GROUPED_TOPUPS_CASH_MISMATCH');}
 for(const p of plans){
  const e=evidences.get(p),attach=(t,role)=>{t.nativeGroupedBankTopUp={...e,role};t.automaticAssociations=[...(t.automaticAssociations||[]),{method:e.method,confidence:e.individualBankReceiptIdentity==='inferred_unique_bank_and_wallet_cash'?'inferred_unique_bank_and_wallet_cash':'inferred_group_account_not_individual_pair',observationIds:e.evidenceObservationIds,evidence:e}];};
  for(const o of p.bankRows){const t=p.roots.get(o.id);t.kind='transfer';t.category='\u652f\u4ed8\u5b9d\u5145\u503c\uff08\u539f\u4ef6\u6574\u7ec4\u6838\u5bf9\uff09';t.consumptionMinor=0n;t.selectedConsumptionMinor=0n;attach(t,'bank_debit');}
  for(const o of p.orders){
   const t=p.roots.get(o.id);t.balanceEffects={...t.balanceEffects,[p.wallet.id]:0n};t.cashEffects={...t.cashEffects,[p.wallet.id]:0n};
   t.nativeGroupedBankTopUpOriginalReceipt=t.walletTopupReceipt;delete t.walletTopupReceipt;
   t.automaticFunding={financialAccountId:p.bank.id,method:e.method,confidence:'inferred',groupAccountIdentificationOnly:true,evidenceObservationIds:e.evidenceObservationIds,reversible:true};attach(t,'supplemental_export_order');
   for(let i=issues.length-1;i>=0;i--)if(issues[i].observationId===o.id&&issues[i].reason==='unresolved_account_movement'&&issues[i].basis==='native_wallet_receipt_source_unknown'&&issues[i].receivingAccountId===p.wallet.id)issues.splice(i,1);
  }
 }
 for(const t of added){const {p,proof,e}=byId.get(t.id);t.sources=[proof.observation];t.nativeGroupedBankTopUp={...e,role:'actual_wallet_credit'};t.cashPostingEvidence=[{method:e.method,proofObservationId:t.id,financialAccountId:p.wallet.id,deltaMinor:String(proof.incoming),occurredAt:proof.observation.occurredAt,date:proof.observation.date,confidence:'explicit_original_cash_posting',reversible:true}];t.financialAccountIds=[...new Set([...t.financialAccountIds,p.bank.id])];transactions.push(t);}
}
module.exports={planNativeGroupedBankTopUps,appendNativeGroupedBankTopUps};
