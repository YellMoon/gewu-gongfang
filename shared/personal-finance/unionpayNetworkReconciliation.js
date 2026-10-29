'use strict';
const {validateBankNetwork}=require('./unionpayNetworkStatement');
const normal=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/^(?:\(?(?:\u6d88\u8d39|\u9000\u6b3e|\u9000\u8d27)\)?[-:]?)/,'');
const key=(account,date,delta)=>JSON.stringify([account,date,String(delta)]);
const printedMinor=value=>{const m=String(value??'').trim().match(/^(-?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/);return m?String((BigInt(m[2].replace(/,/g,''))*100n+BigInt(m[3]))*(m[1]?-1n:1n)):null;};
const printedCardTail=value=>String(value||'').match(/^(?:\*+|\d+)?(\d{4})$/)?.[1];
const channels=value=>new Set([/\u4e91\u95ea\u4ed8|\u94f6\u8054/.test(value)&&'unionpay',/\u8d22\u4ed8\u901a|\u5fae\u4fe1/.test(value)&&'wechat',/\u652f\u4ed8\u5b9d/.test(value)&&'alipay'].filter(Boolean));
function nativeBankLeg(record,source,accountId){
 if(source.financialAccountId!==accountId||source.status!=='completed'||source.currency!==record.currency||source.date!==record.date||source.direction!==record.direction||source.amountMinor!==record.amountMinor)return false;
 if(source.bankStatement)return ['bank-credit-v1','bank-credit-detail-v1','minsheng-credit-v1'].includes(source.bankStatement.schema)&&source.bankStatement.cardTail===record.bankNetwork.cardTail;
 const f=source.statementFlow;return Boolean(f)&&['huaxia-debit-v1','ccb-debit-v1','hangzhou-debit-v1','jsb-debit-v1','psbc-debit-v1','spdb-debit-v1','mybank-current-v1'].includes(f.schema)&&(source.direction==='debit'?f.expenseMinor===source.amountMinor&&f.incomeMinor==='0':f.incomeMinor===source.amountMinor&&f.expenseMinor==='0');
}
function nativeMerchantNames(record){
 const names=new Set([normal(record.description)]),parts=record.description.normalize('NFKC').split('_'),tail=parts.at(-1);
 if(parts.length===2&&/^(?:\(\u7279\u7ea6\).+|.+\u5e73\u53f0\u5546\u6237|\u8d22\u4ed8\u901a\(\u94f6\u8054\u4e91\u95ea\u4ed8\))$/.test(tail)){names.add(normal(parts[0]));names.add(normal(tail));if(/\u5e73\u53f0\u5546\u6237$/.test(tail))names.add(normal(tail+parts[0]));}
 return names;
}
function bankMerchantNames(record,source,accountId,nameEvidence=[]){
 const names=[source.description,source.counterparty].map(normal);
 if(!nativeBankLeg(record,source,accountId))return names;
 if(source.provider==='ccb'&&record.bankNetwork.bank==='\u5efa\u8bbe\u94f6\u884c'&&source.statementFlow?.schema==='ccb-debit-v1'&&source.direction==='debit'){
  const raw=source.rawFields||{},operation='\u8de8\u884cPOS\u6d88\u8d39',remark=raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00'];
  if(raw.dateBasis==='transaction_date'&&raw['\u6458\u8981']===operation&&raw['\u4ea4\u6613\u65e5\u671f']===record.date.replace(/-/g,'')&&printedMinor(raw['\u4ea4\u6613\u91d1\u989d'])===String(-BigInt(source.amountMinor))&&typeof remark==='string'&&source.description.normalize('NFKC').trim()===operation+' '+remark.normalize('NFKC').trim())names.push(normal(remark));
 }
 if(!source.bankStatement)return names;
 const raw=source.rawFields||{},printed=source.description.normalize('NFKC').trim(),amount=String(BigInt(source.amountMinor)*(source.direction==='credit'?-1n:1n));
 if(raw.cardTail!==record.bankNetwork.cardTail||raw.dateBasis!=='transaction_date'||raw.tradeDate!==record.date||raw.statementAmountMinor!==amount||raw.statementCredit!==(source.direction==='credit'))return names;
 const completeLegalSuffix=(merchant,suffix)=>{const original=normal(merchant),completed=original+suffix;if(source.direction!=='debit'||source.kind!=='expense'||source.bankStatement.nonCash!==false||!/^\p{Script=Han}{12}$/u.test(original))return;names.push(completed);if(completed===normal(record.description))nameEvidence.push({method:'bounded_literal_legal_suffix_completion',nativeObservationId:record.id||record.bankNetwork.recordId,bankObservationId:source.id,originalBankMerchant:merchant,nativeMerchant:record.description,inferredMissingSuffix:suffix,printedBankHanCharacterCount:12,originalBankTextPreserved:true,confidence:'inferred',edgeIsCompatibilityOnly:true});};
 if(source.provider==='ccb'&&record.bankNetwork.bank==='\u5efa\u8bbe\u94f6\u884c'){
  const operation=source.direction==='debit'?/^(?:[\u4e00-\u9fff]{2,6}\s+)?\u8de8\u884c\u6d88\u8d39\s+(.+)$/:source.direction==='credit'&&source.kind==='refund'?/^(?:[\u4e00-\u9fff]{2,6}\s+)?\u8de8\u884c\u9000\u8d27\s+(.+)$/:null,m=operation&&printed.match(operation);if(m){names.push(normal(m[1]));if(/^.+\u6709\u9650\u516c\u53f8[\u4e00-\u9fff]{2}$/.test(normal(m[1])))completeLegalSuffix(m[1],'\u5206\u516c\u53f8');}
 }
 if(source.provider==='cmb'&&record.bankNetwork.bank==='\u62db\u5546\u94f6\u884c'){
  const m=printed.match(/^(.+?)-Huawei Pay:\d{4}$/i);if(m){names.push(normal(m[1]));if(/\u6709\u9650\u516c$/.test(normal(m[1])))completeLegalSuffix(m[1],'\u53f8');}
 }
 if(source.provider==='cgb'&&record.bankNetwork.bank==='\u5e7f\u53d1\u94f6\u884c'&&source.direction==='debit'){
  const text=normal(printed);if(/^[^()]+\([^()]+$/.test(text))names.push(text+')');
 }
 if(source.provider==='cib'&&record.bankNetwork.bank==='\u5174\u4e1a\u94f6\u884c'&&source.direction==='credit'&&source.kind==='refund'){
  const m=printed.match(/^(.+?)(\d{4})(\d{2})(\d{2})$/);if(m){const date=m[2]+'-'+m[3]+'-'+m[4],time=Date.parse(date);if(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date&&date<=record.date)names.push(normal(m[1]));}
 }
 return names;
}
function compatibleUtilityPayment(record,t){
 if(record.kind!=='unknown'||record.direction!=='debit'||record.bankNetwork.nativeStatus!=='settled'||t.kind!=='expense')return false;
 const title=normal(record.description).replace(/^\(\u7279\u7ea6\)/,''),patterns=new Map([
  ['\u6c34\u8d39\u7f34\u7eb3',/^\u6c34\u8d39(?:-|\u81ea\u52a8\u7f34\u8d39-)/],['\u516c\u5171\u4e8b\u4e1a\u7f34\u8d39(\u6c34\u8d39)',/^\u6c34\u8d39(?:-|\u81ea\u52a8\u7f34\u8d39-)/],
  ['\u7535\u8d39\u7f34\u7eb3',/^\u7535\u8d39-/],['\u71c3\u6c14\u8d39\u7f34\u7eb3',/^\u71c3\u6c14\u8d39-/]
 ]),tax=title==='\u529e\u7a0e\u670d\u52a1\u5385',purpose=tax?/^\u793e\u4fdd\u7f34\u8d39$/:patterns.get(title);if(!purpose)return false;
 return t.sources.some(s=>{
  const raw=s.rawFields||{},method=String(s.paymentChannel||'').normalize('NFKC'),bank=normal(record.bankNetwork.bank),tail=record.bankNetwork.cardTail;
  return s.provider==='alipay'&&s.status==='completed'&&s.currency===record.currency&&s.direction==='debit'&&s.date===record.date&&s.amountMinor===record.amountMinor&&purpose.test(s.description)&&raw['\u5546\u54c1\u8bf4\u660e']===s.description&&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===s.sourceTransactionId&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u4ea4\u6613\u5206\u7c7b']===(tax?'\u516c\u5171\u670d\u52a1':'\u5145\u503c\u7f34\u8d39')&&(!tax||raw['\u4ea4\u6613\u5bf9\u65b9']===s.counterparty&&/^\u56fd\u5bb6\u7a0e\u52a1\u603b\u5c40.+\u7a0e\u52a1\u5c40$/.test(s.counterparty))&&printedMinor(raw['\u91d1\u989d'])===s.amountMinor&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===s.paymentChannel&&method.split('&').some(p=>{const part=normal(p),card=part.match(/\((\d{4})\)$/);return part.includes(bank)&&card?.[1]===tail;});
 });
}
function compatibleYulibaoRedemption(record,t,accountId){
 if(record.direction!=='credit'||record.kind!=='unknown'||record.bankNetwork.nativeStatus!=='settled'||t.kind!=='transfer'||!/^\(\u7279\u7ea6\)\u7f51\u5546\u94f6\u884c(?:T1)?\(\u8d44\u91d1\u7ed3\u7b97\)$/.test(normal(record.description))||t.balanceEffects[accountId]!==record.amountMinor||Object.keys(t.balanceEffects).length!==2)return false;
 return t.sources.some(s=>{
  const f=s.statementFlow,r=s.rawFields||{},amount=record.amountMinor;
  return s.provider==='mybank'&&s.status==='completed'&&s.currency===record.currency&&s.date===record.date&&s.direction==='debit'&&s.amountMinor===amount&&s.financialAccountId!==accountId&&t.balanceEffects[s.financialAccountId]===String(-BigInt(amount))&&f?.schema==='mybank-yulibao-v1'&&f.incomeMinor==='0'&&f.expenseMinor===amount&&r['\u4ea4\u6613\u7c7b\u578b']==='\u6b63\u5e38\u8d4e\u56de'&&printedMinor(r['\u4ea4\u6613\u91d1\u989d'])===String(-BigInt(amount))&&printedCardTail(r['\u5bf9\u65b9\u8d26\u53f7'])===record.bankNetwork.cardTail&&r['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']===record.bankNetwork.bank&&String(r['\u4ea4\u6613\u65f6\u95f4']||'').slice(0,10)===record.date;
 });
}
// A contradictory candidate is removed only when both original banks prove
// a debit-card-to-debit-card transfer. A merchant-name mismatch is not proof.
function provenCashTransferNotRepayment(record,t,account,accounts){
 if(record.kind!=='debt_payment'||record.direction!=='debit'||record.bankNetwork.nativeStatus!=='settled'||account.type!=='debit_card'||account.provider!=='\u534e\u590f\u94f6\u884c'||t.kind!=='transfer'||t.currency!==record.currency||t.sources.length!==2||Object.keys(t.balanceEffects).length!==2||t.balanceEffects[account.id]!==String(-BigInt(record.amountMinor)))return null;
 const recipient=accounts.find(a=>a.id!==account.id&&a.status==='active'&&a.type==='debit_card'&&a.provider==='\u5efa\u8bbe\u94f6\u884c'&&a.currency===record.currency&&t.balanceEffects[a.id]===record.amountMinor);if(!recipient)return null;
 const payer=t.sources.find(s=>s.financialAccountId===account.id),receiver=t.sources.find(s=>s.financialAccountId===recipient.id);if(!payer||!receiver||!nativeBankLeg(record,payer,account.id))return null;
 const p=payer.rawFields||{},r=receiver.rawFields||{},tail=printedCardTail,amount=record.amountMinor;
 if(payer.provider!=='huaxia'||payer.statementFlow?.schema!=='huaxia-debit-v1'||p['\u6458\u8981']!=='\u624b\u673a\u94f6\u884c\u8f6c\u8d26'||p['\u8bb0\u8d26\u65e5\u671f']!==record.date||p['\u5bf9\u65b9\u5f00\u6237\u884c']!=='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u603b\u884c'||tail(p['\u5bf9\u65b9\u5361/\u8d26\u53f7'])!==recipient.maskedIdentifier)return null;
 const rawAmount=String(p['\u4ea4\u6613\u91d1\u989d']||'');if(!/^-\d+(?:\.\d{1,2})?$/.test(rawAmount)||printedMinor(rawAmount.includes('.')?rawAmount.padEnd(rawAmount.indexOf('.')+3,'0'):rawAmount+'.00')!==String(-BigInt(amount)))return null;
 const f=receiver.statementFlow;if(receiver.provider!=='ccb'||receiver.status!=='completed'||receiver.direction!=='credit'||receiver.currency!==record.currency||receiver.date!==record.date||receiver.amountMinor!==amount||f?.schema!=='ccb-debit-v1'||f.incomeMinor!==amount||f.expenseMinor!=='0'||r.dateBasis!=='transaction_date'||r['\u4ea4\u6613\u65e5\u671f']!==record.date.replace(/-/g,'')||r['\u6458\u8981']!=='\u7535\u5b50\u6c47\u5165'||printedMinor(r['\u4ea4\u6613\u91d1\u989d'])!==amount||tail(r['\u5bf9\u65b9\u8d26\u53f7'])!==account.maskedIdentifier)return null;
 return {transactionId:t.id,reason:'two_original_banks_prove_debit_to_debit_transfer_not_credit_repayment',payerObservationId:payer.id,recipientObservationId:receiver.id,payerAccountId:account.id,recipientAccountId:recipient.id,payerAccountType:account.type,recipientAccountType:recipient.type,originalFinancialTransactionPreserved:true};
}
function provenTrafficFineNotTelecom(record,t,account){
 if(record.kind!=='unknown'||record.direction!=='debit'||record.bankNetwork.nativeStatus!=='settled'||account.type!=='credit_card'||account.provider!=='\u5efa\u8bbe\u94f6\u884c'||!/^.+\(\u7535\u4fe1\u5145\u503c\)$/.test(normal(record.description))||t.kind!=='expense'||t.currency!==record.currency)return null;
 const fine=t.sources.find(s=>{const raw=s.rawFields||{},method=normal(s.paymentChannel);return s.provider==='alipay'&&s.status==='completed'&&s.direction==='debit'&&s.currency===record.currency&&s.date===record.date&&s.amountMinor===record.amountMinor&&/^\u6267\u6536\u5355\u4f4d\uff1a.+\u516c\u5b89\u5c40\u4ea4\u901a\u8b66\u5bdf\u652f\u961f\uff0c\u7f34\u6b3e\u5355\u53f7\uff1a.+$/.test(s.description)&&/^.+\u8d22\u653f\u5c40$/.test(s.counterparty)&&raw['\u5546\u54c1\u8bf4\u660e']===s.description&&raw['\u4ea4\u6613\u5bf9\u65b9']===s.counterparty&&raw['\u4ea4\u6613\u5206\u7c7b']==='\u516c\u5171\u670d\u52a1'&&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&s.sourceTransactionId&&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===s.sourceTransactionId&&printedMinor(raw['\u91d1\u989d'])===s.amountMinor&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===s.paymentChannel&&method.match(/\((\d{4})\)$/)?.[1]===record.bankNetwork.cardTail&&method.includes(normal(record.bankNetwork.bank));});if(!fine)return null;
 const bank=t.sources.find(s=>{const raw=s.rawFields||{};return s.provider==='ccb'&&s.kind==='expense'&&nativeBankLeg(record,s,account.id)&&s.bankStatement?.nonCash===false&&raw.cardTail===record.bankNetwork.cardTail&&raw.dateBasis==='transaction_date'&&raw.tradeDate===record.date&&raw.statementCredit===false&&raw.statementAmountMinor===record.amountMinor&&normal(s.description)===normal('\u652f\u4ed8\u5b9d-'+fine.counterparty);});if(!bank)return null;
 return {transactionId:t.id,reason:'original_traffic_police_fine_and_fiscal_bank_payee_are_not_explicit_telecom_recharge',platformObservationId:fine.id,bankObservationId:bank.id,originalPurpose:fine.description,originalCounterparty:fine.counterparty,originalFinancialTransactionPreserved:true};
}
function genericProcessorRepayment(record,t,accountId){
 if(record.kind!=='unknown'||t.kind!=='debt_payment'||record.bankNetwork.nativeStatus!=='settled'||!new Set(['\u652f\u4ed8\u5b9d(\u4e2d\u56fd)\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8','\u652f\u4ed8\u5b9d\u652f\u4ed8\u79d1\u6280\u6709\u9650\u516c\u53f8','\u94f6\u8054\u8f6c\u8d26(\u4e91\u95ea\u4ed8)']).has(normal(record.description)))return false;
 return t.sources.some(s=>nativeBankLeg(record,s,accountId)&&(s.kind==='debt_payment'||s.bankStatement&&/\u4fe1\u7528\u5361\u8fd8\u6b3e|\u8f6c\u8d26\u8fd8\u6b3e|\u94f6\u8054\u5165\u8d26/.test(s.description)||s.statementFlow&&channels([s.description,s.counterparty].join(' ')).has('unionpay')));
}
function compatible(record,t,accountId){
 if(t.currency!==record.currency)return false;
 if(record.kind==='debt_payment'&&t.kind!=='debt_payment'||record.kind==='refund'&&t.kind!=='refund'||record.kind!=='debt_payment'&&t.kind==='debt_payment'&&!genericProcessorRepayment(record,t,accountId))return false;
 if(record.kind==='debt_payment')return true;
 if(genericProcessorRepayment(record,t,accountId))return true;
 if(compatibleUtilityPayment(record,t))return true;
 if(compatibleYulibaoRedemption(record,t,accountId))return true;
 const names=nativeMerchantNames(record),networkChannels=channels(record.description);
 return t.sources.some(s=>{
  if(s.status!=='completed'||s.bankNetwork)return false;
  if(bankMerchantNames(record,s,accountId).some(name=>names.has(name)))return true;
  const sourceChannels=channels([s.description,s.counterparty,s.paymentChannel,...Object.values(s.rawFields||{}).filter(v=>typeof v==='string')].join(' '));
  if([...networkChannels].some(c=>sourceChannels.has(c)))return true;
  if(networkChannels.has(s.provider))return true;
  // A bank-issued source explicitly names the same network clearing channel.
  return s.financialAccountId===accountId&&Boolean(s.bankStatement||s.statementFlow)&&sourceChannels.has('unionpay');
 });
}
function latestVersionNotSettled(t){
 const latest=new Map();for(const s of t.sources){if(!s.sourceIdentity)continue;const k=JSON.stringify([s.financialAccountId,s.provider,s.sourceIdentity]),p=latest.get(k);if(!p||(s.sourceVersionOrdinal||1)>(p.sourceVersionOrdinal||1))latest.set(k,s);}
 return [...latest.values()].some(s=>s.status!=='completed');
}
function printedTradeDates(t,accountId,delta){
 return [...new Set(t.sources.filter(s=>s.status==='completed'&&s.financialAccountId===accountId&&Boolean(s.bankStatement||s.statementFlow)&&['credit','debit'].includes(s.direction)&&typeof s.amountMinor==='string'&&/^(0|[1-9]\d*)$/.test(s.amountMinor)&&/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')&&BigInt(s.amountMinor)*(s.direction==='credit'?1n:-1n)===delta).map(s=>s.date))];
}
function cmbRefundPostingRows(t,accountId,delta){
 if(t.kind!=='refund'||delta<=0n)return [];
 return t.sources.filter(s=>{const e=s.bankStatement,r=s.rawFields||{},valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;return s.provider==='cmb'&&s.financialAccountId===accountId&&s.status==='completed'&&s.kind==='refund'&&s.direction==='credit'&&s.currency===t.currency&&s.amountMinor===String(delta)&&e?.schema==='bank-credit-v1'&&!e.nonCash&&e.cardTail===r.cardTail&&r.dateBasis==='transaction_date'&&r.tradeDate===s.date&&r.statementCredit===true&&r.statementAmountMinor===String(-delta)&&r.postedDate===e.postedDate&&valid(e.postedDate)&&valid(s.date)&&s.date<=e.postedDate&&e.postedDate<=e.statementDate&&/^\u4e91\u95ea\u4ed8\u626b\u7801-/.test(s.description);});
}
function cmbRefundDateEvidence(record,t,accountId){
 if(record.kind!=='refund'||record.direction!=='credit'||record.bankNetwork.nativeStatus!=='refund'||record.bankNetwork.bank!=='\u62db\u5546\u94f6\u884c')return null;
 const rows=cmbRefundPostingRows(t,accountId,BigInt(record.amountMinor)).filter(s=>s.bankStatement.cardTail===record.bankNetwork.cardTail&&normal(s.description).replace(/^\u4e91\u95ea\u4ed8\u626b\u7801-/,'')===normal(record.description)&&[0,86400000].includes(Date.parse(s.bankStatement.postedDate)-Date.parse(record.date)));
 if(rows.length!==1)return null;const s=rows[0];return{method:'explicit_cmb_refund_posting_date_with_native_visible_day',bankObservationId:s.id,nativeObservationId:record.id||record.bankNetwork.recordId,nativeVisibleDate:record.date,originalBankTradeDate:s.date,bankPostingDate:s.bankStatement.postedDate,bankPostingDaysAfterNative:Math.round((Date.parse(s.bankStatement.postedDate)-Date.parse(record.date))/86400000),confidence:'inferred_date_difference',bankPostingDatePreserved:true,originalBankTradeDatePreserved:true,timeUsedForMatching:false};
}
function planUnionpayNetworkEvidence({records,accounts,transactions,annotations=[],links=[]}){
 const byKey=new Map(),primaryKeys=new Set(),rowsByKey=new Map(),held=[],nonCash=[],identities=[];
 links=links.filter(l=>!(['distinct','group_distinct'].includes(l.type)&&(l.status==='deleted'||l.deletedAt||l.deleted===true)));
 const nativeIds=new Set(records.map(r=>r.id||r.bankNetwork.recordId));
 const latest=new Map();for(const a of annotations){const p=latest.get(a.observationId);if(!p||BigInt(a.revision)>BigInt(p.revision))latest.set(a.observationId,a);}
 const blockedNetwork=new Set([...latest.values()].filter(a=>a.reset!==true).map(a=>a.observationId));
 const blockedExisting=new Set(links.filter(l=>(['distinct','group_distinct'].includes(l.type)||l.deletedAt||l.deleted===true)&&!(l.observationIds||[]).some(id=>nativeIds.has(id))).flatMap(l=>l.observationIds||[]));
 const unsafeExisting=t=>latestVersionNotSettled(t)||t.observationIds.some(id=>blockedExisting.has(id));
 const ownerMatches=require('./ownerNativeCashEvidence').findOwnerNativeCashEvidence(records,accounts,transactions,{annotations,links,bankLeg:nativeBankLeg}),ownerNativeIds=new Set(ownerMatches.flatMap(m=>m.networkObservationIds));
 for(const t of transactions){
  if(t.status!=='completed')continue;
  // A credit-card incoming entry reduces debt. It is an account balance leg,
  // even though it is deliberately absent from cash-account inflow statistics.
  for(const [accountId,total] of Object.entries(t.balanceEffects)){
   const dayDeltas=new Map();
   if(t.balanceEffectEvents?.[accountId])for(const event of t.balanceEffectEvents[accountId]){const date=event.date||event.occurredAt.slice(0,10);dayDeltas.set(date,(dayDeltas.get(date)||0n)+BigInt(event.deltaMinor));}
   else {
    // The native list describes the transaction date; a bank may post the
    // balance leg the next day. Use a printed native trade date only when that
    // exact account, signed amount and original bank row support it. Never
    // rewrite the independent posting date or take a broad +/- one-day match.
    const delta=BigInt(total),dates=printedTradeDates(t,accountId,delta);
    if(dates.length)for(const date of dates)dayDeltas.set(date,delta);
    else dayDeltas.set((t.balanceEffectTimes?.[accountId]||t.occurredAt||t.date).slice(0,10),delta);
   }
   for(const [date,delta] of dayDeltas){if(!delta)continue;const k=key(accountId,date,delta);if(!byKey.has(k))byKey.set(k,[]);if(!byKey.get(k).some(x=>x.id===t.id))byKey.get(k).push(t);primaryKeys.add(JSON.stringify([k,t.id]));}
   const delta=BigInt(total);for(const s of cmbRefundPostingRows(t,accountId,delta))for(const date of [s.bankStatement.postedDate,new Date(Date.parse(s.bankStatement.postedDate)-86400000).toISOString().slice(0,10)]){const k=key(accountId,date,delta);if(!byKey.has(k))byKey.set(k,[]);if(!byKey.get(k).some(x=>x.id===t.id))byKey.get(k).push(t);}
  }
 }
 const seen=new Set();
 for(const record of records){
  const e=record.bankNetwork;validateBankNetwork(e,record);
  const id=record.id||e.recordId;
  if(seen.has(id))throw new Error('Duplicate network evidence identity');seen.add(id);
  if(ownerNativeIds.has(id))continue;
  if(e.nativeStatus==='frozen'){nonCash.push({captureRecordId:e.recordId,observationId:id,amountMinor:record.amountMinor,reason:'native_frozen_authorization',noCash:true});continue;}
  if(blockedNetwork.has(id)||links.some(l=>(l.observationIds||[]).includes(id))){held.push({captureRecordId:e.recordId,observationId:id,reason:'existing_owner_decision_or_link',candidateTransactionIds:[]});continue;}
  const mapped=record.financialAccountId&&record.bankAccount?accounts.find(a=>a.id===record.financialAccountId&&['active','archived'].includes(a.status)&&a.type===record.bankAccount.type&&a.provider===e.bank&&a.maskedIdentifier===e.cardTail&&a.currency===record.currency):null;
  const matches=mapped?[mapped]:accounts.filter(a=>a.status==='active'&&['credit_card','debit_card'].includes(a.type)&&a.provider===e.bank&&a.maskedIdentifier===e.cardTail&&a.currency===record.currency);
  if(matches.length!==1){identities.push({captureRecordId:e.recordId,observationId:id,bank:e.bank,tail:e.cardTail,reason:matches.length?'account_identity_ambiguous':'account_identity_missing'});continue;}
  const account=matches[0],delta=BigInt(record.amountMinor)*(record.direction==='credit'?1n:-1n),k=key(account.id,record.date,delta);
  if(!rowsByKey.has(k))rowsByKey.set(k,[]);rowsByKey.get(k).push({record,id,account,delta});
 }
 const matches=[...ownerMatches];
 for(const [k,rows] of rowsByKey){
  const allCandidates=byKey.get(k)||[],excludedCandidateEvidence=[];
  let candidates=allCandidates.filter(t=>{
   const evidence=rows.length===1&&!unsafeExisting(t)&&(provenCashTransferNotRepayment(rows[0].record,t,rows[0].account,accounts)||provenTrafficFineNotTelecom(rows[0].record,t,rows[0].account));
   if(evidence)excludedCandidateEvidence.push(evidence);return !evidence;
  });
  const minute=rows.length===1&&candidates.length>1&&candidates.every(t=>!unsafeExisting(t)&&primaryKeys.has(JSON.stringify([k,t.id])))?require('./nativeCorroboratedMinutes').corroboratedOriginalMinute(rows[0].record,candidates,rows[0].account.id):null;
  if(minute){excludedCandidateEvidence.push(...minute.excludedCandidateEvidence);candidates=candidates.filter(t=>t.id===minute.transactionId);}
  const sameTitle=new Set(rows.map(r=>normal(r.record.description))).size===1;
  const completeCompatible=rows.every(r=>candidates.every(t=>!unsafeExisting(t)&&(primaryKeys.has(JSON.stringify([k,t.id]))?compatible(r.record,t,r.account.id):Boolean(cmbRefundDateEvidence(r.record,t,r.account.id)))));
  const unique=rows.length===1&&candidates.length===1&&completeCompatible;
  // Equal-count proof is a whole group, never a fabricated row-to-row pairing.
  const group=rows.length>1&&candidates.length===rows.length&&sameTitle&&completeCompatible;
  if(unique||group){
   const dates=rows.flatMap(r=>candidates.filter(t=>!primaryKeys.has(JSON.stringify([k,t.id]))).map(t=>cmbRefundDateEvidence(r.record,t,r.account.id))),merchantNameEvidence=[];
   for(const r of rows)for(const t of candidates)for(const s of t.sources)if(!s.bankNetwork)bankMerchantNames(r.record,s,r.account.id,merchantNameEvidence);
   matches.push({method:unique?'unionpay_native_existing_cash_evidence':'unionpay_native_existing_cash_group_evidence',confidence:'inferred',captureRecordIds:rows.map(r=>r.record.bankNetwork.recordId),networkObservationIds:rows.map(r=>r.id),transactionIds:candidates.map(t=>t.id),existingObservationIds:[...new Set(candidates.flatMap(t=>t.observationIds))],financialAccountId:rows[0].account.id,date:rows[0].record.date,deltaMinor:String(rows[0].delta),currency:rows[0].record.currency,networkCount:rows.length,existingEconomicEventCount:candidates.length,individualIdentity:unique?'reciprocal_unique':'undetermined_within_group',dateBasis:[...new Set(rows.map(r=>r.record.bankNetwork.dateBasis))],timeUsedForMatching:false,reversible:true,noNewCash:true,noNewIncomeOrConsumption:true,preservesOwnerClassification:true,...(dates.length?{dateEvidence:dates}:{} ),...(excludedCandidateEvidence.length?{excludedCandidateEvidence}:{} ),...(merchantNameEvidence.length?{merchantNameEvidence}:{} )});
   if(minute){matches.at(-1).timeUsedForMatching=true;matches.at(-1).timeEvidence=[minute.evidence];}
  }else for(const r of rows)held.push({captureRecordId:r.record.bankNetwork.recordId,observationId:r.id,reason:!candidates.length?'no_exact_existing_cash_movement':!completeCompatible?'merchant_channel_or_purpose_not_supported':'cash_movement_cardinality_ambiguous',candidateTransactionIds:candidates.map(t=>t.id),networkPeerCount:rows.length});
 }
 // An original account leg can have a printed trade day and posting day. Both
 // dates remain evidence, never permission to consume the same bank leg twice.
 const uses=new Map();for(const m of matches)for(const id of m.transactionIds){const k=JSON.stringify([m.financialAccountId,id]);uses.set(k,(uses.get(k)||0)+1);}
 const accepted=matches.filter(m=>{if(m.transactionIds.every(id=>uses.get(JSON.stringify([m.financialAccountId,id]))===1))return true;for(let i=0;i<m.networkObservationIds.length;i++)held.push({captureRecordId:m.captureRecordIds[i],observationId:m.networkObservationIds[i],reason:'bank_cash_leg_reused_across_dates',candidateTransactionIds:m.transactionIds,networkPeerCount:m.networkCount});return false;});
 return {matches:accepted,nonCash,identities,held,summary:{sourceRows:records.length,matchedEvidenceRows:accepted.reduce((n,m)=>n+m.networkCount,0),matchedEconomicEvents:accepted.reduce((n,m)=>n+m.existingEconomicEventCount,0),nonCashRows:nonCash.length,identityRows:identities.length,heldRows:held.length},financialMutationPerformed:false};
}
module.exports={planUnionpayNetworkEvidence};
