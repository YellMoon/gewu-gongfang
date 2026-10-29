'use strict';
const minor=value=>{const m=String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);return m?String(BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))):null;};
function parseWechatServiceFeeRemark(value){
 const m=String(value||'').trim().match(/^\u670d\u52a1\u8d39[\u00a5\uffe5](\d+(?:\.\d{1,2})?)$/);
 return m?minor(m[1]):null;
}
// Interpret the original withdrawal row only. A blank note is not a zero fee.
function wechatStatementFee(record){
 const raw=record.rawFields||{},fee=parseWechatServiceFeeRemark(raw['\u5907\u6ce8']);
 if(record.provider!=='wechat'||record.status!=='completed'||record.currency!=='CNY'||record.kind!=='transfer'||!['neutral','debit'].includes(record.direction)||raw['\u4ea4\u6613\u7c7b\u578b']!=='\u96f6\u94b1\u63d0\u73b0'||raw['\u5f53\u524d\u72b6\u6001']!=='\u63d0\u73b0\u5df2\u5230\u8d26'||raw['\u4ea4\u6613\u5355\u53f7']!==record.sourceTransactionId||raw['\u4ea4\u6613\u65f6\u95f4']!==record.occurredAt?.slice(0,19).replace('T',' ')||minor(raw['\u91d1\u989d(\u5143)'])!==record.amountMinor||fee===null||record.feeMinor!==fee||BigInt(fee)>=BigInt(record.amountMinor))return null;
 return {schema:'wechat-original-statement-fee-v1',sourceObservationId:record.id||null,grossMinor:record.amountMinor,feeMinor:fee,netMinor:String(BigInt(record.amountMinor)-BigInt(fee)),originalRemark:raw['\u5907\u6ce8'],confidence:'explicit_original_statement',reversible:true};
}
module.exports={parseWechatServiceFeeRemark,wechatStatementFee};
