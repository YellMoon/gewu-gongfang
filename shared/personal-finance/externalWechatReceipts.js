'use strict';
const norm=value=>String(value||'').normalize('NFKC').trim();
function externalWechatReceipt(record,{excludedCounterparties=[]}={}){
 const raw=record.rawFields||{},name=norm(record.counterparty);
 if(record.provider!=='wechat'||record.kind!=='transfer'||record.status!=='completed'||record.direction!=='credit'||record.amountMinor==='0'||record.accountRelations?.length||record.automaticClassification?.financialAccountId||record.bankStatement||record.balanceEvidence||!name)return record;
 if(raw['\u4ea4\u6613\u7c7b\u578b']!=='\u8f6c\u8d26'||raw['\u6536/\u652f']!=='\u6536\u5165'||raw['\u4ea4\u6613\u5bf9\u65b9']!==record.counterparty||!['\u5df2\u5b58\u5165\u96f6\u94b1','\u5df2\u6536\u94b1','\u5df2\u6536\u6b3e','\u6536\u6b3e\u6210\u529f','\u6536\u6b3e\u5230\u8d26'].includes(raw['\u5f53\u524d\u72b6\u6001']))return record;
 const protectedNames=[...excludedCounterparties].map(norm);
 if(protectedNames.some(n=>n&&(name===n||name.split(/[()]/).map(norm).includes(n)))||/\u672c\u4eba|\u81ea\u5df1|\u81ea\u5df1\u8d26\u6237/.test(name+' '+record.description))return record;
 const text=[record.description,record.category,name].join(' ');
 if(/\u501f\u6b3e|\u501f\u94b1|\u8d37\u6b3e|\u8fd8\u6b3e|\u8fd8\u94b1|\u672c\u91d1|\u9000\u6b3e|\u9000\u8d39|\u9000\u8fd8|\u8fd4\u8fd8|\u62a5\u9500|\u4ee3\u6536|\u4ee3\u4ed8|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u5145\u503c|\u63d0\u73b0|\u94f6\u884c|\u8bc1\u5238|\u7406\u8d22|\u57fa\u91d1/.test(text))return {...record,kind:'unknown',automaticClassification:{method:'external_wechat_receipt_purpose_unresolved',confidence:'explicit_source_receipt',evidenceObservationIds:[record.id]}};
 const teaching=/\u5b66\u8d39|\u8bfe\u65f6\u8d39|\u8865\u8bfe\u8d39|\u52a0\u8bfe/.test(record.description||'');
 return {...record,kind:'income',category:teaching?'\u6559\u5b66\u6536\u6b3e':record.category,automaticClassification:{method:teaching?'explicit_wechat_teaching_receipt':'explicit_wechat_external_receipt',confidence:'explicit_source_receipt',evidenceObservationIds:[record.id],sourceIncomeExpense:'\u6536\u5165',provisionalPurpose:!teaching}};
}
module.exports={externalWechatReceipt};
