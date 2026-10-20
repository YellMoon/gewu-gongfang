'use strict';

// Interpret explicit statement purposes in the projection. Original imported
// records remain untouched, and a bare payment/transfer label is insufficient.
function classifyBankPurpose(record){
  if(record.status==='completed'&&record.kind==='expense'&&record.direction==='debit'&&(record.bankStatement||record.statementFlow)&&/^\u6d88\u8d39\s+(?:\u8d22\u4ed8\u901a-)?\u5fae\u4fe1\u652f\u4ed8[:\uff1a]\u5fae\u4fe1\u8f6c\u8d26$/.test(String(record.description||'')))return {...record,kind:'transfer',automaticClassification:{method:'explicit_bank_wechat_transfer',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  if(record.status!=='completed'||record.kind!=='unknown')return record;
  const description=String(record.description||''),counterparty=String(record.counterparty||''),purpose=description+' '+counterparty;
  let kind,method;
  if(record.provider==='ccb'&&record.statementFlow?.schema==='ccb-debit-v1'){
    const summary=String(record.rawFields?.['\u6458\u8981']||''),remark=String(record.rawFields?.['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']||''),text=summary+' '+remark;
    if(record.direction==='debit'&&/^(?:ATM\u53d6\u6b3e|\u73b0\u91d1\u652f\u53d6)$/.test(summary)||record.direction==='credit'&&/^(?:ATM\u5b58\u6b3e|\u73b0\u91d1\u5b58\u5165)$/.test(summary)){
      kind='transfer';method='explicit_cash_movement';
    }else if(record.direction==='debit'&&/\u94f6\u884c\u8f6c\u8bc1\u5238/.test(text)||record.direction==='credit'&&/\u8bc1\u5238\u8f6c\u94f6\u884c/.test(text)){
      kind='transfer';method='explicit_securities_movement';
    }else if(record.direction==='credit'&&(/\u652f\u4ed8\u5b9d\u63d0\u73b0|\u4f59\u989d\u5b9d\u63d0\u73b0|\u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0|\u7406\u8d22\u901a\u8d4e\u56de|\u7406\u8d22\u4ea7\u54c1\u8d4e\u56de|\u57fa\u91d1\u8d4e\u56de|\u4f59\u989d\u5b9d\u8f6c\u51fa\u5230\u5361/.test(text)||summary==='\u652f\u4ed8\u673a\u6784\u63d0\u73b0'&&/\u652f\u4ed8\u5b9d|\u8d22\u4ed8\u901a/.test(counterparty))){
      kind='transfer';method='explicit_wallet_or_investment_withdrawal';
    }else if(record.direction==='debit'&&summary==='\u65e0\u5361\u81ea\u52a9\u4ea4\u6613'&&/^\(\u7279\u7ea6\)\u638c\u4e0a\u751f\u6d3b\u8fd8\u6b3e$/.test(remark)){
      kind='debt_payment';method='explicit_credit_card_repayment';
    }else if(record.direction==='debit'&&/\u4fe1\u7528\u5361\u8fd8\u6b3e/.test(text)){
      kind='debt_payment';method='explicit_credit_card_repayment';
    }else if(record.direction==='debit'&&/\u7406\u8d22\u4ea7\u54c1\u7533\u8d2d/.test(text)){
      kind='transfer';method='explicit_investment_subscription';
    }else if(record.direction==='debit'&&summary==='\u6570\u5b57\u4eba\u6c11\u5e01\u5151\u51fa'){
      kind='transfer';method='explicit_digital_cash_exchange';
    }else if(record.direction==='credit'&&summary==='\u501f\u5457\u653e\u6b3e'){
      kind='loan_drawdown';method='explicit_loan_drawdown';
    }
  }
  if(!kind&&record.statementFlow&&['mybank','huaxia','hangzhou'].includes(record.provider)){
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
  if(record.provider==='wechat'&&record.status==='completed'&&record.direction==='neutral'){
    const type=String(record.rawFields?.['交易类型']||'');
    // Personal exports use '/' for income/expense, even when the transaction
    // itself explicitly states which way cash moved. Preserve that raw label.
    if(record.kind==='debt_payment'&&type==='信用卡还款')return {...record,direction:'debit',automaticClassification:{method:'explicit_credit_repayment_outflow',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
    if(record.kind==='transfer'&&type==='零钱充值'&&/银行(?:储蓄卡|借记卡)?\(\d{4}\)$/.test(record.paymentChannel||''))return {...record,direction:'debit',automaticClassification:{method:'explicit_wallet_top_up',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  }
  if(record.status!=='completed'||record.kind!=='transfer'||record.direction!=='debit'||record.accountRelations?.length)return record;
  const description=String(record.description||''),category=String(record.category||''),type=String(record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']||'');
  // A merchant's phone/game/utility top-up buys a service. It does not move
  // money into the payer's own wallet, even though both use the word top-up.
  if(/(?:\u652f\u4ed8\u5b9d|\u5fae\u4fe1|\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d).*\u5145\u503c|\u5145\u503c.*(?:\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d)/.test(description))return record;
  const merchant=record.provider==='wechat'&&type==='\u5546\u6237\u6d88\u8d39';
  const service=record.provider==='alipay'&&['\u5145\u503c\u7f34\u8d39','\u6587\u5316\u4f11\u95f2','\u6559\u80b2\u57f9\u8bad','\u7231\u8f66\u517b\u8f66'].includes(category)&&/\u5145\u503c/.test(category+' '+description);
  return merchant||service?{...record,kind:'expense',automaticClassification:{method:'explicit_merchant_service_payment',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}}:record;
}

function legacyRefundPending(record){return record.provider==='wechat'&&record.status==='pending'&&(record.rawFields?.['\u5f53\u524d\u72b6\u6001']||record.rawFields?.['\u4ea4\u6613\u72b6\u6001'])==='\u5df2\u8f6c\u5165\u9000\u6b3e';}
module.exports={classifyBankPurpose,classifyPlatformPurpose,nonCashAuthorization,legacyRefundPending};
