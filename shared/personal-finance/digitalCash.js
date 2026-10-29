'use strict';
function digitalCashExchange(record,accounts){
 if(record.provider!=='ccb'||record.status!=='completed'||record.statementFlow?.schema!=='ccb-debit-v1'||!['unknown','transfer'].includes(record.kind)||record.rawFields?.dateBasis!=='transaction_date'||record.rawFields?.['\u4ea4\u6613\u65e5\u671f']!==record.date.replace(/-/g,''))return null;
 const summary=record.rawFields?.['\u6458\u8981'],remark=record.rawFields?.['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00'];if(!(record.direction==='debit'&&summary==='\u6570\u5b57\u4eba\u6c11\u5e01\u5151\u51fa'||record.direction==='credit'&&summary==='\u6570\u5b57\u4eba\u6c11\u5e01\u5151\u5165')||remark!=='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8\u603b\u884c\u8d26\u52a1\u4e2d\u5fc3'||record.description!==summary+' '+remark)return null;
 const matches=accounts.filter(a=>a.status==='active'&&a.sourceProduct==='alipay_ecny'&&a.type==='wallet'&&a.currency===record.currency);return matches.length===1?matches[0]:null;
}
module.exports={digitalCashExchange};
