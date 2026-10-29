'use strict';
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const rawAmount=value=>{const m=String(value??'').match(/^(\d+)(?:\.(\d{1,2}))?$/);return m?String(BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))):null;};
// A returned transfer was debited before its separately recorded refund. Keep
// both native posting times; a closed state is not an unexecuted payment.
function findReturnedWechatTransfers(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 const am=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map();
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const l of links)for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}
 function cashAccount(o){if(o.paymentChannel==='\u96f6\u94b1'&&!o.accountRelations?.length)return o.financialAccountId;if(o.paymentChannel!=='\u96f6\u94b1\u901a'||o.accountRelations?.length!==1)return null;const r=o.accountRelations[0],matches=accounts.filter(a=>a.sourceProduct==='wechat_lingqiantong'&&a.provider==='wechat'&&a.type==='investment'&&a.status==='active'&&a.currency===o.currency);return matches.length===1&&r.role==='funding'&&r.product==='wechat_lingqiantong'&&r.activity===(o.direction==='debit'?'funding_outflow':'funding_inflow')&&r.financialAccountId===matches[0].id?matches[0].id:null;}
 function native(o){const a=am.get(o.financialAccountId),r=o.rawFields||{};return o.provider==='wechat'&&o.currency==='CNY'&&a?.provider==='wechat'&&a.type==='wallet'&&a.status==='active'&&a.currency===o.currency&&/^[0-9]{16,48}$/.test(o.sourceTransactionId||'')&&r['\u4ea4\u6613\u5355\u53f7']===o.sourceTransactionId&&r['\u4ea4\u6613\u65f6\u95f4']===o.occurredAt?.slice(0,19).replace('T',' ')&&r['\u652f\u4ed8\u65b9\u5f0f']===o.paymentChannel&&r['\u4ea4\u6613\u5bf9\u65b9']===o.counterparty&&r['\u5546\u54c1']===o.description&&rawAmount(r['\u91d1\u989d(\u5143)'])===o.amountMinor&&BigInt(o.amountMinor)>0n&&!o.paymentAccountHint&&!o.bankStatement&&!o.statementFlow&&!o.investmentTrade&&(o.feeMinor===null||o.feeMinor==='0')&&cashAccount(o);}
 const rows=[...latest.values()],outgoing=rows.filter(o=>native(o)&&o.kind==='transfer'&&o.status==='failed'&&o.direction==='debit'&&o.rawFields['\u4ea4\u6613\u7c7b\u578b']==='\u8f6c\u8d26'&&o.rawFields['\u6536/\u652f']==='\u652f\u51fa'&&o.rawFields['\u5f53\u524d\u72b6\u6001']==='\u5bf9\u65b9\u5df2\u9000\u8fd8'),refunds=rows.filter(o=>native(o)&&o.kind==='refund'&&o.status==='completed'&&o.direction==='credit'&&o.rawFields['\u4ea4\u6613\u7c7b\u578b']==='\u8f6c\u8d26-\u9000\u6b3e'&&o.rawFields['\u6536/\u652f']==='\u6536\u5165'&&o.rawFields['\u5f53\u524d\u72b6\u6001']==='\u5df2\u5168\u989d\u9000\u6b3e');
 const proposals=[];
 for(const payment of outgoing)for(const refund of refunds){const delay=Date.parse(refund.occurredAt)-Date.parse(payment.occurredAt);if(payment.financialAccountId!==refund.financialAccountId||cashAccount(payment)!==cashAccount(refund)||payment.amountMinor!==refund.amountMinor||payment.currency!==refund.currency||payment.sourceTransactionId===refund.sourceTransactionId||!Number.isFinite(delay)||delay<0||delay>86400000)continue;proposals.push({payment,refund});}
 // Count edited and rejected rivals before filtering so a user's decision
 // cannot make a second possible pairing appear uniquely established.
 const uses=new Map();for(const p of proposals)for(const o of[p.payment,p.refund])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 const patches=new Map();
 for(const {payment,refund}of proposals){if([payment,refund].some(o=>blocked.has(identity(o))||uses.get(identity(o))!==1))continue;const evidence={method:'unique_returned_wechat_transfer',confidence:'inferred',evidenceObservationIds:[payment.id,refund.id],paymentObservationId:payment.id,refundObservationId:refund.id,paymentOccurredAt:payment.occurredAt,refundOccurredAt:refund.occurredAt,paymentAccountId:cashAccount(payment),amountMinor:payment.amountMinor,identityBasis:'native_returned_transfer_and_unique_full_refund_same_funding_account_within_24h',sharedOrderReference:false,reciprocalUnique:true,originalStatusPreserved:true};
  patches.set(payment.id,{status:'completed',kind:'transfer',automaticClassification:{...evidence,role:'payment',originalStatus:payment.status,pairedObservationId:refund.id}});
  patches.set(refund.id,{kind:'transfer',automaticClassification:{...evidence,role:'refund',originalKind:refund.kind,pairedObservationId:payment.id}});
 }
 return patches;
}
module.exports={findReturnedWechatTransfers};
