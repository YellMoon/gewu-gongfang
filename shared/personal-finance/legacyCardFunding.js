'use strict';
const {fundingIdentity}=require('./assetRegister');
const {compatibleBankTradeTime}=require('./mixedPayments');
const {isSettlementAccount}=require('./counterpartySettlements');
const {wechatTeachingBankReceipt}=require('./bankClassification');
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f|\u90ae\u653f)/,'').replace('\u90ae\u653f\u50a8\u84c4\u94f6\u884c','\u90ae\u50a8\u94f6\u884c');
// A bank name alone never chooses a card. A unique original bank payment can
// supply the missing identity, including when several cards share the issuer.
function findLegacyCardFunding(observations,accounts,{bankPaymentProvider,annotatedIds=new Set(),links=[],statementOwners=new Map(),settlementObservationIds=new Set()}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const blockedKeys=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()].filter(o=>o.status==='completed'&&!o.balanceEvidence),active=links.filter(l=>l.status!=='deleted'),activePairs=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|')));
 const blocked=(p,b)=>vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.includes(identity(p))||keys.includes(identity(b)):keys.includes(identity(p))&&keys.includes(identity(b));});
 const key=o=>JSON.stringify([o.date,o.amountMinor,o.currency,o.direction]),buckets=new Map(),platforms=new Map(),add=(m,k,o)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(o);};
 for(const o of rows){const a=accountMap.get(o.financialAccountId);if(['alipay','wechat'].includes(o.provider)&&a?.type==='wallet')add(platforms,key(o),o);if((o.bankStatement||o.statementFlow)&&a?.status==='active'&&['credit_card','debit_card'].includes(a.type))add(buckets,key(o),o);}
 const ownerSettlement=p=>settlementObservationIds.has(p.id)&&p.kind==='transfer'&&p.automaticClassification?.method==='owner_confirmed_counterparty_settlement'&&isSettlementAccount(accountMap.get(p.automaticClassification.financialAccountId));
 const proposals=[],groupFunding=new Map(),owners=new Set([...statementOwners.values()].map(norm).filter(Boolean));
 const looksLikeOwner=p=>{const name=norm(p.counterparty);return [...owners].some(owner=>name.includes(owner)||owner.length>=3&&/[*\uff0a\u00d7]/.test(name)&&name.includes(owner.slice(-2)));};
 const ordinaryGroupMember=p=>['alipay','wechat'].includes(p.provider)&&accountMap.get(p.financialAccountId)?.type==='wallet'&&!p.paymentAccountHint&&!fundingIdentity(p.paymentChannel)&&!p.accountRelations?.length&&!blockedKeys.has(identity(p))&&p.direction==='debit'&&(!looksLikeOwner(p)||ownerSettlement(p))&&(!p.automaticClassification||ownerSettlement(p))&&(p.kind==='expense'||p.provider==='alipay'&&p.kind==='transfer'&&p.rawFields?.['\u4ea4\u6613\u5206\u7c7b']==='\u8f6c\u8d26\u7ea2\u5305'&&!/\u8f6c\u51fa|\u8f6c\u5165|\u63d0\u73b0|\u5145\u503c|\u8fd8\u6b3e|\u501f|\u8d37|\u91d1\u6761|\u767d\u6761|\u82b1\u5457|\u57fa\u91d1|\u7406\u8d22|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u96f6\u94b1\u901a|\u8bc1\u5238|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(p.description+' '+p.counterparty));
 for(const p of rows){
  if(!['alipay','wechat'].includes(p.provider)||accountMap.get(p.financialAccountId)?.type!=='wallet'||p.paymentAccountHint||fundingIdentity(p.paymentChannel)||p.accountRelations?.length||blockedKeys.has(identity(p))||!['expense','refund','transfer'].includes(p.kind)||!['debit','credit'].includes(p.direction)||BigInt(p.amountMinor)<=0n)continue;
  const hint=norm(p.paymentChannel).match(/^(.+?\u94f6\u884c)(\u4fe1\u7528\u5361|\u50a8\u84c4\u5361|\u501f\u8bb0\u5361)?$/);if(!hint)continue;
  // Product, debt and explicit own-account movements need their separate rules.
  if(p.kind==='transfer'&&(p.provider!=='alipay'||p.rawFields?.['\u4ea4\u6613\u5206\u7c7b']!=='\u8f6c\u8d26\u7ea2\u5305'||p.automaticClassification&&!ownerSettlement(p)||p.direction!=='debit'||/\u8f6c\u51fa|\u8f6c\u5165|\u63d0\u73b0|\u5145\u503c|\u8fd8\u6b3e|\u501f\u6b3e|\u501f\u5457|\u5fae\u7c92\u8d37|\u91d1\u6761|\u767d\u6761|\u82b1\u5457|\u57fa\u91d1|\u7406\u8d22|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u96f6\u94b1\u901a|\u8bc1\u5238|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(p.description+' '+p.counterparty)))continue;
  const candidates=(buckets.get(key(p))||[]).filter(b=>{const a=accountMap.get(b.financialAccountId),channel=bankPaymentProvider(b);return norm(a.provider)===hint[1]&&(!hint[2]||a.type===(hint[2]==='\u4fe1\u7528\u5361'?'credit_card':'debit_card'))&&(channel===p.provider||channel===null&&b.bankStatement)&&compatibleBankTradeTime(p,b)&&!blockedKeys.has(identity(b))&&!blocked(p,b)&&(p.direction==='debit'?b.kind==='expense'||wechatTeachingBankReceipt(p,b):p.kind==='refund'&&b.kind==='refund');});
  if(candidates.length>1&&candidates.length<=32&&new Set(candidates.map(b=>b.financialAccountId)).size===1&&candidates.every(b=>bankPaymentProvider(b)===p.provider&&b.direction==='debit'&&b.kind==='expense'&&b.statementFlow?.schema==='ccb-debit-v1'&&b.rawFields?.dateBasis==='transaction_date'&&String(b.rawFields?.['\u4ea4\u6613\u65e5\u671f']||'')===p.date.replace(/-/g,''))){
   const members=(platforms.get(key(p))||[]).filter(o=>o.provider===p.provider&&compatibleBankTradeTime(o,candidates[0]));
   if(members.length===candidates.length&&members.every(o=>ordinaryGroupMember(o)&&norm(o.paymentChannel)===norm(p.paymentChannel)&&candidates.every(b=>!blocked(o,b)))){
    const evidence=candidates.map(b=>b.id).sort(),groupId=JSON.stringify([candidates[0].financialAccountId,p.date,p.amountMinor,p.currency,p.provider]);
    for(const member of members)groupFunding.set(member.id,{financialAccountId:candidates[0].financialAccountId,method:'source_statement_legacy_card_group',confidence:'inferred',evidenceObservationIds:evidence,groupId,groupCount:members.length,individualIdentity:'undetermined',...(member.kind==='transfer'&&!ownerSettlement(member)?{inferredKind:'expense'}:{})});
   }
   continue;
  }
  if(candidates.length!==1)continue;const b=candidates[0];
  const competitors=(platforms.get(key(p))||[]).filter(o=>{if(bankPaymentProvider(b)!==null&&o.provider!==p.provider)return false;const f=fundingIdentity(o.paymentChannel),h=norm(o.paymentChannel).match(/^(.+?\u94f6\u884c)(\u4fe1\u7528\u5361|\u50a8\u84c4\u5361|\u501f\u8bb0\u5361)?$/);return f?norm(f.bank)===hint[1]:!h||h[1]===hint[1];});
  if(competitors.length!==1)continue;proposals.push({p,b});
 }
 const uses=new Map();for(const {b}of proposals)uses.set(identity(b),(uses.get(identity(b))||0)+1);
 return new Map([...groupFunding,...proposals.filter(({b})=>uses.get(identity(b))===1).map(({p,b})=>[p.id,{financialAccountId:b.financialAccountId,method:'source_statement_legacy_card',confidence:'inferred',evidenceObservationIds:[b.id],reciprocalUnique:true,...(p.kind==='transfer'&&!ownerSettlement(p)?{inferredKind:'expense'}:{})}])]);
}
module.exports={findLegacyCardFunding};
