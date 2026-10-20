'use strict';

// Interpret explicit statement purposes in the projection. Original imported
// records remain untouched, and a bare payment/transfer label is insufficient.
function classifyBankPurpose(record){
  if(record.status!=='completed'||record.kind!=='unknown')return record;
  const description=String(record.description||''),counterparty=String(record.counterparty||''),purpose=description+' '+counterparty;
  let kind,method;
  if(record.statementFlow&&['mybank','huaxia','hangzhou'].includes(record.provider)){
    if(record.direction==='credit'&&/\u5fae\u4fe1.*\u63d0\u73b0/.test(purpose)&&/\u8d22\u4ed8\u901a/.test(counterparty)){
      kind='transfer';method='explicit_wechat_withdrawal';
    }else if(record.direction==='credit'&&(/\u65e5\u65e5\u76c8.*\u8d4e\u56de/.test(purpose)||record.provider==='mybank'&&/\u8d4e\u56de/.test(counterparty)||/\u57fa\u91d1.*\u8d4e\u56de/.test(purpose))){
      kind='transfer';method='explicit_investment_redemption';
    }else if(record.direction==='debit'&&(/\u65e5\u65e5\u76c8.*(?:\u8d2d\u4e70|\u7533\u8d2d)|\u57fa\u91d1\u7533\u8d2d/.test(purpose))){
      kind='transfer';method='explicit_investment_subscription';
    }else if(record.direction==='debit'&&/\u4fe1\u7528\u5361.*\u8fd8\u6b3e/.test(purpose)){
      kind='debt_payment';method='explicit_credit_card_repayment';
    }
  }
  return kind?{...record,kind,automaticClassification:{method,confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}}:record;
}

function nonCashAuthorization(record){
  if(record.provider==='psbc'&&record.statementFlow?.schema==='psbc-debit-v1'&&record.status==='completed'&&record.direction==='neutral'&&record.amountMinor==='0'&&record.balanceMinor==='0'&&record.description==='\u73b0\u91d1\u5f00\u5361')return true;
  if(!['alipay','wechat'].includes(record.provider)||record.direction!=='neutral'||record.kind!=='unknown')return false;
  const status=String(record.rawFields?.['\u4ea4\u6613\u72b6\u6001']||record.rawFields?.['\u5f53\u524d\u72b6\u6001']||'');
  return /^(?:\u51bb\u7ed3\u6210\u529f|\u89e3\u51bb\u6210\u529f|\u829d\u9ebb\u514d\u62bc\u4e0b\u5355\u6210\u529f)$/.test(status);
}

function classifyPlatformPurpose(record){
  if(record.status!=='completed'||record.kind!=='transfer'||record.direction!=='debit'||record.accountRelations?.length)return record;
  const description=String(record.description||''),category=String(record.category||''),type=String(record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']||'');
  // A merchant's phone/game/utility top-up buys a service. It does not move
  // money into the payer's own wallet, even though both use the word top-up.
  if(/(?:\u652f\u4ed8\u5b9d|\u5fae\u4fe1|\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d).*\u5145\u503c|\u5145\u503c.*(?:\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d)/.test(description))return record;
  const merchant=record.provider==='wechat'&&type==='\u5546\u6237\u6d88\u8d39';
  const service=record.provider==='alipay'&&['\u5145\u503c\u7f34\u8d39','\u6587\u5316\u4f11\u95f2','\u6559\u80b2\u57f9\u8bad','\u7231\u8f66\u517b\u8f66'].includes(category)&&/\u5145\u503c/.test(category+' '+description);
  return merchant||service?{...record,kind:'expense',automaticClassification:{method:'explicit_merchant_service_payment',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}}:record;
}

module.exports={classifyBankPurpose,classifyPlatformPurpose,nonCashAuthorization};
