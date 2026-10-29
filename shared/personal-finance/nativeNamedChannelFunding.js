'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe)/,'');
// A temporary unnumbered channel account can be superseded for individually
// evidenced rows. The earlier policy and all originals remain intact; no whole
// account merge or extrapolation to dates without native cash evidence occurs.
function findNativeNamedChannelFunding(observations,accounts,{historicalFunding=new Map(),statementOwners=new Map(),annotatedIds=new Set(),links=[]}={}){
 const am=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()].filter(o=>o.status==='completed'),active=links.filter(l=>l.status!=='deleted'),activePairs=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|'))),rejects=(p,b)=>vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?ids.includes(identity(p))||ids.includes(identity(b)):ids.includes(identity(p))&&ids.includes(identity(b));});
 const key=o=>JSON.stringify([o.date,o.amountMinor,o.currency]),banks=new Map(),platforms=new Map(),add=(m,k,o)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(o);};
 for(const o of rows){if(o.provider==='alipay'&&['debit','neutral'].includes(o.direction))add(platforms,key(o),o);if(o.statementFlow&&o.direction==='debit')add(banks,key(o),o);}
 const native=(b,{allowBranch=false}={})=>{const a=am.get(b.financialAccountId),raw=b.rawFields||{},company='\u652f\u4ed8\u5b9d(\u4e2d\u56fd)\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8',branch=company+'\u5317\u4eac\u5206\u516c',payee=allowBranch&&raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']===branch?branch:company;return b.provider==='ccb'&&b.statementFlow.schema==='ccb-debit-v1'&&b.statementFlow.expenseMinor===b.amountMinor&&b.statementFlow.incomeMinor==='0'&&raw.dateBasis==='transaction_date'&&raw['\u4ea4\u6613\u65e5\u671f']===b.date.replace(/-/g,'')&&raw['\u6458\u8981']==='\u6d88\u8d39'&&raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']===payee&&b.description==='\u6d88\u8d39 '+payee&&b.counterparty===payee&&Boolean(statementOwners.get(b.id))&&!blocked.has(identity(b))&&a?.status==='active'&&a.type==='debit_card'&&norm(a.provider)==='\u5efa\u8bbe\u94f6\u884c'&&/^\d{4}$/.test(a.maskedIdentifier||'')&&a.currency===b.currency;};
 const candidates=[],cohorts=new Map();
 const directAccounts=new Set(observations.map(o=>o.financialAccountId));
 const archivedRulesBySource=new Map();
 const separation=p=>{
  if(historicalFunding.has(p.id))return historicalFunding.get(p.id);
  const source=am.get(p.financialAccountId);if(source?.status!=='active'||source.type!=='wallet'||source.provider!=='alipay'||source.provider!==p.provider||!source.historicalCardBindings)return null;
  // Validate and index this invocation's policy once per wallet. Revalidating
  // the whole policy for every unrelated original makes historical imports slow.
  if(!archivedRulesBySource.has(source.id)){
   const indexed=new Map();archivedRulesBySource.set(source.id,indexed);
   try{require('./historicalCardBindings').validateHistoricalCardBindings(source.historicalCardBindings);}catch{return null;}
   for(const rule of source.historicalCardBindings.rules){const target=am.get(rule.financialAccountId);if(rule.identityBasis!=='owner_separated_named_channel'||rule.confidence!=='owner_confirmed'||rule.usage!=='funding'||target?.status!=='archived'||target.type!=='debit_card'||target.maskedIdentifier!==''||target.openingBalanceMinor!=null||directAccounts.has(target.id)||norm(target.provider)!==norm(rule.institution))continue;const channel=norm(rule.channel);if(!indexed.has(channel))indexed.set(channel,[]);indexed.get(channel).push(rule);}
  }
  const rules=(archivedRulesBySource.get(source.id).get(norm(p.paymentChannel))||[]).filter(rule=>rule.periodStart<=p.date&&rule.periodEnd>=p.date&&(!rule.sourceTransactionIds||rule.sourceTransactionIds.includes(p.sourceTransactionId))&&am.get(rule.financialAccountId).currency===p.currency);
  return rules.length===1?{identityBasis:'owner_separated_named_channel',financialAccountId:rules[0].financialAccountId,archivedProvisionalReference:true}:null;
 };
 for(const p of rows){const prior=separation(p),a=am.get(p.financialAccountId),raw=p.rawFields||{},relation=p.accountRelations?.length===1?p.accountRelations[0]:null,product=am.get(relation?.financialAccountId);
  if(prior?.identityBasis!=='owner_separated_named_channel'||p.provider!=='alipay'||p.kind!=='transfer'||p.direction!=='neutral'||blocked.has(identity(p))||p.paymentAccountHint||a?.status!=='active'||a.type!=='wallet'||p.description!=='\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165'||raw['\u5546\u54c1\u8bf4\u660e']!==p.description||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==p.paymentChannel||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==p.sourceTransactionId||!norm(p.paymentChannel).startsWith('\u5efa\u8bbe\u94f6\u884c')||!norm(p.paymentChannel).endsWith('\u5361\u901a')||relation?.role!=='target'||relation.activity!=='investment_deposit'||relation.product!=='alipay_yuebao'||product?.status!=='active'||product.sourceProduct!=='alipay_yuebao')continue;
  const peerRows=platforms.get(key(p))||[];if(peerRows.filter(o=>norm(o.paymentChannel)===norm(p.paymentChannel)).length!==1)continue;
  const possible=(banks.get(key(p))||[]).filter(b=>{if(!native(b)||rejects(p,b))return false;const bank=am.get(b.financialAccountId);return !peerRows.some(other=>{if(other.id===p.id)return false;const named=fundingIdentity(other.paymentChannel),h=historicalFunding.get(other.id);return named&&sameBankAccount(bank,named,other.currency)||h&&h.identityBasis!=='owner_separated_named_channel'&&h.financialAccountId===bank.id;});});
  const cohort=JSON.stringify([p.financialAccountId,p.paymentChannel,p.currency,prior.financialAccountId]);if(!cohorts.has(cohort))cohorts.set(cohort,[]);const item={p,prior,possible,cohort};cohorts.get(cohort).push(item);if(possible.length===1)candidates.push({...item,b:possible[0]});
 }
 const out=new Map(),uses=new Map();for(const c of candidates)uses.set(identity(c.b),(uses.get(identity(c.b))||0)+1);
 for(const c of candidates){const cohort=candidates.filter(x=>x.cohort===c.cohort&&uses.get(identity(x.b))===1),targetIds=new Set(cohort.map(x=>x.b.financialAccountId)),dates=new Set(cohort.map(x=>x.p.date));
  if(uses.get(identity(c.b))!==1||targetIds.size!==1||dates.size<2)continue;
  const proofs=[...new Map(cohort.map(x=>[x.p.date,x])).values()].slice(0,2);out.set(c.p.id,{financialAccountId:c.b.financialAccountId,method:'source_statement_legacy_product',confidence:'inferred',identityBasis:'repeated_native_cash_proves_named_channel',evidenceObservationIds:[c.b.id],channelEvidenceObservationIds:proofs.flatMap(x=>[x.p.id,x.b.id]),channelEvidenceDates:proofs.map(x=>x.p.date),supersededProvisionalAccountId:c.prior.financialAccountId,nominalChannel:c.p.paymentChannel,date:c.p.date,bankDate:c.b.date,amountMinor:c.p.amountMinor,currency:c.p.currency,bankDirection:'debit',reciprocalUnique:true});
 }
 // Two card debits do not by themselves identify either platform order. A
 // channel proven on separate dates can, however, constrain an exhaustive
 // two-card/two-named-order set. Keep the within-day assignment inferred and
 // cite both the independent channel proofs and its other actual cash leg.
 const assignments=[],usedNative=new Set([...out.values()].flatMap(x=>x.evidenceObservationIds));
 const productOrder=o=>{const a=am.get(o.financialAccountId),raw=o.rawFields||{},relation=o.accountRelations?.length===1?o.accountRelations[0]:null;return o.provider==='alipay'&&o.kind==='transfer'&&o.direction==='neutral'&&!blocked.has(identity(o))&&!o.paymentAccountHint&&a?.status==='active'&&a.type==='wallet'&&o.description==='\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165'&&raw['\u5546\u54c1\u8bf4\u660e']===o.description&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===o.paymentChannel&&raw['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===o.sourceTransactionId&&relation?.role==='target'&&relation.activity==='investment_deposit'&&relation.product==='alipay_yuebao'&&am.get(relation.financialAccountId)?.sourceProduct==='alipay_yuebao';};
 const previouslyClaimed=(p,b)=>active.some(l=>l.type==='duplicate'&&l.observationIds.some(id=>byId.has(id)&&identity(byId.get(id))===identity(b))&&l.observationIds.some(id=>{const o=byId.get(id);return o?.provider==='alipay'&&identity(o)!==identity(p);}));
 for(const [cohort,items]of cohorts){
  const proven=items.map(x=>out.get(x.p.id)).filter(Boolean),targetIds=new Set(proven.map(x=>x.financialAccountId)),dates=new Set(proven.flatMap(x=>x.channelEvidenceDates));if(targetIds.size!==1||dates.size<2)continue;const target=[...targetIds][0],anchor=proven[0];
  for(const item of items){const p=item.p;if(out.has(p.id)||item.possible.length!==2||new Set(item.possible.map(b=>b.financialAccountId)).size!==2)continue;const b=item.possible.find(b=>b.financialAccountId===target),other=item.possible.find(b=>b.financialAccountId!==target),peers=platforms.get(key(p))||[],allDebits=banks.get(key(p))||[];
   if(!b||!other||allDebits.length!==2||allDebits.some(x=>!native(x))||statementOwners.get(b.id)!==statementOwners.get(other.id)||usedNative.has(b.id)||usedNative.has(other.id))continue;
   const named=peers.filter(o=>/\u94f6\u884c/.test(o.paymentChannel||'')),remaining=named.filter(o=>o.id!==p.id&&productOrder(o)&&o.financialAccountId===p.financialAccountId&&norm(o.paymentChannel)===norm(am.get(other.financialAccountId).provider)&&o.accountRelations[0].financialAccountId===p.accountRelations[0].financialAccountId);
   if(named.length!==2||remaining.length!==1||peers.some(o=>o.id!==p.id&&o.id!==remaining[0].id&&o.description==='\u5145\u503c-\u666e\u901a\u5145\u503c'))continue;const peer=remaining[0];if(rejects(p,b)||rejects(peer,other)||previouslyClaimed(p,b)||previouslyClaimed(peer,other))continue;
   assignments.push({p,b,peer,other,anchor,prior:item.prior});
  }
 }
 const assignmentUses=new Map();for(const x of assignments)for(const o of [x.p,x.b,x.peer,x.other])assignmentUses.set(identity(o),(assignmentUses.get(identity(o))||0)+1);
 for(const x of assignments){if([x.p,x.b,x.peer,x.other].some(o=>assignmentUses.get(identity(o))!==1))continue;const ids=[x.p.id,x.b.id,x.peer.id,x.other.id],proof={method:'source_statement_legacy_product',confidence:'inferred',channelEvidenceObservationIds:x.anchor.channelEvidenceObservationIds,channelEvidenceDates:x.anchor.channelEvidenceDates,closedAssignmentObservationIds:ids,individualIdentityBasis:'repeated_channel_identity_and_exhaustive_two_native_cards',date:x.p.date,bankDate:x.b.date,amountMinor:x.p.amountMinor,currency:x.p.currency,bankDirection:'debit',reciprocalUnique:true};
  out.set(x.p.id,{...proof,identityBasis:'repeated_native_cash_proves_named_channel',financialAccountId:x.b.financialAccountId,evidenceObservationIds:[x.b.id],supersededProvisionalAccountId:x.prior.financialAccountId,nominalChannel:x.p.paymentChannel});
  out.set(x.peer.id,{...proof,identityBasis:'closed_two_card_native_product_assignment',financialAccountId:x.other.financialAccountId,evidenceObservationIds:[x.other.id],nominalChannel:x.peer.paymentChannel});
 }
 // A late order can have an independently dated next-day bank cash row. Only
 // interpolate an already proven channel, require one actual debit across both
 // dates, and retain the two original dates; never fabricate bank seconds.
 const nextDayAssignments=[],occupiedNative=new Set([...out.values()].flatMap(x=>x.evidenceObservationIds));
 for(const items of cohorts.values()){
  const proven=items.filter(x=>out.has(x.p.id)),targetIds=new Set(proven.map(x=>out.get(x.p.id).financialAccountId)),dates=[...new Set(proven.map(x=>x.p.date))].sort();if(targetIds.size!==1||dates.length<2)continue;const target=[...targetIds][0],anchor=out.get(proven[0].p.id);
  for(const item of items){const p=item.p;if(out.has(p.id)||item.possible.length||!productOrder(p)||p.date<dates[0]||p.date>dates.at(-1)||p.occurredAt.slice(11,19)<'21:00:00'||!p.occurredAt.endsWith('+08:00')||p.rawFields['\u4ea4\u6613\u65f6\u95f4']!==p.date+' '+p.occurredAt.slice(11,19)||(banks.get(key(p))||[]).length)continue;
   const date=new Date(Date.parse(p.date)+86400000).toISOString().slice(0,10),next={...p,date},cash=banks.get(key(next))||[];if(cash.length!==1)continue;const b=cash[0];
   if(b.financialAccountId!==target||!native(b,{allowBranch:true})||b.statementFlow.timePrecision!=='day'||occupiedNative.has(b.id)||rejects(p,b)||previouslyClaimed(p,b)||(platforms.get(key(p))||[]).some(o=>identity(o)!==identity(p))||(platforms.get(key(next))||[]).length)continue;
   nextDayAssignments.push({p,b,anchor,prior:item.prior});
  }
 }
 const nextDayUses=new Map();for(const x of nextDayAssignments)nextDayUses.set(identity(x.b),(nextDayUses.get(identity(x.b))||0)+1);
 for(const {p,b,anchor,prior}of nextDayAssignments)if(nextDayUses.get(identity(b))===1)out.set(p.id,{financialAccountId:b.financialAccountId,method:'source_statement_legacy_product',confidence:'inferred',identityBasis:'repeated_native_cash_proves_named_channel',evidenceObservationIds:[b.id],channelEvidenceObservationIds:anchor.channelEvidenceObservationIds,channelEvidenceDates:anchor.channelEvidenceDates,supersededProvisionalAccountId:prior.financialAccountId,nominalChannel:p.paymentChannel,date:p.date,bankDate:b.date,bankDateDifferenceDays:1,dateBasis:'late_platform_order_and_next_day_original_bank_cash',amountMinor:p.amountMinor,currency:p.currency,bankDirection:'debit',reciprocalUnique:true});
 return out;
}
module.exports={findNativeNamedChannelFunding};
