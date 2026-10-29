'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const FEE_RULE_SOURCE='https://posts.tenpay.com/posts/f21920786968630a00e9079824f26969.html';
// The bank records net receipts; the wallet export includes the charged fee.
// A fee cap is only a candidate constraint, never a fee estimate. Exemptions
// and vouchers make it unsafe to synthesize a missing bank net amount.
function findWechatWithdrawalMatches(observations,accounts,{rootOf=id=>id,isBlocked=()=>false,occupiedBankRoots=new Set(),annotatedIds=new Set()}={}){
 const candidates=new Map(),reverse=new Map(),evidence=new Map();
 const annotatedRoots=new Set(observations.filter(o=>annotatedIds.has(o.id)).map(o=>rootOf(o.id)));
 const latest=new Map();for(const o of observations){const key=JSON.stringify([rootOf(o.id),o.provider,o.financialAccountId]);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const records=[...latest.values()];
 const receiptDays=new Map();for(const b of records)if(b.statementFlow&&b.status==='completed'&&b.direction==='credit'&&['unknown','transfer'].includes(b.kind)){const key=JSON.stringify([b.date,b.currency]);if(!receiptDays.has(key))receiptDays.set(key,[]);receiptDays.get(key).push(b);}
 for(const w of records){
  if(w.provider!=='wechat'||w.status!=='completed'||w.kind!=='transfer'||!['neutral','debit'].includes(w.direction)||w.rawFields?.['\u4ea4\u6613\u7c7b\u578b']!=='\u96f6\u94b1\u63d0\u73b0'||annotatedIds.has(w.id))continue;
  const identity=fundingIdentity(w.paymentChannel),missingIdentity=!identity&&['','/'].includes(String(w.paymentChannel||'').trim())&&w.rawFields?.['\u5f53\u524d\u72b6\u6001']==='\u63d0\u73b0\u5df2\u5230\u8d26';
  const targets=accounts.filter(a=>a.status!=='archived'&&a.id!==w.financialAccountId&&['bank','debit_card','savings'].includes(a.type)&&a.currency===w.currency&&(identity?sameBankAccount(a,identity,w.currency):missingIdentity));
  if(!targets.length||identity&&targets.length!==1)continue;
  const wr=rootOf(w.id);if(occupiedBankRoots.has(wr)||annotatedRoots.has(wr))continue;
  const days=[w.date,...(identity?[new Date(Date.parse(w.date)+86400000).toISOString().slice(0,10)]:[])];
  for(const b of days.flatMap(day=>receiptDays.get(JSON.stringify([day,w.currency]))||[])){
   const target=targets.find(a=>a.id===b.financialAccountId);
   const nextDay=Boolean(identity)&&b.date!==w.date&&Date.parse(b.date)-Date.parse(w.date)===86400000&&b.statementFlow?.schema==='ccb-debit-v1'&&b.rawFields?.dateBasis==='transaction_date'&&String(b.rawFields?.['\u4ea4\u6613\u65e5\u671f']||'')===b.date.replace(/-/g,'');
   if(!b.statementFlow||!target||b.status!=='completed'||b.direction!=='credit'||b.currency!==w.currency||b.date!==w.date&&!nextDay||!['unknown','transfer'].includes(b.kind)||annotatedIds.has(b.id))continue;
   if(missingIdentity&&!(b.statementFlow.schema==='ccb-debit-v1'&&b.rawFields?.dateBasis==='transaction_date'&&String(b.description||'').trim()==='\u8d22\u4ed8\u901a\u8f6c\u5165'&&/\u8d22\u4ed8\u901a/.test(b.counterparty||'')&&b.amountMinor===w.amountMinor))continue;
   const bankText=[b.description,b.counterparty].join(' '),explicitChannel=/\u8d22\u4ed8\u901a|\u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0/.test(bankText);
   // Some bank receipts omit the wallet channel but retain a real second-level
   // timestamp. Only a receipt in the next two seconds may substitute for that
   // missing channel; a date-only statement's synthetic time is not evidence.
   const delay=(Date.parse(b.occurredAt)-Date.parse(w.occurredAt))/1000;
   const preciseReceipt=b.statementFlow.timePrecision==='second'&&Number.isInteger(delay)&&delay>=0&&delay<=2&&!/\u652f\u4ed8\u5b9d/.test(bankText);
   if(!explicitChannel&&!preciseReceipt||nextDay&&!explicitChannel)continue;
   const br=rootOf(b.id);if(wr===br||occupiedBankRoots.has(br)||annotatedRoots.has(br)||isBlocked(w.id,b.id))continue;
   const gross=BigInt(w.amountMinor),net=BigInt(b.amountMinor),fee=gross-net,normal=(gross+999n)/1000n,cap=normal>10n?normal:10n;
   if(net<=0n||fee<0n||fee>cap)continue;
   const originalFee=require('./wechatStatementFees').wechatStatementFee(w);if(originalFee&&originalFee.feeMinor!==String(fee))continue;
   if(!candidates.has(wr))candidates.set(wr,new Set());if(!reverse.has(br))reverse.set(br,new Set());candidates.get(wr).add(br);reverse.get(br).add(wr);
   const key=JSON.stringify([wr,br]),previous=evidence.get(key);
   if(!previous||(w.sourceVersionOrdinal||0)>(previous.wallet.sourceVersionOrdinal||0)||(b.sourceVersionOrdinal||0)>(previous.bank.sourceVersionOrdinal||0))evidence.set(key,{wallet:w,bank:b,targetAccountId:target.id,grossMinor:w.amountMinor,netMinor:b.amountMinor,feeMinor:String(fee),feeCapMinor:String(cap),feeRuleSource:FEE_RULE_SOURCE,matchBasis:nextDay?'next_day_named_bank_receipt':missingIdentity?'reciprocal_bank_withdrawal_identity':explicitChannel?'explicit_bank_channel':'precise_bank_receipt_time',bankReceiptDelaySeconds:preciseReceipt?delay:null,...(nextDay?{separateDates:true,bankReceiptDate:b.date}:{})});
  }
 }
 const matches=[];for(const [wr,banks] of candidates)if(banks.size===1){const br=[...banks][0];if(reverse.get(br)?.size===1)matches.push({...evidence.get(JSON.stringify([wr,br])),walletRoot:wr,bankRoot:br,confidence:'inferred',method:'wechat_withdrawal_net_receipt'});}
 return matches;
}

// Only actual equal cash amounts are used. The two posting dates stay separate;
// neither a missing card identity nor an estimated fee is manufactured.
function findAlipayNextDayWithdrawalMatches(observations,accounts,{rootOf=id=>id,isBlocked=()=>false,occupiedBankRoots=new Set(),annotatedIds=new Set(),statementOwners=new Map(),links=[]}={}){
 const map=new Map(accounts.map(a=>[a.id,a])),latest=new Map(),annotatedRoots=new Set([...annotatedIds].map(rootOf));
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').replace(/^中国(?=建设|工商|农业)/,'');
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()].filter(o=>o.status==='completed'),proposals=[];
 const nativeCcbReceipt=b=>{
  const raw=b.rawFields||{},flow=b.statementFlow||{},owner=statementOwners.get(b.id),amount=String(raw['\u4ea4\u6613\u91d1\u989d']||'').replace(/,/g,'').match(/^(\d+)\.(\d{2})$/);
  return owner&&b.provider==='ccb'&&flow.schema==='ccb-debit-v1'&&flow.timePrecision==='day'&&flow.incomeMinor===b.amountMinor&&flow.expenseMinor==='0'&&raw.dateBasis==='transaction_date'&&raw['\u4ea4\u6613\u65e5\u671f']===b.date.replace(/-/g,'')&&raw['\u6458\u8981']===b.description&&raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']===b.description&&raw['\u5bf9\u65b9\u8d26\u53f7\u4e0e\u6237\u540d']===b.counterparty&&/\u652f\u4ed8\u5b9d\u4ee3\u53d1\u8fc7\u6e21\u6237|\u652f\u4ed8\u5b9d.*\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8/.test(b.counterparty||'')&&[owner+'\u652f\u4ed8\u5b9d\u8f6c\u8d26','\u652f\u4ed8\u5b9d\u63d0\u73b0'].includes(b.description)&&amount&&BigInt(amount[1])*100n+BigInt(amount[2])===BigInt(b.amountMinor);
 };
 const nativeWithdrawal=w=>{const raw=w.rawFields||{},amount=String(raw['\u91d1\u989d']||'').match(/^(\d+)\.(\d{2})$/);return raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===w.sourceTransactionId&&raw['\u5546\u54c1\u8bf4\u660e']===w.description&&raw['\u4ea4\u6613\u5bf9\u65b9']===w.counterparty&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===w.paymentChannel&&raw['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u4ea4\u6613\u65f6\u95f4']===w.occurredAt.slice(0,19).replace('T',' ')&&amount&&BigInt(amount[1])*100n+BigInt(amount[2])===BigInt(w.amountMinor);};
 const blocked=(w,b)=>isBlocked(w.id,b.id)||links.some(l=>l.status!=='deleted'&&l.type==='group_distinct'&&l.observationIds.some(id=>[rootOf(w.id),rootOf(b.id)].includes(rootOf(id))));
 const receipts=rows.filter(b=>b.direction==='credit'&&['unknown','transfer'].includes(b.kind)&&!occupiedBankRoots.has(rootOf(b.id))&&!annotatedRoots.has(rootOf(b.id))&&b.rawFields?.dateBasis==='transaction_date'&&b.rawFields?.['交易日期']===b.date.replace(/-/g,'')&&statementOwners.has(b.id)&&/支付宝代发过渡户|支付宝.*网络技术有限公司/.test(b.counterparty||'')&&(b.provider==='ccb'&&b.statementFlow?.schema==='ccb-debit-v1'&&b.description===statementOwners.get(b.id)+'支付宝转账'&&b.rawFields?.['摘要']===b.description||nativeCcbReceipt(b)||b.provider==='spdb'&&b.statementFlow?.schema==='spdb-debit-v1'&&b.statementFlow.timePrecision==='second'&&b.description.startsWith('支付宝-'+statementOwners.get(b.id))&&b.rawFields?.['交易摘要']==='支付宝-'+statementOwners.get(b.id)+'支付宝转账'));
 for(const w of rows){
  if(w.provider!=='alipay'||w.kind!=='transfer'||!['neutral','debit'].includes(w.direction)||!/^提现-(?:快速|实时|普通)提现$/.test(w.description)||w.accountRelations?.length||w.paymentAccountHint||!['','余额','账户余额','支付宝余额'].includes(w.paymentChannel)||!/银行$/.test(w.counterparty||'')||map.get(w.financialAccountId)?.type!=='wallet'||occupiedBankRoots.has(rootOf(w.id))||annotatedRoots.has(rootOf(w.id))||BigInt(w.amountMinor)<=0n)continue;
  for(const b of receipts){const account=map.get(b.financialAccountId);
   const strictNativeCcb=nativeCcbReceipt(b)&&nativeWithdrawal(w)&&[0,86400000].includes(Date.parse(b.date)-Date.parse(w.date));
   if(strictNativeCcb&&rows.some(o=>rootOf(o.id)!==rootOf(b.id)&&o.statementFlow&&o.financialAccountId===b.financialAccountId&&o.direction==='credit'&&o.date===b.date&&o.currency===b.currency&&o.amountMinor===b.amountMinor&&/\u652f\u4ed8\u5b9d/.test(o.description+' '+o.counterparty)))continue;
   if(strictNativeCcb&&rows.some(o=>rootOf(o.id)!==rootOf(w.id)&&o.provider==='alipay'&&o.status==='completed'&&o.amountMinor===w.amountMinor&&o.currency===w.currency&&[w.date,b.date].includes(o.date)&&/\u63d0\u73b0|\u8f6c\u51fa\u5230\u94f6\u884c\u5361|\u8f6c\u8d26\u5230\u94f6\u884c\u5361/.test(o.description||'')&&(!/\u94f6\u884c$/.test(o.counterparty||'')||norm(o.counterparty)===norm(account?.provider))))continue;
   if(account?.status!=='active'||account.type!=='debit_card'||norm(account.provider)!==norm(w.counterparty)||b.amountMinor!==w.amountMinor||b.currency!==w.currency||!(b.provider==='ccb'&&b.description===statementOwners.get(b.id)+'\u652f\u4ed8\u5b9d\u8f6c\u8d26'&&Date.parse(b.date)-Date.parse(w.date)===86400000||nativeCcbReceipt(b)&&nativeWithdrawal(w)&&[0,86400000].includes(Date.parse(b.date)-Date.parse(w.date))||b.provider==='spdb'&&b.date===w.date&&Date.parse(b.occurredAt)>=Date.parse(w.occurredAt)&&Date.parse(b.occurredAt)-Date.parse(w.occurredAt)<=180000)||blocked(w,b))continue;
   const competingReceipts=rows.filter(o=>o.statementFlow&&o.financialAccountId===b.financialAccountId&&o.direction==='credit'&&o.date===b.date&&o.currency===b.currency&&o.amountMinor===b.amountMinor&&!occupiedBankRoots.has(rootOf(o.id))&&/支付宝/.test(o.description+' '+o.counterparty));
   if(new Set(competingReceipts.map(o=>rootOf(o.id))).size!==1)continue;
   // Other unmatched withdrawals/product redemptions into the same bank are
   // competing explanations, including a source that omitted its bank name.
   const competing=rows.filter(o=>o.provider==='alipay'&&o.currency===w.currency&&o.amountMinor===w.amountMinor&&[w.date,b.date].includes(o.date)&&!occupiedBankRoots.has(rootOf(o.id))&&/提现|转出到银行卡|转账到银行卡/.test(o.description||'')&&(!/银行$/.test(o.counterparty||'')||norm(o.counterparty)===norm(account.provider)));
   if(new Set(competing.map(o=>rootOf(o.id))).size!==1)continue;
   proposals.push({wallet:w,bank:b,walletRoot:rootOf(w.id),bankRoot:rootOf(b.id),targetAccountId:account.id,grossMinor:w.amountMinor,netMinor:b.amountMinor,feeMinor:'0',feeCapMinor:'0',feeRuleSource:'actual_equal_platform_and_bank_cash',matchBasis:b.provider==='spdb'?'verified_same_owner_same_day_receipt':'verified_same_owner_next_day_receipt',bankReceiptDelaySeconds:null,separateDates:true,bankReceiptDate:b.date,confidence:'inferred',method:'alipay_withdrawal_actual_receipt'});
  }
 }
 const uses=new Map();for(const m of proposals)for(const id of [m.walletRoot,m.bankRoot])uses.set(id,(uses.get(id)||0)+1);return proposals.filter(m=>uses.get(m.walletRoot)===1&&uses.get(m.bankRoot)===1);
}

module.exports={findWechatWithdrawalMatches,findAlipayNextDayWithdrawalMatches,FEE_RULE_SOURCE};
