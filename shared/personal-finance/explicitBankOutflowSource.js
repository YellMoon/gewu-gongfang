'use strict';
const {actualSecond}=require('./mixedPayments');
// A successful withdrawal identifies the source wallet even when its receiving
// card is absent. A transfer's named payment channel identifies its source only.
// Neither fact supplies a receiving bank, net receipt or a zero fee.
function explicitBankOutflowSource(o,accounts){
 if(o.provider!=='alipay'||o.status!=='completed'||o.kind!=='transfer'||o.direction!=='neutral'||o.paymentAccountHint
   ||!actualSecond(o)||BigInt(o.amountMinor)<=0n||o.accountRelations?.length||o.investmentTrade||o.brokerage)return null;
 const source=accounts.find(a=>a.id===o.financialAccountId),raw=o.rawFields||{};
 if(source?.type!=='wallet'||source.status!=='active'||source.provider!=='alipay'||source.currency!==o.currency
   ||raw['\u5546\u54c1\u8bf4\u660e']!==o.description||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'
   ||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel)return null;
 const balance=['\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d'].includes(o.paymentChannel);
 const withdrawal=/^\u63d0\u73b0-(?:\u5feb\u901f|\u5b9e\u65f6|\u666e\u901a)\u63d0\u73b0$/.test(o.description)&&/\u94f6\u884c$/.test(o.counterparty)&&(!o.paymentChannel||balance);
 const bankTransfer=o.description==='\u8f6c\u8d26\u5230\u94f6\u884c\u5361-\u8f6c\u8d26';
 if(!withdrawal&&!bankTransfer)return null;
 let account=source,basis='explicit_withdrawal_from_platform_wallet';
 if(!withdrawal){basis='explicit_bank_transfer_named_funding';if(!balance){if(o.paymentChannel!=='\u4f59\u989d\u5b9d')return null;const funds=accounts.filter(a=>a.status==='active'&&a.type==='investment'&&a.sourceProduct==='alipay_yuebao'&&a.currency===o.currency);if(funds.length!==1)return null;account=funds[0];}}
 return{financialAccountId:account.id,amountMinor:o.amountMinor,method:'explicit_bank_outflow_source',confidence:'explicit_original_payment_purpose',basis,evidenceObservationIds:[o.id],receivingAccountKnown:false,feeKnown:false};
}
module.exports={explicitBankOutflowSource};
