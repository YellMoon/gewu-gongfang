'use strict';
const {statementCounterAccount}=require('./statementAccounts');
const {compatibleBankTradeTime,actualSecond}=require('./mixedPayments');
function explicitCounterConflict(record,account){
 const raw=record.rawFields||{},number=String(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7']||raw['\u5bf9\u65b9\u8d26\u53f7']||raw.counterAccount||''),institution=String(raw['\u5bf9\u65b9\u5f00\u6237\u884c']||raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').replace(/\s/g,''),tail=number.match(/(\d{4})\)?$/)?.[1],expected=String(account?.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1],bank=String(account?.provider||'').normalize('NFKC').replace(/\s/g,'');
 return !!(tail&&expected&&bank&&institution.includes(bank)&&tail!==expected);
}
function findOwnedBankTransfers(observations,accounts,{annotatedIds=new Set(),links=[],statementOwners=new Map()}={}){
 const accountMap=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const active=links.filter(l=>l.status!=='deleted'),activeKeys=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|')));
 const blocked=(a,b)=>vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.includes(identity(a))||keys.includes(identity(b)):keys.includes(identity(a))&&keys.includes(identity(b));});
 const rows=[...latest.values()].filter(o=>{const a=accountMap.get(o.financialAccountId);return o.statementFlow&&o.status==='completed'&&['unknown','transfer'].includes(o.kind)&&['credit','debit'].includes(o.direction)&&BigInt(o.amountMinor)>0n&&!annotated.has(identity(o))&&a?.status==='active'&&['bank','savings','debit_card'].includes(a.type);});
 const index=new Map(),key=(o,accountId,direction)=>JSON.stringify([accountId,o.date,o.amountMinor,o.currency,direction]);for(const o of rows){const k=key(o,o.financialAccountId,o.direction);if(!index.has(k))index.set(k,[]);index.get(k).push(o);}
 const proposals=new Map();
 for(const o of rows){
  let counter=statementCounterAccount(o,accounts)||(o.automaticClassification?.method==='explicit_owned_counter_account'&&o.automaticClassification.confidence==='owner_confirmed'?accountMap.get(o.automaticClassification.financialAccountId):null),namedTail=false;
  if(!counter&&(o.direction==='credit'&&/\u94f6\u8054\u5165\u8d26|\u8f6c\u8d26\u5b58\u5165|\u8f6c\u5165\u7f51\u5546\u94f6\u884c\u8d26\u6237/.test(o.description)||o.direction==='debit'&&statementOwners.has(o.id)&&o.counterparty===statementOwners.get(o.id)&&/汇兑|网转|互联汇出|转账/.test(o.description))){
   const raw=o.rawFields||{},number=String(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7']||raw['\u5bf9\u65b9\u8d26\u53f7']||raw.counterAccount||''),tail=number.match(/(\d{4})\)?$/)?.[1],institution=String(raw['\u5bf9\u65b9\u5f00\u6237\u884c']||raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').replace(/\s/g,''),matches=accounts.filter(a=>a.id!==o.financialAccountId&&a.status==='active'&&a.currency===o.currency&&['bank','savings','debit_card'].includes(a.type)&&tail&&String(a.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1]===tail);
   if(matches.length===1&&(!institution||institution.includes(String(matches[0].provider).normalize('NFKC').replace(/\s/g,'')))){counter=matches[0];namedTail=true;}
  }
  if(!counter||!['bank','savings','debit_card'].includes(counter.type))continue;
  const previousDate=new Date(Date.parse(o.date)-86400000).toISOString().slice(0,10),priorReceipts=o.provider==='hangzhou'&&o.statementFlow?.schema==='hangzhou-debit-v1'&&o.direction==='debit'&&namedTail?(index.get(key({...o,date:previousDate},counter.id,'credit'))||[]).filter(b=>b.provider==='spdb'&&b.statementFlow?.schema==='spdb-debit-v1'&&b.statementFlow.timePrecision==='second'&&b.occurredAt.slice(11,19)>='23:00:00'):[];
  for(const b of [...(index.get(key(o,counter.id,o.direction==='credit'?'debit':'credit'))||[]),...priorReceipts]){
   if(namedTail){const owner=statementOwners.get(o.id)||statementOwners.get(b.id),name=String(o.counterparty||'').normalize('NFKC').trim().split('/').at(-1);if(!owner||name!==owner||!/\u94f6\u8054|\u4e91\u95ea\u4ed8|\u8f6c\u8d26|\u7f51\u5546\u94f6\u884c|\u6c47\u5151/.test(b.description))continue;}
   if(namedTail&&o.direction==='debit'&&!(b.provider==='spdb'&&b.statementFlow?.schema==='spdb-debit-v1'&&b.description==='银联入账:'+statementOwners.get(o.id)&&b.rawFields?.['交易名称']===b.description&&b.counterparty==='待收银行卡跨行往来垫款'))continue;
   const reverse=statementCounterAccount(b,accounts);if(reverse&&reverse.id!==o.financialAccountId||explicitCounterConflict(b,accountMap.get(o.financialAccountId))||blocked(o,b)||!compatibleBankTradeTime(o,b)||!compatibleBankTradeTime(b,o))continue;
   if(actualSecond(o)&&actualSecond(b)&&Math.abs(Date.parse(o.occurredAt)-Date.parse(b.occurredAt))>300000)continue;
   const ids=[o.id,b.id].sort();proposals.set(ids.join('|'),{debit:o.direction==='debit'?o:b,credit:o.direction==='credit'?o:b,identityEvidenceObservationIds:[o.id,...(reverse?[b.id]:[])]});
  }
 }
 const uses=new Map();for(const m of proposals.values())for(const o of [m.debit,m.credit])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return [...proposals.values()].filter(m=>[m.debit,m.credit].every(o=>uses.get(identity(o))===1));
}
function payerCardTail(record){
 const raw=record.rawFields||{},explicit=String(raw['\u4ed8\u6b3e\u5c3e\u53f7']||raw.payerCardTail||'');
 if(/^\d{4}$/.test(explicit))return explicit;
 const text=String(record.description||'').normalize('NFKC');
 const labelled=text.match(/(?:\u4ed8\u6b3e(?:\u5361|\u8d26\u53f7)?(?:\u5c3e\u53f7)?|\u8fd8\u6b3e\u5361\u5c3e\u53f7)[\s:]*[*xX]*(\d{4})(?!\d)/);
 if(labelled)return labelled[1];
 const minsheng=record.provider==='minsheng'&&record.bankStatement&&record.direction==='credit'&&record.kind==='debt_payment'&&text.match(/^\u94f6\u8054\u4fe1\u7528\u5361\u8fd8\u6b3e\*+(\d{4})$/);if(minsheng)return minsheng[1];
 // In Bocom remittance descriptions, this labelled card is the payer card,
 // not the receiving credit card and not an arbitrary merchant number.
 const incoming=record.provider==='bocom'&&record.bankStatement&&record.kind==='debt_payment'&&record.direction==='credit'&&text.match(/^信用卡还款\s+转入卡\s+(\d{4})\s+[\u4e00-\u9fff]+银行$/);
 if(incoming)return incoming[1];
 // These statement formats end the remittance description with the payer's
 // card tail. Do not extract four digits from arbitrary merchants/references.
 return /\u94f6\u8054\u5165\u8d26|\u8f6c\u8d26\u8fd8\u6b3e-\u94f6\u8054/.test(text)?text.match(/(?:^|\D)(\d{4})\s*$/)?.[1]||null:null;
}
function originalUnionpayRepaymentEnvelope(d,c,source,receiving,owner){
 const norm=v=>String(v||'').normalize('NFKC').trim();
 if(source?.status!=='active'||receiving?.status!=='active'||source.currency!==receiving.currency||d.currency!==source.currency||c.currency!==receiving.currency||d.date!==c.date||c.bankStatement?.schema!=='bank-credit-v1'||c.bankStatement.provider!==c.provider||c.bankStatement.cardTail!==receiving.maskedIdentifier||c.rawFields?.statementCredit!==true||c.rawFields?.statementAmountMinor!=='-'+c.amountMinor||c.rawFields?.dateBasis!=='transaction_date'||c.rawFields?.tradeDate!==c.date)return null;
 if(owner&&/^(?:\u4e2d\u56fd)?\u5efa\u8bbe\u94f6\u884c$/.test(source.provider)&&d.provider==='ccb'&&d.statementFlow.schema==='ccb-debit-v1'&&d.rawFields?.dateBasis==='transaction_date'&&d.rawFields?.['\u4ea4\u6613\u65e5\u671f']===d.date.replace(/-/g,'')&&d.rawFields?.['\u6458\u8981']==='\u8f6c\u8d26\u652f\u53d6'&&norm(d.rawFields?.['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00'])==='\u94f6\u8054\u8f6c\u8d26(\u4e91\u95ea\u4ed8)(\u4e91\u95ea\u4ed8APP)'&&norm(d.description)==='\u8f6c\u8d26\u652f\u53d6 \u94f6\u8054\u8f6c\u8d26(\u4e91\u95ea\u4ed8)(\u4e91\u95ea\u4ed8APP)'&&c.provider==='cmb'&&receiving.provider==='\u62db\u5546\u94f6\u884c'&&norm(c.description)==='\u94f6\u8054\u8f6c\u8d26\u8fd8\u6b3e')return 'verified_source_owner_and_matching_unionpay_transfer';
 if(/^(?:\u4e2d\u56fd\u90ae\u653f\u50a8\u84c4\u94f6\u884c|\u90ae\u50a8\u94f6\u884c)$/.test(source.provider)&&d.occurredAt.startsWith(d.date+'T')&&d.occurredAt.endsWith('+08:00')&&d.provider==='psbc'&&d.statementFlow.schema==='psbc-debit-v1'&&d.statementFlow.incomeMinor==='0'&&d.statementFlow.expenseMinor===d.amountMinor&&d.description==='\u94f6\u8054\u5feb\u6377'&&d.counterparty===''&&d.rawFields?.['\u6458\u8981']===d.description&&d.rawFields?.['\u4ea4\u6613\u6e20\u9053']==='\u94f6\u8054\u524d\u7f6e'&&d.rawFields?.['\u4ea4\u6613\u65f6\u95f4']===d.date+d.occurredAt.slice(11,19)&&d.rawFields?.['\u5bf9\u65b9\u6237\u540d']===''&&d.rawFields?.['\u5bf9\u65b9\u8d26\u53f7']===''&&c.provider==='cib'&&receiving.provider==='\u5174\u4e1a\u94f6\u884c'&&c.description==='\u94f6\u8054\u591a\u6e20\u9053\u8fd8\u6b3e(\u4e2d\u56fd\u94f6\u8054\u80a1\u4efd\u6709')return 'matching_original_unionpay_channels';
 return null;
}
function findStatementRepayments(observations,accounts,{rootOf=id=>id,isBlocked=()=>false,annotatedIds=new Set(),statementOwners=new Map(),links=[]}={}){
 const byAccount=new Map(accounts.map(a=>[a.id,a])),debits=new Map(),money=new Map(),matches=new Map(),reverse=new Map(),evidence=new Map(),key=o=>JSON.stringify([o.date,o.amountMinor,o.currency]);
 const byId=new Map(observations.map(o=>[o.id,o])),activeKeys=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),newEnvelopeVetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|'))),newEnvelopeBlocked=(a,b)=>{const ids=new Set([rootOf(a.id),rootOf(b.id)]);return newEnvelopeVetoes.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>byId.has(id)&&ids.has(rootOf(id))):l.observationIds.every(id=>byId.has(id)&&ids.has(rootOf(id))));};
 const actualBankReceiptRoots=new Map();for(const c of observations){if(c.statementFlow&&c.status==='completed'&&c.direction==='credit'&&['bank','debit_card','savings'].includes(byAccount.get(c.financialAccountId)?.type)){const r=rootOf(c.id);if(!actualBankReceiptRoots.has(r))actualBankReceiptRoots.set(r,new Set());actualBankReceiptRoots.get(r).add(c.financialAccountId);}}
 for(const d of observations){if([...actualBankReceiptRoots.get(rootOf(d.id))||[]].some(id=>id!==d.financialAccountId))continue;if(!d.statementFlow||d.direction!=='debit'||d.status!=='completed'||!['unknown','transfer','debt_payment'].includes(d.kind)||annotatedIds.has(d.id)||!['bank','debit_card','savings'].includes(byAccount.get(d.financialAccountId)?.type))continue;const tail=String(byAccount.get(d.financialAccountId)?.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1];if(!tail)continue;const k=JSON.stringify([d.date,d.amountMinor,d.currency,tail]);if(!debits.has(k))debits.set(k,[]);debits.get(k).push(d);if(!money.has(key(d)))money.set(key(d),[]);money.get(key(d)).push(d);}
 const issuers=d=>{const text=[d.description,d.counterparty].join(' ').normalize('NFKC').replace(/\s/g,'');if(!/\u4fe1\u7528\u5361(?:\u8fd8\u6b3e|\u4e2d\u5fc3)/.test(text))return [];return [...new Set(accounts.filter(a=>a.type==='credit_card'&&a.provider&&(text.includes(a.provider)||text.includes(a.provider.replace(/\u94f6\u884c$/,'')+'\u4fe1\u7528\u5361'))).map(a=>a.provider))];};
 for(const c of observations){
  if(!c.bankStatement||c.bankStatement.nonCash||c.direction!=='credit'||c.kind!=='debt_payment'||c.status!=='completed'||byAccount.get(c.financialAccountId)?.type!=='credit_card'||annotatedIds.has(c.id))continue;
  const tail=payerCardTail(c),posted=c.bankStatement.postedDate,dates=[...new Set([c.date,...(posted&&Date.parse(posted)-Date.parse(c.date)===86400000?[posted]:[])])],candidates=dates.flatMap(date=>tail?(debits.get(JSON.stringify([date,c.amountMinor,c.currency,tail]))||[]):(money.get(key({...c,date}))||[]));
  for(const d of candidates){
   // Webank names the receiving institution in counterBank. A proven transfer
   // to another savings account must not compete with a later card repayment.
   const webankDestination=d.provider==='webank'&&d.statementFlow?.schema==='webank-debit-v1'&&d.rawFields?.counterBank?statementCounterAccount({...d,rawFields:{...d.rawFields,'\u5bf9\u65b9\u5f00\u6237\u884c':d.rawFields.counterBank}},accounts):null;
   const destination=byAccount.get(d.automaticRepaymentTarget?.financialAccountId)||statementCounterAccount(d,accounts)||webankDestination||(d.automaticClassification?.method==='explicit_owned_counter_account'?byAccount.get(d.automaticClassification.financialAccountId):null);
   if(destination&&destination.id!==c.financialAccountId)continue;const named=issuers(d),receiving=byAccount.get(c.financialAccountId);if(named.length&&(!named.includes(receiving.provider)||named.length!==1))continue;
   if(explicitCounterConflict(d,receiving))continue;
   const norm=v=>String(v||'').normalize('NFKC').trim(),owner=statementOwners.get(d.id),verifiedOwner=!!owner&&d.provider==='huaxia'&&d.statementFlow.schema==='huaxia-debit-v1'&&norm(d.description)==='\u94f6\u8054'&&norm(d.counterparty)==='\u94f6\u8054\u8f6c\u8d26(\u4e91\u95ea\u4ed8)'&&norm(d.rawFields?.['\u5bf9\u65b9\u59d3\u540d'])===norm(d.counterparty)&&d.rawFields?.['\u8bb0\u8d26\u65e5\u671f']===d.date&&c.provider==='cgb'&&c.rawFields?.statementCredit===true&&norm(c.description)==='(\u8fd8\u6b3e)(\u4e91\u95ea\u4ed8)\u94f6\u8054\u5165\u8d26-'+owner;
   const matchedUnionpay=!!owner&&d.provider==='huaxia'&&d.statementFlow.schema==='huaxia-debit-v1'&&norm(d.description)==='\u94f6\u8054'&&norm(d.counterparty)==='\u94f6\u8054\u8f6c\u8d26(\u4e91\u95ea\u4ed8)'&&norm(d.rawFields?.['\u5bf9\u65b9\u59d3\u540d'])===norm(d.counterparty)&&d.rawFields?.['\u8bb0\u8d26\u65e5\u671f']===d.date&&c.provider==='cmb'&&receiving.provider==='\u62db\u5546\u94f6\u884c'&&norm(c.description)==='\u94f6\u8054\u8f6c\u8d26\u8fd8\u6b3e'&&c.rawFields?.statementCredit===true&&c.rawFields?.statementAmountMinor==='-'+c.amountMinor&&c.rawFields?.dateBasis==='transaction_date'&&c.rawFields?.tradeDate===c.date&&d.date===c.date;
   const originalUnionpay=originalUnionpayRepaymentEnvelope(d,c,byAccount.get(d.financialAccountId),receiving,owner);if(originalUnionpay&&newEnvelopeBlocked(d,c))continue;
   const qualified=!!tail||destination?.id===c.financialAccountId||named.length===1&&named[0]===receiving.provider||verifiedOwner||matchedUnionpay||!!originalUnionpay;
   const cr=rootOf(c.id),dr=rootOf(d.id);if(cr===dr||isBlocked(c.id,d.id))continue;
   if(!matches.has(cr))matches.set(cr,new Set());if(!reverse.has(dr))reverse.set(dr,new Set());matches.get(cr).add(dr);reverse.get(dr).add(cr);evidence.set(JSON.stringify([cr,dr]),{credit:c,debit:d,qualified,evidenceBasis:tail?'explicit_payer_card':verifiedOwner?'verified_owner_and_unionpay_channel':matchedUnionpay?'verified_source_owner_and_matching_unionpay_transfer':originalUnionpay||'named_receiving_institution',...(verifiedOwner||matchedUnionpay||originalUnionpay&&owner?{ownerEvidenceObservationIds:[d.id]}:{}),dateBasis:d.date===c.date?'original_trade_date':'original_credit_posted_date'});
  }
 }
 const result=[];for(const [cr,ds] of matches)if(ds.size===1){const dr=[...ds][0],m=evidence.get(JSON.stringify([cr,dr]));if(reverse.get(dr).size===1&&m.qualified)result.push(m);}return result;
}

