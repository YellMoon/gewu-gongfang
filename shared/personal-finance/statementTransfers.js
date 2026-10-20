'use strict';
function payerCardTail(record){
 const raw=record.rawFields||{},explicit=String(raw['\u4ed8\u6b3e\u5c3e\u53f7']||raw.payerCardTail||'');
 if(/^\d{4}$/.test(explicit))return explicit;
 const text=String(record.description||'').normalize('NFKC');
 const labelled=text.match(/(?:\u4ed8\u6b3e(?:\u5361|\u8d26\u53f7)?(?:\u5c3e\u53f7)?|\u8fd8\u6b3e\u5361\u5c3e\u53f7)[\s:]*[*xX]*(\d{4})(?!\d)/);
 if(labelled)return labelled[1];
 // These statement formats end the remittance description with the payer's
 // card tail. Do not extract four digits from arbitrary merchants/references.
 return /\u94f6\u8054\u5165\u8d26|\u8f6c\u8d26\u8fd8\u6b3e-\u94f6\u8054/.test(text)?text.match(/(?:^|\D)(\d{4})\s*$/)?.[1]||null:null;
}
function findStatementRepayments(observations,accounts,{rootOf=id=>id,isBlocked=()=>false,annotatedIds=new Set()}={}){
 const byAccount=new Map(accounts.map(a=>[a.id,a])),debits=new Map(),matches=new Map(),reverse=new Map(),evidence=new Map();
 for(const d of observations){if(!d.statementFlow||d.direction!=='debit'||d.status!=='completed'||!['unknown','transfer','debt_payment'].includes(d.kind)||annotatedIds.has(d.id))continue;const tail=String(byAccount.get(d.financialAccountId)?.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1];if(!tail)continue;const k=JSON.stringify([d.date,d.amountMinor,d.currency,tail]);if(!debits.has(k))debits.set(k,[]);debits.get(k).push(d);}
 for(const c of observations){
  if(!c.bankStatement||c.direction!=='credit'||c.kind!=='debt_payment'||c.status!=='completed'||byAccount.get(c.financialAccountId)?.type!=='credit_card'||annotatedIds.has(c.id))continue;
  const tail=payerCardTail(c);if(!tail)continue;
  for(const d of debits.get(JSON.stringify([c.date,c.amountMinor,c.currency,tail]))||[]){
   const cr=rootOf(c.id),dr=rootOf(d.id);if(cr===dr||isBlocked(c.id,d.id))continue;
   if(!matches.has(cr))matches.set(cr,new Set());if(!reverse.has(dr))reverse.set(dr,new Set());matches.get(cr).add(dr);reverse.get(dr).add(cr);evidence.set(JSON.stringify([cr,dr]),{credit:c,debit:d});
  }
 }
 const result=[];for(const [cr,ds] of matches)if(ds.size===1){const dr=[...ds][0];if(reverse.get(dr).size===1)result.push(evidence.get(JSON.stringify([cr,dr])));}return result;
}
module.exports={payerCardTail,findStatementRepayments};
