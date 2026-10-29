'use strict';
// Imported counter-account fields contain masked identifiers only. A tail by
// itself is not ownership evidence: require its named institution as well.
// Official name change; this compares institutions only. Currency, card tail
// and unique ownership still decide the account. No bank accounts are merged.
// https://www.zj96596.com/zj96596/2024-11/06/article_2024110615400082532.shtml
const zhejiangRuralNames=new Set(['浙江省农村信用社联合社','浙江农村商业联合银行股份有限公司','浙江农商联合银行']);
function sameStatementInstitution(institution,provider){return institution.includes(provider)||zhejiangRuralNames.has(institution)&&zhejiangRuralNames.has(provider);}
function statementCounterAccount(record,accounts){
 const raw=record.rawFields||{},number=String(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7']||raw['\u5bf9\u65b9\u8d26\u53f7']||raw.counterAccount||''),institution=String(raw['\u5bf9\u65b9\u5f00\u6237\u884c']||raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').replace(/\s/g,''),tail=number.match(/(\d{4})\)?$/)?.[1];
 if(!tail||!institution)return null;
 const matches=accounts.filter(a=>a.id!==record.financialAccountId&&a.currency===record.currency&&a.status!=='archived'&&String(a.maskedIdentifier||'').match(/(\d{4})\)?$/)?.[1]===tail&&a.provider&&sameStatementInstitution(institution,String(a.provider).normalize('NFKC').replace(/\s/g,'')));
 return matches.length===1?matches[0]:null;
}
function annotatedCounterAccount(record,annotation,accounts){
 const patch=annotation?.patch,prefixes=['\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff1a','\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff08\u7528\u6237\u56de\u5fc6\uff0c\u53ef\u4fee\u6539\uff09\uff1a'],prefix=prefixes.find(p=>typeof patch?.category==='string'&&patch.category.startsWith(p));
 if(record.status!=='completed'||!['credit','debit'].includes(record.direction)||patch?.kind!=='transfer'||!prefix)return null;
 const label=patch.category.slice(prefix.length),matches=accounts.filter(a=>a.id!==record.financialAccountId&&a.status!=='archived'&&a.currency===record.currency&&a.label===label);
 return matches.length===1?matches[0]:null;
}
module.exports={statementCounterAccount,annotatedCounterAccount};
