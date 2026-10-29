'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');

// UTF-8 native order/payment/credit-statement evidence. The amount difference
// is retained without inventing coupon income or a second payment component.
function findCommerceNetPayments(rows,accounts,{identity,annotated,blocked,rootOf,allRows}){
 const amount=(raw,value)=>{const m=String(raw??'').match(/^(\d+)(?:\.(\d{1,2}))?$/);return !!m&&BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))===BigInt(value);};
 const rawTime=o=>o.occurredAt.slice(0,19).replace('T',' '),active=(id,provider,type,currency)=>accounts.some(a=>a.id===id&&a.provider===provider&&a.type===type&&a.currency===currency&&a.status==='active');
 const orders=rows.filter(p=>p.provider==='jd'&&p.paymentChannel==='\u5fae\u4fe1\u652f\u4ed8'&&p.currency==='CNY'&&!p.accountRelations?.length&&!p.paymentAccountHint&&active(p.financialAccountId,'jd','wallet',p.currency));
 const payments=rows.filter(w=>w.provider==='wechat'&&w.currency==='CNY'&&w.counterparty==='\u4eac\u4e1c'&&active(w.financialAccountId,'wechat','wallet',w.currency));
 const proposals=[];
 for(const p of orders){
  const pr=p.rawFields||{},order=pr['\u4ea4\u6613\u8ba2\u5355\u53f7'];
  if(typeof order!=='string'||!/^\d{8,40}$/.test(order)||pr['\u4ea4\u6613\u65f6\u95f4']!==rawTime(p)||pr['\u4ea4\u6613\u8bf4\u660e']!==p.description||pr['\u5546\u6237\u540d\u79f0']!==p.counterparty||pr['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==p.paymentChannel||pr['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||pr['\u6536/\u652f']!=='\u652f\u51fa'||!amount(pr['\u91d1\u989d'],p.amountMinor))continue;
  // A split order, or another order sharing the visible tail and second,
  // prevents uniqueness even if that competing record is annotated.
  if(allRows.some(o=>identity(o)!==identity(p)&&o.provider==='jd'&&o.status==='completed'&&o.currency===p.currency&&(o.rawFields?.['\u4ea4\u6613\u8ba2\u5355\u53f7']===order||o.occurredAt===p.occurredAt&&String(o.rawFields?.['\u4ea4\u6613\u8ba2\u5355\u53f7']||'').endsWith(order.slice(-4)))))continue;
  for(const w of payments){
   const tail=w.description.match(/^\u4eac\u4e1c-\u624b\u673a\u5145\u503c\u8ba2\u5355\*{4}(\d{4})$/)?.[1],wr=w.rawFields||{},fund=fundingIdentity(w.paymentChannel);
   if(p.date!==w.date||p.occurredAt!==w.occurredAt||!tail||!order.endsWith(tail)||!fund||fund.type!=='credit_card'||fund.bank!=='\u5efa\u8bbe\u94f6\u884c'||BigInt(w.amountMinor)<=0n||BigInt(w.amountMinor)>=BigInt(p.amountMinor)||wr['\u4ea4\u6613\u7c7b\u578b']!=='\u5546\u6237\u6d88\u8d39'||wr['\u6536/\u652f']!=='\u652f\u51fa'||wr['\u5f53\u524d\u72b6\u6001']!=='\u652f\u4ed8\u6210\u529f'||wr['\u5546\u54c1']!==w.description||wr['\u4ea4\u6613\u5bf9\u65b9']!==w.counterparty||wr['\u4ea4\u6613\u65f6\u95f4']!==rawTime(w)||wr['\u4ea4\u6613\u5355\u53f7']!==w.sourceTransactionId||wr['\u652f\u4ed8\u65b9\u5f0f']!==w.paymentChannel||!amount(wr['\u91d1\u989d(\u5143)'],w.amountMinor)||[p,w].some(o=>![undefined,null,'0'].includes(o.feeMinor)))continue;
   if(allRows.some(o=>identity(o)!==identity(w)&&o.provider==='wechat'&&o.status==='completed'&&o.currency===w.currency&&o.occurredAt===w.occurredAt&&o.description===w.description))continue;
   const cards=accounts.filter(a=>a.status==='active'&&sameBankAccount(a,fund,w.currency));if(cards.length!==1)continue;const card=cards[0];
   const bs=allRows.filter(b=>b.status==='completed'&&b.direction==='debit'&&b.financialAccountId===card.id&&b.currency===w.currency&&b.date===w.date&&b.amountMinor===w.amountMinor);
   if(bs.length!==1)continue;const b=bs[0],br=b.rawFields||{},bank=b.bankStatement||{};
   if(b.provider!=='ccb'||b.kind!=='expense'||bank.schema!=='bank-credit-v1'||bank.provider!=='ccb'||bank.nonCash!==false||bank.cardTail!==card.maskedIdentifier||br.cardTail!==card.maskedIdentifier||br.tradeDate!==b.date||br.dateBasis!=='transaction_date'||br.statementCredit!==false||br.statementAmountMinor!==b.amountMinor||br.excludedFromBilledTotal||b.description!=='\u8d22\u4ed8\u901a-\u4eac\u4e1c\u5546\u57ce\u5e73\u53f0\u5546\u6237'||b.counterparty!==b.description||b.bankAccount?.provider!==card.provider||b.bankAccount.type!=='credit_card'||b.bankAccount.maskedIdentifier!==card.maskedIdentifier||b.bankAccount.currency!==card.currency)continue;
   const members=[p,w,b],keys=new Set(members.map(identity));
   if(members.some(o=>annotated.has(identity(o)))||members.some((a,i)=>members.slice(i+1).some(c=>blocked(a,c)))||rootOf&&allRows.some(o=>members.some(m=>rootOf(m.id)===rootOf(o.id))&&!keys.has(identity(o))))continue;
   proposals.push({commerce:p,payment:w,bank:b,method:'commerce_native_net_payment_trace',confidence:'inferred_from_native_order_payment_and_credit_statement',evidence:{channel:'wechat',orderMatch:'masked_order_tail_and_exact_second',orderNumber:order,secondsApart:0,date:p.date,currency:p.currency,orderAmountMinor:p.amountMinor,actualPaidMinor:w.amountMinor,paymentDifferenceMinor:String(BigInt(p.amountMinor)-BigInt(w.amountMinor)),paymentDifferenceClassification:'unclassified_order_to_payment_amount_difference',actualPaymentVerified:true,bankCardTail:card.maskedIdentifier,reciprocalUnique:true,observationIds:members.map(o=>o.id)}});
  }
 }
 const uses=new Map();for(const m of proposals)for(const o of [m.commerce,m.payment,m.bank])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return proposals.filter(m=>[m.commerce,m.payment,m.bank].every(o=>uses.get(identity(o))===1));
}
module.exports={findCommerceNetPayments};
