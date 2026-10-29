'use strict';
// UTF-8 delayed native CCB debit evidence; a bank name alone never selects a card.
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe)/,'');
const minor=(text,negative=false)=>{const m=String(text??'').replace(/,/g,'').match(negative?/^-(\d+)\.(\d{2})$/:/^(\d+)\.(\d{2})$/);return m?String(BigInt(m[1])*100n+BigInt(m[2])):null;};
function findNextDayProductDebits(rows,accounts,{identity,blocked,rejects,statementOwners,bankDirection,couldUseBank,historicalFunding=new Map(),historicallyBoundKeys=new Set(),ownedBankObservationIds=new Set()}){
 const am=new Map(accounts.map(a=>[a.id,a])),matches=[];
 for(const p of rows){
  const wallet=am.get(p.financialAccountId),rel=p.accountRelations?.[0],product=am.get(rel?.financialAccountId),raw=p.rawFields||{};
  const guohua=require('./guohuaInvestment').isGuohuaInvestmentPurchase(p),productKey=guohua?'alipay_guohua_no1_enhanced':'alipay_yuebao';
  if(p.provider!=='alipay'||p.currency!=='CNY'||p.kind!=='transfer'||p.direction!==(guohua?'debit':'neutral')||p.automaticFunding||historicalFunding.has(p.id)||p.paymentAccountHint||norm(p.paymentChannel)!=='\u5efa\u8bbe\u94f6\u884c'||!guohua&&(p.description!=='\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165'||p.counterparty!=='\u5929\u5f18\u57fa\u91d1\u7ba1\u7406\u6709\u9650\u516c\u53f8')||p.accountRelations?.length!==1||rel.product!==productKey||rel.role!=='target'||rel.activity!=='investment_deposit'||product?.sourceProduct!==productKey||product.type!=='investment'||product.status!=='active'||product.currency!==p.currency||wallet?.provider!=='alipay'||wallet.type!=='wallet'||wallet.status!=='active'||wallet.currency!==p.currency||blocked.has(identity(p))||![null,undefined,'0'].includes(p.feeMinor)||BigInt(p.amountMinor)<=0n)continue;
  if(historicallyBoundKeys.has(identity(p))||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==p.sourceTransactionId||raw['\u4ea4\u6613\u65f6\u95f4']!==p.occurredAt.slice(0,19).replace('T',' ')||p.date!==p.occurredAt.slice(0,10)||raw['\u5546\u54c1\u8bf4\u660e']!==p.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==p.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==p.paymentChannel||raw['\u6536/\u652f']!==(guohua?'\u652f\u51fa':'\u4e0d\u8ba1\u6536\u652f')||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||minor(raw['\u91d1\u989d'])!==p.amountMinor)continue;
  const next=new Date(Date.parse(p.date)+86400000).toISOString().slice(0,10),dates=new Set([p.date,next]);
  // Count native rivals before owner edits, exact clearing text and policy filters.
  const banks=rows.filter(b=>b.provider==='ccb'&&b.statementFlow?.schema==='ccb-debit-v1'&&b.direction==='debit'&&b.currency===p.currency&&b.amountMinor===p.amountMinor&&dates.has(b.date)&&norm(am.get(b.financialAccountId)?.provider)==='\u5efa\u8bbe\u94f6\u884c');
  if(banks.length!==1||banks[0].date!==next)continue;const b=banks[0],card=am.get(b.financialAccountId),br=b.rawFields||{},flow=b.statementFlow;
  if(card.type!=='debit_card'||card.status!=='active'||card.currency!==p.currency||!/^\d{4}$/.test(card.maskedIdentifier||'')||!statementOwners.has(b.id)||blocked.has(identity(b))||ownedBankObservationIds.has(b.id)||b.kind!=='expense'||b.occurredAt!==next+'T23:59:59+08:00'||flow.incomeMinor!=='0'||flow.expenseMinor!==b.amountMinor||flow.timePrecision!=='day'||br.timePrecision!=='day'||br.dateBasis!=='transaction_date'||br['\u4ea4\u6613\u65e5\u671f']!==next.replace(/-/g,'')||br['\u6458\u8981']!=='\u6d88\u8d39'||br['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']!=='\u652f\u4ed8\u5b9d'||b.description!=='\u6d88\u8d39 \u652f\u4ed8\u5b9d'||b.counterparty!=='\u652f\u4ed8\u5b9d'||minor(br['\u4ea4\u6613\u91d1\u989d'],true)!==b.amountMinor||rejects(p,b))continue;
  const rivals=rows.filter(o=>o.provider==='alipay'&&dates.has(o.date)&&o.amountMinor===p.amountMinor&&o.currency===p.currency&&couldUseBank(o,card)&&(bankDirection(o)==='debit'||o.direction==='neutral'&&['transfer','unknown'].includes(o.kind)&&!o.accountRelations?.length));
  if(rivals.length!==1||identity(rivals[0])!==identity(p))continue;
  matches.push({p,b});
 }
 const uses=new Map();for(const {b}of matches)uses.set(identity(b),(uses.get(identity(b))||0)+1);
 return new Map(matches.filter(({b})=>uses.get(identity(b))===1).map(({p,b})=>[p.id,{financialAccountId:b.financialAccountId,method:'source_statement_legacy_product',confidence:'inferred_next_day_native_bank_debit',identityBasis:'native_ccb_alipay_debit_and_unique_named_product_order',evidenceObservationIds:[b.id],date:p.date,bankDate:b.date,bankDirection:'debit',amountMinor:p.amountMinor,currency:p.currency,settlementLagDays:1,preserveOriginalCashDates:true,reciprocalUnique:true}]));
}
module.exports={findNextDayProductDebits};
