'use strict';
// Imported counter-account fields contain masked identifiers only. A tail by
// itself is not ownership evidence: require its named institution as well.
function statementCounterAccount(record,accounts){
 const raw=record.rawFields||{},number=String(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7']||raw['\u5bf9\u65b9\u8d26\u53f7']||raw.counterAccount||''),institution=String(raw['\u5bf9\u65b9\u5f00\u6237\u884c']||raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').replace(/\s/g,''),tail=number.match(/(\d{4})\)?$/)?.[1];
 if(!tail||!institution)return null;
 const matches=accounts.filter(a=>a.id!==record.financialAccountId&&a.currency===record.currency&&a.status!=='archived'&&String(a.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1]===tail&&a.provider&&institution.includes(String(a.provider).normalize('NFKC').replace(/\s/g,'')));
 return matches.length===1?matches[0]:null;
}
function annotatedCounterAccount(record,annotation,accounts){
 const patch=annotation?.patch,prefix='\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff1a';
 if(record.status!=='completed'||!['credit','debit'].includes(record.direction)||patch?.kind!=='transfer'||typeof patch.category!=='string'||!patch.category.startsWith(prefix))return null;
 const label=patch.category.slice(prefix.length),matches=accounts.filter(a=>a.id!==record.financialAccountId&&a.status!=='archived'&&a.currency===record.currency&&a.label===label);
 return matches.length===1?matches[0]:null;
}
module.exports={statementCounterAccount,annotatedCounterAccount};