function statementCreditRepaymentTarget(o,accounts){
 if(o.provider!=='spdb'||o.statementFlow?.schema!=='spdb-debit-v1'||o.rawFields?.dateBasis!=='transaction_date'||o.rawFields?.['交易名称']!==o.description||o.status!=='completed'||o.kind!=='debt_payment'||o.direction!=='debit')return null;
 const tail=o.description.match(/^信用卡还款(\d{4})$/)?.[1];if(!tail)return null;
 const targets=accounts.filter(a=>a.status==='active'&&a.type==='credit_card'&&a.provider==='浦发银行'&&a.currency===o.currency&&a.maskedIdentifier===tail);return targets.length===1?{financialAccountId:targets[0].id,method:'explicit_statement_credit_repayment_target',confidence:'explicit_statement_card',cardTail:tail,evidenceObservationIds:[o.id]}:null;
}
function explicitOwnedCreditRepaymentTarget(o,accounts,{statementOwner}={}){
 if(!statementOwner||o.provider!=='huaxia'||o.statementFlow?.schema!=='huaxia-debit-v1'||o.status!=='completed'||o.direction!=='debit'||!['unknown','transfer','debt_payment'].includes(o.kind)||BigInt(o.amountMinor)<=0n||o.description.trim()!=='\u94f6\u8054'||o.counterparty!==statementOwner||o.rawFields?.['\u5bf9\u65b9\u59d3\u540d']!==statementOwner||o.rawFields?.['\u6458\u8981']!=='\u94f6\u8054'||o.rawFields?.['\u8bb0\u8d26\u65e5\u671f']!==o.date||!/^\*{4,}\d{4}$/.test(o.rawFields?.['\u5bf9\u65b9\u5361/\u8d26\u53f7']||''))return null;
 const source=accounts.find(a=>a.id===o.financialAccountId),target=statementCounterAccount(o,accounts);
 if(source?.status!=='active'||source.type!=='debit_card'||source.currency!==o.currency||target?.status!=='active'||target.type!=='credit_card'||target.currency!==o.currency||o.automaticClassification?.financialAccountId&&o.automaticClassification.financialAccountId!==target.id)return null;
 return {financialAccountId:target.id,method:'explicit_statement_credit_repayment_target',confidence:'verified_source_owner_and_statement_card',cardTail:target.maskedIdentifier,evidenceObservationIds:[o.id],identityBasis:'original_full_owner_named_institution_and_card_tail'};
}
module.exports={payerCardTail,findStatementRepayments,findOwnedBankTransfers,statementCreditRepaymentTarget,explicitOwnedCreditRepaymentTarget,explicitCounterConflict};
