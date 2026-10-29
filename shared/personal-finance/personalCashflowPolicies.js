'use strict';
const INCOME='\u6682\u6309\u4e2a\u4eba\u6536\u5165\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09',EXPENSE='\u6682\u6309\u4e2a\u4eba\u652f\u51fa\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09';
const norm=v=>String(v||'').normalize('NFKC').trim(),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
function personalCashflowPolicies(observations,annotations,{ownerNames=[],accounts=[]}={}){
 const annotationOnlySettlementIds=new Set(accounts.filter(a=>a.counterpartySettlement?.scope==='annotation_only').map(a=>a.id));
 const byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),blockedSources=new Set(),protectedNames=new Set(ownerNames.map(norm)),rules=new Map(),conflicts=new Set(),families=new Map(),specificSettlementNames=new Set();
 for(const a of annotations)if(!latest.has(a.observationId)||BigInt(a.revision)>BigInt(latest.get(a.observationId).revision))latest.set(a.observationId,a);
 for(const name of [...protectedNames])if(name.length>=3){protectedNames.add(name.slice(0,2));protectedNames.add(name.slice(-2));}
 for(const [id,a]of latest){if(a.reset)continue;const o=byId.get(id);if(!o)continue;blockedSources.add(identity(o));const name=norm(o.counterparty);if(annotationOnlySettlementIds.has(a.patch?.settlementAccountId)){specificSettlementNames.add(name);for(const part of name.split(/[()]/).map(norm))if(/^\p{Script=Han}{2,4}$/u.test(part))specificSettlementNames.add(part);continue;}if(!name||/[*\uff0a\u00d7]/.test(name))continue;
  if(a.patch?.kind==='transfer'&&/\u5bb6\u5ead|\u672c\u4eba\u8d26\u6237/.test(a.patch.category||'')){protectedNames.add(name);if(name.length===3)protectedNames.add(name.slice(-2));}
  if(a.patch?.kind==='transfer'&&['\u5bb6\u5ead\u5185\u90e8\u5212\u8f6c\uff08\u7528\u6237\u786e\u8ba4\uff09','\u5bb6\u5ead\u5185\u90e8\u5212\u8f6c\uff08\u90ed\u96c5\u840d\uff0c\u7528\u6237\u786e\u8ba4\uff09'].includes(a.patch.category))families.set(name,{annotationId:a.id,observationId:o.id,category:a.patch.category});
  const personal=(a.patch?.kind==='income'&&a.patch.category===INCOME)||(a.patch?.kind==='expense'&&a.patch.category===EXPENSE);
  if(personal)rules.set(name,{annotationId:a.id,observationId:o.id});else conflicts.add(name);
 }
 const excluded=/\u94f6\u884c|\u91d1\u878d|\u652f\u4ed8|\u6e05\u7b97|\u8d22\u4ed8\u901a|\u57fa\u91d1|\u8bc1\u5238|\u7406\u8d22|\u4fdd\u9669|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u501f|\u8d37|\u8fd8\u6b3e|\u5229\u606f|\u672c\u91d1|\u5206\u671f|\u624b\u7eed\u8d39|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u63d0\u73b0|\u5145\u503c|\u9000\u6b3e|\u9000\u8d27|\u8fd4\u8fd8|\u672c\u4eba|\u81ea\u5df1\u8d26\u6237/;
 function authorizedWrappedName(o){
  if(!['alipay','wechat'].includes(o.provider)||o.rawFields?.['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||o.provider==='wechat'&&o.rawFields['\u4ea4\u6613\u7c7b\u578b']!=='\u8f6c\u8d26'||/[*\uff0a\u00d7]/.test(o.counterparty||'')||/\u8bfe\u7a0b|\u8bfe\u65f6|\u8bfe\u916c|\u5237\u8bfe|\u5237\u5355|\u4efb\u52a1|\u5b66\u8d39/.test([o.description,o.category].join(' ')))return null;
  const match=norm(o.counterparty).match(/^([^()]{1,80})\(([^()]{1,80})\)$/);if(!match)return null;
  const names=[...new Set(match.slice(1).map(s=>s.trim()).filter(s=>/^\p{Script=Han}{2,4}$/u.test(s)))];
  // A printed name can extend an existing purpose decision only. Family,
  // self, conflicting decisions and two separately authorized names veto it;
  // no payer account or person's identity is merged by this rule.
  if(names.some(s=>protectedNames.has(s)||conflicts.has(s)||specificSettlementNames.has(s)))return null;
  const applicable=names.filter(s=>rules.has(s));return applicable.length===1?{name:applicable[0],rule:rules.get(applicable[0])}:null;
 }
 return o=>{const name=norm(o.counterparty),prefix=o.direction==='debit'?'\u53d1\u7ed9':o.direction==='credit'?'\u6765\u81ea':null,person=prefix&&name.startsWith(prefix)?name.slice(prefix.length):null,family=families.get(person);
  // Old WeChat exports put a direction prefix in the person's name. Only an
  // exact, already owner-confirmed identity on a personal red packet qualifies;
  // merchant payments (including family-card consumption) are never rewritten.
  if(family&&!rules.has(person)&&o.provider==='wechat'&&o.status==='completed'&&['expense','income','transfer','unknown'].includes(o.kind)&&o.amountMinor!=='0'&&!blockedSources.has(identity(o))&&!o.accountRelations?.length&&!o.bankStatement&&!o.balanceEvidence&&o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u5fae\u4fe1\u7ea2\u5305'&&o.rawFields?.['\u4ea4\u6613\u5bf9\u65b9']===o.counterparty)
   return{...o,kind:'transfer',category:family.category,automaticClassification:{method:'owner_confirmed_family_person_prefix',confidence:'owner_confirmed_personal_counterparty',evidenceObservationIds:[family.observationId,o.id],policyAnnotationId:family.annotationId,counterpartyName:person}};
  const alias=rules.has(name)?null:authorizedWrappedName(o),rule=rules.get(name)||alias?.rule;if(!rule||protectedNames.has(name)||conflicts.has(name)||blockedSources.has(identity(o))||o.status!=='completed'||!['credit','debit'].includes(o.direction)||!['transfer','unknown'].includes(o.kind)||o.amountMinor==='0'||o.bankStatement||o.balanceEvidence||o.accountRelations?.length||excluded.test([o.description,name,o.category].join(' ')))return o;
  return {...o,kind:o.direction==='credit'?'income':'expense',category:o.direction==='credit'?INCOME:EXPENSE,automaticClassification:{method:'authorized_personal_counterparty_policy',confidence:'owner_authorized_provisional',evidenceObservationIds:[rule.observationId],policyAnnotationId:rule.annotationId,...(alias?{counterpartyAliasEvidence:{sourceCounterparty:o.counterparty,authorizedCounterparty:alias.name,sourceField:'\u4ea4\u6613\u5bf9\u65b9',purposePolicyOnly:true,noAccountOrIdentityMerge:true}}:{})}};
 };
}
module.exports={personalCashflowPolicies};
