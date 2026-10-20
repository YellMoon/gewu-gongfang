'use strict';
// Count a transaction once even when it has several diagnostic labels.
// An unrecognized statement purpose needs software analysis before asking the
// owner for evidence. Responsibility does not remove the unresolved transaction.
const SOFTWARE=new Set(['insufficient_reference','card_statement_overlap_requires_review','ambiguous_reference','mortgage_history_model_gap','unknown_kind']);
function buildReviewSummary(issues,transactions,accounts){
  const bySource=new Map(),accountIds=new Set(accounts.map(a=>a.id));
  for(const t of transactions)for(const id of t.observationIds)bySource.set(id,t);
  const groups=new Map(),affected=new Set(),software=new Set(),evidence=new Set();
  for(const issue of issues){
    const t=bySource.get(issue.observationId);
    if(!t&&(!issue.financialAccountId||!accountIds.has(issue.financialAccountId)))continue;
    const financialAccountId=issue.financialAccountId||t.financialAccountId;
    const owner=SOFTWARE.has(issue.reason)?'software':'evidence',key=JSON.stringify([owner,issue.reason,financialAccountId]);
    if(!groups.has(key))groups.set(key,{id:key,owner,reason:issue.reason,financialAccountId,transactionIds:new Set(),issues:[],startDate:null,endDate:null});
    const g=groups.get(key),id=t?.id||'account:'+financialAccountId;
    affected.add(id);(owner==='software'?software:evidence).add(id);
    g.transactionIds.add(id);
    g.issues.push(issue);
    if(t){if(!g.startDate||g.startDate>t.date)g.startDate=t.date;if(!g.endDate||g.endDate<t.date)g.endDate=t.date;}
  }
  const rows=[...groups.values()].map(g=>({...g,transactionIds:[...g.transactionIds],transactionCount:g.transactionIds.size}));
  return {transactionCount:affected.size,softwareTransactionCount:software.size,evidenceTransactionCount:evidence.size,softwareGroupCount:rows.filter(g=>g.owner==='software').length,evidenceGroupCount:rows.filter(g=>g.owner==='evidence').length,groups:rows};
}
module.exports={buildReviewSummary};
