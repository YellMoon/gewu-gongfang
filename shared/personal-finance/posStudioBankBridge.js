'use strict';
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/\u80a1\u4efd\u6709\u9650\u516c\u53f8$/,'');
const tail=v=>String(v||'').match(/^(?:\*+|\d+)?(\d{4})$/)?.[1];
const money=v=>{const m=String(v??'').match(/^([+-]?)(\d+)\.(\d{2})$/);return m?(BigInt(m[2])*100n+BigInt(m[3]))*(m[1]==='-'?-1n:1n):null;};
const isDeleted=l=>l.status==='deleted'||Boolean(l.deletedAt)||l.deleted===true;
function nativeMybank(o,direction,amount){
 const f=o.statementFlow,r=o.rawFields||{},sign=direction==='credit'?1n:-1n;
 return o.provider==='mybank'&&o.status==='completed'&&o.currency==='CNY'&&o.direction===direction&&o.amountMinor===amount&&f?.schema==='mybank-current-v1'&&Number.isSafeInteger(f.sequence)&&f.incomeMinor===(direction==='credit'?amount:'0')&&f.expenseMinor===(direction==='debit'?amount:'0')&&r['\u4ea4\u6613\u65f6\u95f4']===o.date+o.occurredAt.slice(11,19)&&r['\u4ea4\u6613\u540d\u79f0']===o.description&&r['\u5bf9\u65b9\u6237\u540d']===o.counterparty&&r['\u4ea4\u6613\u6d41\u6c34\u53f7']===o.sourceTransactionId&&money(r['\u4ea4\u6613\u91d1\u989d'])===BigInt(amount)*sign&&money(r['\u4f59\u989d'])===BigInt(o.balanceMinor??'-1')&&/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d\+08:00$/.test(o.occurredAt);
}
// Trace purpose only through reciprocal bank originals and a cleared, adjacent
// MYbank session. Printed receiving-account aliases never choose a new card.
function findPosStudioBankBridge(source,next,studio,accounts,context){
 const bank=accounts.find(a=>a.id===source.financialAccountId),rows=context.rows;
 if(!bank||norm(bank.provider)!=='\u676d\u5dde\u94f6\u884c'||!/^\d{4}$/.test(bank.maskedIdentifier||'')||studio?.status!=='active'||studio.fundsRole!=='studio_public'||studio.type!=='debit_card'||studio.currency!=='CNY'||studio.maskedIdentifier!=='2110'||norm(studio.provider)!=='\u6c5f\u82cf\u94f6\u884c')return null;
 const outValid=o=>o.provider==='hangzhou'&&o.financialAccountId===bank.id&&o.status==='completed'&&o.currency==='CNY'&&o.direction==='debit'&&o.amountMinor===source.amountMinor&&o.statementFlow?.schema==='hangzhou-debit-v1'&&o.statementFlow.incomeMinor==='0'&&o.statementFlow.expenseMinor===source.amountMinor&&['\u8f6c\u5e10','\u8f6c\u8d26'].includes(o.description)&&o.rawFields?.description===o.description&&o.rawFields?.counterparty===o.counterparty&&['\u6d59\u6c5f\u7f51\u5546\u94f6\u884c','\u7f51\u5546\u94f6\u884c'].includes(norm(o.counterparty));
 const proposals=[];
 for(const out of next.filter(outValid)){
  const days=(Date.parse(out.date)-Date.parse(source.date))/86400000;if(days<0||days>31)continue;
  if(rows.filter(o=>outValid(o)&&o.date===out.date).length!==1)continue;
  const posPeers=(context.posReceipts||[]).filter(o=>o.financialAccountId===source.financialAccountId&&o.amountMinor===source.amountMinor&&o.date<=out.date&&Date.parse(out.date)-Date.parse(o.date)<=31*86400000);if(posPeers.length!==1||posPeers[0].id!==source.id)continue;
  const credits=rows.filter(o=>nativeMybank(o,'credit',source.amountMinor)&&o.date===out.date&&o.description==='\u8f6c\u5165\u7f51\u5546\u94f6\u884c\u8d26\u6237'&&norm(o.rawFields['\u5bf9\u65b9\u673a\u6784\u540d\u79f0'])===norm(bank.provider)&&tail(o.rawFields['\u5bf9\u65b9\u8d26\u53f7'])===bank.maskedIdentifier&&o.balanceMinor===source.amountMinor&&accounts.some(a=>a.id===o.financialAccountId&&a.status==='active'&&a.type==='debit_card'&&a.currency==='CNY'&&norm(a.provider)==='\u7f51\u5546\u94f6\u884c'));
  if(credits.length!==1)continue;const credit=credits[0];
  const debits=rows.filter(o=>nativeMybank(o,'debit',source.amountMinor)&&o.financialAccountId===credit.financialAccountId&&o.importId===credit.importId&&o.date===credit.date&&o.statementFlow.sequence===credit.statementFlow.sequence+1&&o.description==='\u7f51\u5546\u94f6\u884c\u8f6c\u8d26'&&norm(o.rawFields['\u5bf9\u65b9\u673a\u6784\u540d\u79f0'])===norm(studio.provider)&&tail(o.rawFields['\u5bf9\u65b9\u8d26\u53f7'])===studio.maskedIdentifier&&o.balanceMinor==='0'&&Date.parse(o.occurredAt)>=Date.parse(credit.occurredAt)&&Date.parse(o.occurredAt)-Date.parse(credit.occurredAt)<=60000);
  if(debits.length!==1)continue;const debit=debits[0],members=[source,out,credit,debit],ids=new Set(members.map(o=>o.id)),controls=context.routingControls||{};
  const veto=(controls.links||[]).some(l=>{const relevant=(l.observationIds||[]).filter(id=>ids.has(id));return l.type==='group_distinct'&&!isDeleted(l)&&relevant.length>0||(l.type==='distinct'&&!isDeleted(l)||['duplicate','transfer'].includes(l.type)&&isDeleted(l))&&relevant.length>=2&&relevant.length===l.observationIds.length;});
  if(veto)continue;const latest=new Map();for(const a of controls.annotations||[]){const old=latest.get(a.observationId);if(!old||BigInt(a.revision)>BigInt(old.revision))latest.set(a.observationId,a);}
  if([out,credit,debit].some(o=>{const a=latest.get(o.id);return a&&(a.reset===true||!a.patch||Object.keys(a.patch).some(k=>!['kind','category'].includes(k))||a.patch.kind&&a.patch.kind!=='transfer');}))continue;
  proposals.push({terminalTransfer:debit,evidence:{schema:'pos-studio-mybank-bridge-v1',sourceObservationId:source.id,payerBankOutObservationId:out.id,intermediateCreditObservationId:credit.id,intermediateDebitObservationId:debit.id,receivingAccountId:bank.id,intermediateAccountId:credit.financialAccountId,studioAccountId:studio.id,amountMinor:source.amountMinor,receiptDate:source.date,bankTransferDate:out.date,studioTransferDate:debit.date,intermediateDelaySeconds:(Date.parse(debit.occurredAt)-Date.parse(credit.occurredAt))/1000,printedPayerCardTail:tail(credit.rawFields['\u5bf9\u65b9\u8d26\u53f7']),printedStudioCardTail:tail(debit.rawFields['\u5bf9\u65b9\u8d26\u53f7']),printedIntermediateCounterAccount:out.rawFields.counterAccount,intermediateSelectionBasis:'unique_reciprocal_original_bank_date_amount_and_printed_payer_card',intermediateBalanceBeforeMinor:'0',intermediateBalanceAfterMinor:'0',originalBankCashAndDatesPreserved:true,printedReceivingAliasUsedToSelectAccount:false,noNewCash:true,noNewAccounts:true,reversible:true}});
 }
 return proposals.length===1?proposals[0]:null;
}
module.exports={findPosStudioBankBridge};
