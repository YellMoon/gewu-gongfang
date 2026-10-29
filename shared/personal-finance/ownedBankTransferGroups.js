'use strict';
function findOwnedBankTransferGroups(observations,accounts,{annotatedIds=new Set(),matchedObservationIds=new Set(),statementOwners=new Map(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),map=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),blocked=new Set([...annotatedIds,...matchedObservationIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const rows=[...latest.values()].filter(o=>o.status==='completed'&&o.statementFlow&&['unknown','transfer'].includes(o.kind)&&!blocked.has(identity(o))&&map.get(o.financialAccountId)?.status==='active'&&map.get(o.financialAccountId)?.type==='debit_card'),proposals=[];
 const groups=new Map();
 for(const d of rows){
  const owner=statementOwners.get(d.id),raw=d.rawFields||{},tail=String(raw.counterAccount||raw['对方账号']||'').match(/(\d{4})$/)?.[1];
  if(d.direction!=='debit'||!owner||d.counterparty!==owner||!tail||!/汇兑|网转|互联汇出|转账/.test(d.description))continue;
  const targets=accounts.filter(a=>a.id!==d.financialAccountId&&a.status==='active'&&a.type==='debit_card'&&a.currency===d.currency&&String(a.maskedIdentifier||'').endsWith(tail));if(targets.length!==1||targets[0].provider!=='浦发银行')continue;
  const target=targets[0],key=JSON.stringify([d.financialAccountId,target.id,d.date,d.amountMinor,d.currency,owner]);if(!groups.has(key))groups.set(key,{sourceAccountId:d.financialAccountId,targetAccountId:target.id,date:d.date,amountMinor:d.amountMinor,currency:d.currency,owner,debits:[]});groups.get(key).debits.push(d);
 }
 for(const g of groups.values()){
  if(g.debits.length<2||g.debits.length>32)continue;
  const credits=rows.filter(c=>c.financialAccountId===g.targetAccountId&&c.provider==='spdb'&&c.statementFlow.schema==='spdb-debit-v1'&&c.direction==='credit'&&c.date===g.date&&c.amountMinor===g.amountMinor&&c.currency===g.currency&&c.description==='银联入账:'+g.owner&&c.rawFields?.['交易名称']===c.description&&c.counterparty==='待收银行卡跨行往来垫款');
  if(credits.length!==g.debits.length||credits.some(c=>statementOwners.get(c.id)!==g.owner))continue;const members=[...g.debits,...credits],keys=new Set(members.map(identity));
  if(links.some(l=>((l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type))||(l.status==='deleted'&&l.type==='duplicate'))&&l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o)))))continue;
  proposals.push({...g,credits,observationIds:members.map(o=>o.id),method:'balanced_owned_bank_transfer_group',confidence:'inferred',count:g.debits.length,individualIdentity:'undetermined'});
 }
 const uses=new Map();for(const g of proposals)for(const id of g.observationIds)uses.set(identity(byId.get(id)),(uses.get(identity(byId.get(id)))||0)+1);
 return proposals.filter(g=>g.observationIds.every(id=>uses.get(identity(byId.get(id)))===1));
}
module.exports={findOwnedBankTransferGroups};
