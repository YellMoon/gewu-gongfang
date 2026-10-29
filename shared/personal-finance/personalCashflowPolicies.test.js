'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{personalCashflowPolicies}=require('./personalCashflowPolicies');
const source={id:'prior',financialAccountId:'wallet',provider:'alipay',counterparty:'\u6d4b\u8bd5\u4e59'},annotation={id:'decision',observationId:'prior',revision:'1',patch:{kind:'income',category:'\u6682\u6309\u4e2a\u4eba\u6536\u5165\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09'}},current={...source,id:'new',date:'2020-01-01',kind:'transfer',direction:'debit',status:'completed',amountMinor:'10000',description:'\u8f6c\u8d26',category:'\u8f6c\u8d26\u7ea2\u5305'};
test('an exact owner-authorized provisional contact rule follows the actual cash direction and retains its decision source',()=>{
 const apply=personalCashflowPolicies([source,current],[annotation]),before=JSON.stringify(current),expense=apply(current),income=apply({...current,direction:'credit'});assert.equal(expense.kind,'expense');assert.equal(income.kind,'income');assert.equal(expense.automaticClassification.policyAnnotationId,'decision');assert.equal(expense.automaticClassification.confidence,'owner_authorized_provisional');assert.equal(JSON.stringify(current),before);
});
test('a printed nickname and full name retain the existing authorized provisional cashflow scope without rewriting the original name',()=>{
 for(const [provider,name]of[['alipay','\u5c0f\u4e59(\u6d4b\u8bd5\u4e59)'],['alipay','\u6d4b\u8bd5\u4e59(\u6d4b\u8bd5\u4e59)'],['wechat','\u6d4b\u8bd5\u4e59 (Nickname)']]){
  const o={...current,provider,counterparty:name,rawFields:{'\u4ea4\u6613\u5bf9\u65b9':name,'\u4ea4\u6613\u7c7b\u578b':'\u8f6c\u8d26'}},before=JSON.stringify(o),apply=personalCashflowPolicies([source,o],[annotation]),result=apply(o);assert.equal(result.kind,'expense');assert.equal(result.category,'\u6682\u6309\u4e2a\u4eba\u652f\u51fa\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09');assert.equal(result.counterparty,name);assert.equal(result.automaticClassification.confidence,'owner_authorized_provisional');assert.equal(result.automaticClassification.policyAnnotationId,'decision');assert.equal(result.automaticClassification.counterpartyAliasEvidence.authorizedCounterparty,'\u6d4b\u8bd5\u4e59');assert.equal(apply({...o,direction:'credit'}).kind,'income');assert.equal(JSON.stringify(o),before);
 }
});
test('wrapped names do not infer masked identity, authorize a new person, override family/loan choices or classify course tasks',()=>{
 const named=name=>({...current,counterparty:name,rawFields:{'\u4ea4\u6613\u5bf9\u65b9':name,'\u4ea4\u6613\u7c7b\u578b':'\u8f6c\u8d26'}});
 for(const change of[o=>o.counterparty='Other(\u6d4b\u8bd5\u4e19)',o=>o.counterparty='**\u4e59(\u6d4b\u8bd5\u4e59)',o=>o.counterparty='Test(\u6d4b\u8bd5\u4e59)(nested)',o=>o.rawFields={},o=>o.provider='bank',o=>o.accountRelations=[{role:'funding'}],o=>o.description='\u5237\u8bfe\u4efb\u52a1\u57ab\u6b3e',o=>o.description='\u8d2d\u4e70\u8bfe\u7a0b',o=>o.description='\u501f\u6b3e',o=>o.status='failed']){const o=named('\u5c0f\u4e59(\u6d4b\u8bd5\u4e59)');change(o);if(o.rawFields['\u4ea4\u6613\u5bf9\u65b9'])o.rawFields['\u4ea4\u6613\u5bf9\u65b9']=o.counterparty;assert.equal(personalCashflowPolicies([source,o],[annotation])(o),o,change.toString());}
 const o=named('\u6d4b\u8bd5\u7532(\u6d4b\u8bd5\u4e59)');assert.equal(personalCashflowPolicies([source,o],[annotation],{ownerNames:['\u6d4b\u8bd5\u7532']})(o),o);
 const f={...source,id:'specific'},specific={id:'loan-decision',observationId:'specific',revision:'2',patch:{kind:'transfer',category:'\u501f\u8fd8\u6b3e'}};assert.equal(personalCashflowPolicies([source,o,f],[annotation,specific])(o),o);
 const other={...source,id:'other',counterparty:'\u6d4b\u8bd5\u7532'},choice={...annotation,id:'other-decision',observationId:'other'},both=named('\u6d4b\u8bd5\u7532(\u6d4b\u8bd5\u4e59)');assert.equal(personalCashflowPolicies([source,other,both],[annotation,choice])(both),both);
});
test('specific loans, investments, deposits, refunds, card statements, neutral movements and unconfirmed contacts are excluded',()=>{
 const apply=personalCashflowPolicies([source,current],[annotation]);for(const patch of [{description:'\u501f\u6b3e'},{description:'\u62bc\u91d1'},{description:'\u57fa\u91d1\u8d4e\u56de'},{description:'\u9000\u6b3e'},{direction:'neutral'},{kind:'debt_payment'},{status:'failed'},{counterparty:'\u53e6\u4e00\u4e2a\u4eba'},{accountRelations:[{role:'target'}]},{bankStatement:{}}]){const o={...current,...patch};assert.equal(apply(o),o);}
 assert.equal(personalCashflowPolicies([source,current],[])(current),current);assert.equal(personalCashflowPolicies([source,current],[{...annotation,patch:{kind:'income',category:'Manual income'}}])(current),current);
});
test('self and household identities, conflicting owner decisions, resets and older-source-version choices remain protected',()=>{
 assert.equal(personalCashflowPolicies([source,current],[annotation],{ownerNames:['\u6d4b\u8bd5\u4e59']})(current),current);
 const old={...source,id:'family'},family={id:'family-choice',observationId:'family',revision:'2',patch:{kind:'transfer',category:'\u5bb6\u5ead\u5185\u90e8\u5212\u8f6c'}};assert.equal(personalCashflowPolicies([source,current,old],[annotation,family])(current),current);
 assert.equal(personalCashflowPolicies([source,current],[annotation,{id:'reset',observationId:'prior',revision:'2',reset:true}])(current),current);
 const earlier={...source,sourceIdentity:'same'},newer={...current,sourceIdentity:'same',sourceVersionOrdinal:2};assert.equal(personalCashflowPolicies([earlier,newer],[annotation])(newer),newer);
});
test('a partially masked display name never becomes a shared contact identity or household exclusion',()=>{
 for(const name of ['**\u7ea2','\u6797*\u7ea2','\uff0a\uff0a\u7ea2','\u00d7\u00d7\u7ea2']){const prior={...source,counterparty:name},next={...current,counterparty:name},family={...annotation,patch:{kind:'transfer',category:'\u5bb6\u5ead\u7f51\u5e97\u5468\u8f6c\u6b3e'}};assert.equal(personalCashflowPolicies([prior,next],[annotation])(next),next,'an individual provisional choice cannot spread to another person with the same masked label');assert.equal(personalCashflowPolicies([prior,next],[family])(next),next);}
});
test('a previously assigned task or lending settlement prevents expanding a personal rule through a wrapped name',()=>{
 const o={...current,counterparty:'Nickname(\u6d4b\u8bd5\u4e59)',rawFields:{'\u4ea4\u6613\u5bf9\u65b9':'Nickname(\u6d4b\u8bd5\u4e59)'}},task={...source,id:'task-source'},specific={id:'task-choice',observationId:'task-source',revision:'2',patch:{kind:'transfer',settlementAccountId:'task',category:'Historical course task'}},accounts=[{id:'task',counterpartySettlement:{scope:'annotation_only'}}],apply=personalCashflowPolicies([source,current,o,task],[annotation,specific],{accounts});assert.equal(apply(o),o);assert.equal(apply(current).kind,'expense','the original exact-name policy remains unchanged');
});
test('an explicitly named teaching remuneration keeps its specific purpose when the recipient is wrapped',()=>{
 const o={...current,counterparty:'Teacher(\u6d4b\u8bd5\u4e59)',description:'2016\u5e745\u6708\u4efd\u8bfe\u916c',rawFields:{'\u4ea4\u6613\u5bf9\u65b9':'Teacher(\u6d4b\u8bd5\u4e59)'}};assert.equal(personalCashflowPolicies([source,o],[annotation])(o),o);
});
