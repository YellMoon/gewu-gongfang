'use strict';
const {actualSecond,compatibleBankTradeTime}=require('./mixedPayments');
const ruleUrl='https://posts.tenpay.com/posts/13c6ced75fa9fba3001233cf61c631d6.html';
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/\u4fe1\u7528\u5361\u8fd8\u6b3e$/,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a)/,'');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const positive=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
function nativeMinor(value){if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))return null;const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
function nativePayment(p){
 const r=p.rawFields||{},amount=r['\u91d1\u989d(\u5143)'];
 return p.provider==='wechat'&&p.status==='completed'&&p.currency==='CNY'&&p.date>='2018-08-01'&&['neutral','debit'].includes(p.direction)&&positive(p.amountMinor)&&actualSecond(p)&&r['\u4ea4\u6613\u7c7b\u578b']==='\u4fe1\u7528\u5361\u8fd8\u6b3e'&&r['\u5f53\u524d\u72b6\u6001']==='\u652f\u4ed8\u6210\u529f'&&r['\u6536/\u652f']==='/'&&/\u94f6\u884c\u4fe1\u7528\u5361\u8fd8\u6b3e$/.test(p.counterparty)&&r['\u4ea4\u6613\u5bf9\u65b9']===p.counterparty&&r['\u652f\u4ed8\u65b9\u5f0f']===p.paymentChannel&&p.sourceTransactionId&&r['\u4ea4\u6613\u5355\u53f7']===p.sourceTransactionId&&nativeMinor(amount)===BigInt(p.amountMinor);
}
function nativeCredit(c,am){
 const a=am.get(c.financialAccountId),r=c.rawFields||{};
 return c.status==='completed'&&c.currency==='CNY'&&positive(c.amountMinor)&&c.direction==='credit'&&c.bankStatement&&!c.bankStatement.nonCash&&a?.status==='active'&&a.type==='credit_card'&&a.currency===c.currency&&/^\d{4}$/.test(a.maskedIdentifier)&&c.bankStatement.cardTail===a.maskedIdentifier&&r.cardTail===a.maskedIdentifier&&r.dateBasis==='transaction_date'&&r.tradeDate===c.date&&r.statementCredit===true&&r.statementAmountMinor==='-'+c.amountMinor&&/\u8d22\u4ed8\u901a/.test(c.description)&&/\u8fd8\u6b3e/.test(c.description)&&(!c.bankAccount||c.bankAccount.type==='credit_card'&&c.bankAccount.maskedIdentifier===a.maskedIdentifier&&c.bankAccount.currency===c.currency&&norm(c.bankAccount.provider)===norm(a.provider));
}
function findWechatCreditRepaymentCosts(observations,accounts,{rootOf=id=>id,fundingAccount=()=>null,annotatedIds=new Set(),links=[]}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a])),latest=new Map();
 for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],roots=new Map();for(const o of rows){const r=rootOf(o.id);if(!roots.has(r))roots.set(r,[]);roots.get(r).push(o);}
 const blockedKeys=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key)),activeKeys=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|')));
 const rootBlocked=r=>(roots.get(r)||[]).some(o=>blockedKeys.has(key(o)));
 const veto=(p,c)=>{const memberKeys=new Set([...(roots.get(rootOf(p.id))||[]),...(roots.get(rootOf(c.id))||[])].map(key));return vetoes.some(l=>{const ks=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(key);return l.type==='group_distinct'?ks.some(k=>memberKeys.has(k)):ks.length===l.observationIds.length&&ks.every(k=>memberKeys.has(k));});};
 const payer=p=>{if(p.paymentChannel==='\u96f6\u94b1'&&!p.paymentAccountHint){const a=am.get(p.financialAccountId);return a?.type==='wallet'&&a.provider==='wechat'&&a.status==='active'&&a.currency===p.currency?a:null;}const a=fundingAccount(p,accounts);return a?.status==='active'&&a.currency===p.currency&&(a.type==='debit_card'||a.type==='investment'&&a.sourceProduct==='wechat_lingqiantong')?a:null;};
 // Build the entire reciprocal graph before considering annotations/occupied
 // roots. An exact receipt or an owner-edited rival still defeats uniqueness.
 const ps=rows.filter(nativePayment),cs=rows.filter(c=>nativeCredit(c,am)),forward=new Map(),reverse=new Map(),pairs=new Map();
 for(const p of ps)for(const c of cs){if(p.date!==c.date||norm(p.counterparty)!==norm(am.get(c.financialAccountId).provider)||!compatibleBankTradeTime(p,c))continue;const net=BigInt(c.amountMinor),cost=BigInt(p.amountMinor)-net,cap=(net+999n)/1000n>10n?(net+999n)/1000n:10n;if(cost<0n||cost>cap)continue;const pr=rootOf(p.id),cr=rootOf(c.id);if(pr===cr)continue;if(!forward.has(pr))forward.set(pr,new Set());if(!reverse.has(cr))reverse.set(cr,new Set());forward.get(pr).add(cr);reverse.get(cr).add(pr);pairs.set(JSON.stringify([pr,cr]),{platform:p,credit:c,netCostMinor:String(cost),standardCostCapMinor:String(cap)});}
 const results=[];
 for(const [pr,credits]of forward){if(credits.size!==1)continue;const cr=[...credits][0];if(reverse.get(cr).size!==1)continue;const m=pairs.get(JSON.stringify([pr,cr])),p=m.platform,c=m.credit,a=payer(p);if(m.netCostMinor==='0'||!a||p.kind!=='debt_payment'||c.kind!=='debt_payment'||[p.principalMinor,p.interestMinor,p.feeMinor].some(v=>v!==null)||p.accountRelations?.length||rootBlocked(pr)||rootBlocked(cr)||veto(p,c)||p.automaticRepaymentTarget&&p.automaticRepaymentTarget.financialAccountId!==c.financialAccountId)continue;
  const paymentMembers=roots.get(pr),creditMembers=roots.get(cr);
  if(paymentMembers.some(o=>key(o)!==key(p)&&(!(o.statementFlow||o.bankStatement)||o.financialAccountId!==a.id||o.direction!=='debit'||o.amountMinor!==p.amountMinor||o.currency!==p.currency||o.date!==p.date||!['expense','transfer','debt_payment','unknown'].includes(o.kind)))||creditMembers.some(o=>key(o)!==key(c)))continue;
  const separateCost=rows.some(o=>o.date===p.date&&o.id!==p.id&&o.direction==='debit'&&o.amountMinor===m.netCostMinor&&o.currency===p.currency&&(o.kind==='fee'||/\u624b\u7eed\u8d39|\u8fd8\u6b3e\u8d39\u7528/.test(o.description||''))&&(o.financialAccountId===a.id||payer(o)?.id===a.id));if(separateCost)continue;
  results.push({...m,payerAccountId:a.id,method:'wechat_credit_repayment_net_cost',confidence:'inferred_from_actual_gross_and_card_receipt',composition:'net_cost_only',ruleUrl,evidence:{sourceAccountId:a.id,targetAccountId:c.financialAccountId,grossPaidMinor:p.amountMinor,cardReceivedMinor:c.amountMinor,netCostMinor:m.netCostMinor,standardCostCapMinor:m.standardCostCapMinor,composition:'net_cost_only',reciprocalUnique:true,originalTradeDate:p.date,sourceObservationIds:[p.id,c.id],ruleUrl}});
 }
 return results;
}
module.exports={findWechatCreditRepaymentCosts};
