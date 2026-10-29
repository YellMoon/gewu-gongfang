'use strict';
const {actualSecond}=require('./mixedPayments');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a)/,'');
const provisional='\u63a8\u7b97\u672c\u4eba\u652f\u4ed8\u5b9d\u8d44\u91d1\u8f6c\u56de\uff08\u7528\u6237\u6388\u6743\u3001\u6765\u6e90\u4ea7\u54c1\u672a\u6807\u660e\uff09';
function amountMatches(raw,minor){if(typeof raw!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(raw)||typeof minor!=='string'||!/^\d+$/.test(minor))return false;const [whole,fraction='']=raw.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))===BigInt(minor);}
function nativeWithdrawal(p){const r=p.rawFields||{};return p.provider==='alipay'&&p.status==='completed'&&p.currency==='CNY'&&['neutral','debit'].includes(p.direction)&&amountMatches(r['\u91d1\u989d'],p.amountMinor)&&BigInt(p.amountMinor)>0n&&actualSecond(p)&&r['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&r['\u5546\u54c1\u8bf4\u660e']===p.description&&r['\u4ea4\u6613\u5bf9\u65b9']===p.counterparty&&r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===p.paymentChannel&&p.sourceTransactionId&&r['\u4ea4\u6613\u8ba2\u5355\u53f7']===p.sourceTransactionId&&/\u8f6c\u51fa\u5230\u94f6\u884c\u5361|\u63d0\u73b0|\u8f6c\u8d26\u5230\u94f6\u884c\u5361/.test(p.description);}
function nativeReceipt(b,am,disbursement=false){
 const a=am.get(b.financialAccountId),r=b.rawFields||{},f=b.statementFlow;
 const title=disbursement?/^总对总代发:AL\*{4}\d{4}$/.test(b.description):b.description==='支付宝款项';
 return title&&b.provider==='ccb'&&b.status==='completed'&&b.currency==='CNY'&&b.direction==='credit'
  &&/^\d+$/.test(b.amountMinor)&&BigInt(b.amountMinor)>0n&&f?.schema==='ccb-debit-v1'&&f.incomeMinor===b.amountMinor&&f.expenseMinor==='0'
  &&a?.status==='active'&&a.type==='debit_card'&&a.currency===b.currency&&norm(a.provider)==='建设银行'&&/^\d{4}$/.test(a.maskedIdentifier||'')
  &&r.dateBasis==='transaction_date'&&r['交易日期']===b.date.replace(/-/g,'')&&r['摘要']===b.description&&r['交易地点/附言']===b.description
  &&/^支付宝\(中国\)网络技术有限公司客户备付金$/.test(String(b.counterparty).normalize('NFKC'))
  &&r['对方账号与户名']===r['对方账号']+'/'+b.counterparty&&amountMatches(String(r['交易金额']||'').replace(/,/g,''),b.amountMinor)
  &&(!disbursement||f.timePrecision==='day'&&r.timePrecision==='day'&&b.occurredAt===b.date+'T23:59:59+08:00')
  &&(!b.bankAccount||b.bankAccount.type==='debit_card'&&b.bankAccount.currency===b.currency&&b.bankAccount.maskedIdentifier===a.maskedIdentifier&&norm(b.bankAccount.provider)===norm(a.provider));
}
function nativeOwnerReceipt(b,am,owner){
 const a=am.get(b.financialAccountId),r=b.rawFields||{},f=b.statementFlow,name=String(owner||'').normalize('NFKC').trim(),counter=String(b.counterparty||'').normalize('NFKC');
 return !!name&&b.provider==='ccb'&&b.status==='completed'&&b.currency==='CNY'&&b.direction==='credit'&&/^\d+$/.test(b.amountMinor)&&BigInt(b.amountMinor)>0n
  &&f?.schema==='ccb-debit-v1'&&f.incomeMinor===b.amountMinor&&f.expenseMinor==='0'&&f.timePrecision==='day'&&r.timePrecision==='day'
  &&a?.status==='active'&&a.type==='debit_card'&&a.currency===b.currency&&norm(a.provider)==='\u5efa\u8bbe\u94f6\u884c'&&/^\d{4}$/.test(a.maskedIdentifier||'')
  &&r.dateBasis==='transaction_date'&&r['\u4ea4\u6613\u65e5\u671f']===b.date.replace(/-/g,'')&&b.date===b.occurredAt?.slice(0,10)
  &&r['\u6458\u8981']===name&&r['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']===name&&b.description===name
  &&/^\*{4}\d{4}\/\u652f\u4ed8\u5b9d\(\u4e2d\u56fd\)\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8$/.test(counter)&&r['\u5bf9\u65b9\u8d26\u53f7\u4e0e\u6237\u540d']===b.counterparty
  &&amountMatches(String(r['\u4ea4\u6613\u91d1\u989d']||'').replace(/,/g,''),b.amountMinor)
  &&(!b.bankAccount||b.bankAccount.type==='debit_card'&&b.bankAccount.currency===b.currency&&b.bankAccount.maskedIdentifier===a.maskedIdentifier&&norm(b.bankAccount.provider)===norm(a.provider));
}
function findSourceNamedProductBankReceipts(observations,accounts,{rootOf=id=>id,fundingAccount=()=>null,annotatedIds=new Set(),annotations=new Map(),links=[],statementOwners=new Map()}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a])),latest=new Map();for(const o of observations)if(!latest.has(identity(o))||(o.sourceVersionOrdinal||0)>(latest.get(identity(o)).sourceVersionOrdinal||0))latest.set(identity(o),o);
 const rows=[...latest.values()],roots=new Map();for(const o of rows){const r=rootOf(o.id);if(!roots.has(r))roots.set(r,[]);roots.get(r).push(o);}
 const decisions=new Map();for(const id of annotatedIds){const o=byId.get(id);if(!o)continue;const k=identity(o);if(!decisions.has(k))decisions.set(k,[]);decisions.get(k).push(annotations.get(id));}
 const purposeOnly=o=>(decisions.get(identity(o))||[]).every(a=>a&&!a.reset&&a.patch?.kind==='transfer'&&a.patch.category===provisional&&Object.keys(a.patch).every(k=>['kind','category'].includes(k)));
 const rootBlocked=(r,bank=false)=>(roots.get(r)||[]).some(o=>decisions.has(identity(o))&&(!bank||!purposeOnly(o)));
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 const blocked=(p,b)=>{const keys=new Set([...(roots.get(rootOf(p.id))||[]),...(roots.get(rootOf(b.id))||[])].map(identity));return vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?ids.some(id=>keys.has(id)):ids.length===l.observationIds.length&&ids.every(id=>keys.has(id));});};
 const ownerReceipts=new Set(rows.filter(b=>nativeOwnerReceipt(b,am,statementOwners.get(b.id))).map(b=>b.id));
 const disbursements=new Set(rows.filter(b=>nativeReceipt(b,am,true)).map(b=>b.id)),settlements=new Map(rows.map(p=>[p.id,require('./fundSettlementCalendar2015').ordinaryYuebaoSettlement2015(p)]));
 const ps=rows.filter(nativeWithdrawal),bs=rows.filter(b=>nativeReceipt(b,am)||ownerReceipts.has(b.id)||disbursements.has(b.id)),forward=new Map(),reverse=new Map(),evidence=new Map();
 // Every native withdrawal competes, including another product, an already
 // associated source, or an owner-edited source. Never obtain uniqueness by
 // removing an inconvenient decision or an occupied candidate first.
 for(const p of ps)for(const b of bs){const lag=Date.parse(b.date)-Date.parse(p.date);const delayed=disbursements.has(b.id);if((delayed?lag<0||lag>14*86400000:p.date!==b.date&&!(lag===86400000&&ownerReceipts.has(b.id)))||p.amountMinor!==b.amountMinor||p.currency!==b.currency)continue;const account=am.get(b.financialAccountId),known=fundingAccount(p,accounts),destination=p.withdrawalDestination?.financialAccountId;if(known&&known.id!==account.id||destination&&destination!==account.id||/\u94f6\u884c$/.test(p.counterparty)&&norm(p.counterparty)!==norm(account.provider))continue;const pr=rootOf(p.id),br=rootOf(b.id);if(pr===br)continue;if(!forward.has(pr))forward.set(pr,new Set());if(!reverse.has(br))reverse.set(br,new Set());forward.get(pr).add(br);reverse.get(br).add(pr);evidence.set(JSON.stringify([pr,br]),{platform:p,bank:b});}
 const matches=[];
 for(const [pr,bankRoots]of forward){if(bankRoots.size!==1)continue;const br=[...bankRoots][0];if(reverse.get(br).size!==1)continue;const {platform:p,bank:b}=evidence.get(JSON.stringify([pr,br])),relation=p.accountRelations?.length===1?p.accountRelations[0]:null,product=am.get(relation?.financialAccountId),bank=am.get(b.financialAccountId);
  if(disbursements.has(b.id)&&(!settlements.get(p.id)||b.date!==settlements.get(p.id).dueDate)||p.kind!=='transfer'||p.description!=='\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u94f6\u884c\u5361'||norm(p.counterparty)!==norm(bank.provider)||relation?.product!=='alipay_yuebao'||relation.activity!=='investment_withdrawal'||relation.role!=='target'||product?.status!=='active'||product.sourceProduct!=='alipay_yuebao'||product.type!=='investment'||product.currency!==p.currency||!['transfer','unknown'].includes(b.kind)||rootBlocked(pr)||rootBlocked(br,true)||blocked(p,b))continue;
  if(roots.get(pr).some(o=>identity(o)!==identity(p))||roots.get(br).some(o=>identity(o)!==identity(b)))continue;
  matches.push({platform:p,bank:b,evidence:{product:'alipay_yuebao',productAccountId:product.id,financialAccountId:bank.id,bankCardTail:bank.maskedIdentifier,date:p.date,bankReceiptDate:b.date,amountMinor:p.amountMinor,currency:p.currency,bankProductNamed:false,sourceProductNamed:true,bankChannel:'alipay',bankDateBasis:'transaction_date',reciprocalUnique:true,sourceObservationIds:[p.id,b.id],preservedPurposeAnnotationIds:(decisions.get(identity(b))||[]).map(a=>a.id),...(disbursements.has(b.id)?{bankReceiptFormat:'alipay_clearing_disbursement',settlementLagDays:(Date.parse(b.date)-Date.parse(p.date))/86400000,settlementRule:settlements.get(p.id),sharedOrderReference:false,preserveOriginalCashDates:true}:{}),...(ownerReceipts.has(b.id)?{bankReceiptFormat:'owner_named_alipay_clearing',verifiedStatementOwner:statementOwners.get(b.id),settlementLagDays:(Date.parse(b.date)-Date.parse(p.date))/86400000}:{} )}});
 }
 return matches;
}
module.exports={findSourceNamedProductBankReceipts};
