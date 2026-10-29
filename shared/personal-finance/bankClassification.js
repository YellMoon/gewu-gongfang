'use strict';

function teachingCashPurpose(record){
  if(record.direction!=='debit'||/\u501f\u6b3e|\u8d37\u6b3e|\u624b\u7eed\u8d39|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(record.description||''))return null;
  if(/\u5b66\u8d39.*(?:\u9000\u6b3e|\u9000\u8d39)|(?:\u9000\u6b3e|\u9000\u8d39).*\u5b66\u8d39|\u6069\u8d1d\u5854\u5b66\u5458.+\u9000\u8d39/.test(record.description||''))return {kind:'income',method:'explicit_tuition_income_return'};
  if(/\d{4}\u5e74\d{1,2}\u6708(?:\u4efd)?(?:\u7684)?\u8bfe\u916c/.test(record.description||'')&&!/\u9000\u6b3e|\u9000\u8d39|\u8fd4\u8fd8|\u9000\u8fd8/.test(record.description||''))return {kind:'expense',method:'explicit_tutor_payment'};
  return null;
}

// Interpret explicit statement purposes in the projection. Original imported
// records remain untouched, and a bare payment/transfer label is insufficient.
function classifyBankPurpose(record,{statementOwner}={}){
  if(record.provider==='hangzhou'&&record.statementFlow?.schema==='hangzhou-debit-v1'&&record.status==='completed'){
    const namedCreditRepayment=record.kind==='expense'&&record.direction==='debit'&&record.description==='\u6d88\u8d39'&&String(record.counterparty||'').normalize('NFKC')==='\u5e7f\u53d1\u4fe1\u7528\u5361\u8fd8\u6b3e(\u6df1\u5733)'&&record.rawFields?.description===record.description&&record.rawFields?.counterparty===record.counterparty;
    if(namedCreditRepayment)return {...record,kind:'debt_payment',automaticClassification:{method:'explicit_credit_card_repayment',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
    const cash=record.kind==='unknown'&&(record.direction==='credit'&&record.description==='\u73b0\u5b58'||record.direction==='debit'&&record.description==='\u73b0\u652f');
    const transfer=record.kind==='expense'&&record.direction==='debit'&&record.description==='\u6d88\u8d39'&&record.counterparty==='\u8d22\u4ed8\u901a-\u5fae\u4fe1\u8f6c\u8d26'&&record.rawFields?.counterparty===record.counterparty;
    if(cash||transfer)return {...record,kind:'transfer',automaticClassification:{method:cash?'explicit_cash_movement':'explicit_bank_wechat_transfer',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  }
  if(record.provider==='webank'&&record.statementFlow?.schema==='webank-debit-v1'&&record.status==='completed'&&record.kind==='unknown'&&record.direction==='debit'&&record.description==='\u5927\u989d\u5b58\u5355+\u8f6c\u8ba9\u624b\u7eed\u8d39'&&record.counterparty==='\u5e94\u6536\u4ee3\u7406\u4e1a\u52a1\u624b\u7eed\u8d39-\u4e2a\u4eba\u5927\u989d\u5b58\u5355')return {...record,kind:'fee',automaticClassification:{method:'explicit_deposit_transfer_fee',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='ccb'&&record.statementFlow?.schema==='ccb-debit-v1'&&record.status==='completed'&&['expense','unknown'].includes(record.kind)&&record.direction==='debit'&&(/\u5fae\u7c92\u8d37\(\u4fe1\u8d37\u8fd8\u6b3e\)/.test(record.description)||record.description==='\u5fae\u7c92\u8d37-\u5fae\u4f17'))return {...record,kind:'debt_payment',automaticClassification:{method:'explicit_weilidai_repayment',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='spdb'&&record.status==='completed'&&record.kind==='unknown'&&record.direction==='credit'&&record.bankStatement?.schema==='bank-credit-detail-v1'&&record.rawFields?.statementCredit===true&&record.rawFields?.statementAmountMinor==='-'+record.amountMinor&&record.description==='\u94f6\u8054\u5206\u671f\u8f6c\u5206\u671f\u4ed8\u6b3e')return {...record,kind:'transfer',direction:'neutral',bankStatement:{...record.bankStatement,nonCash:true},automaticClassification:{method:'explicit_installment_conversion',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id],policySource:'https://ccc.spdb.com.cn/miniSite/installment/2023/product_installment_tk.shtml'}};
  if(record.status==='completed'&&record.kind==='expense'&&record.direction==='debit'&&(record.bankStatement||record.statementFlow)&&/^\u6d88\u8d39\s+(?:\u8d22\u4ed8\u901a-)?\u5fae\u4fe1\u652f\u4ed8[:\uff1a]\u5fae\u4fe1\u8f6c\u8d26$/.test(String(record.description||'')))return {...record,kind:'transfer',automaticClassification:{method:'explicit_bank_wechat_transfer',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  if(record.status!=='completed'||record.kind!=='unknown')return record;
  if(record.provider==='huaxia'&&record.statementFlow?.schema==='huaxia-debit-v1'&&record.direction==='debit'&&record.counterparty==='\u6296\u97f3\u751f\u6d3b\u670d\u52a1\u5546\u5bb6'&&record.rawFields?.['\u5bf9\u65b9\u59d3\u540d']===record.counterparty&&record.rawFields?.['\u6458\u8981']==='E\u5546\u5b9d'&&record.rawFields?.['\u9644\u8a00']==='\u7f51\u8054\u5e73\u53f0\u534f\u8bae\u652f\u4ed8\u4e1a\u52a1'&&record.description===record.rawFields['\u6458\u8981']+' '+record.rawFields['\u9644\u8a00'])return {...record,kind:'expense',automaticClassification:{method:'explicit_local_service_merchant_purchase',confidence:'explicit_statement_purpose',evidenceObservationIds:[record.id]}};
  const description=String(record.description||''),counterparty=String(record.counterparty||''),purpose=description+' '+counterparty;
  let kind,method;
  const owner=String(statementOwner||'').normalize('NFKC').replace(/\s/g,''),ownDescription=description.normalize('NFKC').replace(/\s/g,''),ownCounter=counterparty.normalize('NFKC').replace(/\s/g,'');
  if(owner&&record.provider==='ccb'&&record.statementFlow?.schema==='ccb-debit-v1'&&record.direction==='credit'&&(record.rawFields?.['\u6458\u8981']===owner&&ownDescription===owner||[owner+'\u652f\u4ed8\u5b9d\u8f6c\u8d26','\u8f6c\u8d26\u5b58\u5165'+owner+'\u652f\u4ed8\u5b9d\u8f6c\u8d26'].includes(ownDescription))&&/\u652f\u4ed8\u5b9d(?:(?:\(\u4e2d\u56fd\)|\u4e2d\u56fd)?\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8|\u4ee3\u53d1\u8fc7\u6e21\u6237)/.test(ownCounter)){kind='transfer';method='explicit_same_owner_processing_transfer';}
  if(owner&&record.provider==='huaxia'&&record.statementFlow?.schema==='huaxia-debit-v1'&&['credit','debit'].includes(record.direction)&&ownCounter.endsWith('/'+owner)&&/^(?:\u94f6\u8054\u8f6c\u8d26\(\u4e91\u95ea\u4ed8\)|\u7f51\u5546\u94f6\u884c\(II\u3001III\u7c7b\u8d26\u6237\u63d0\u73b0\))\//.test(ownCounter)){kind='transfer';method='explicit_same_owner_processing_transfer';}
  const debitSource=record.statementFlow&&['ccb-debit-v1','huaxia-debit-v1','hangzhou-debit-v1','psbc-debit-v1','jsb-debit-v1','mybank-current-v1','spdb-debit-v1'].includes(record.statementFlow.schema);
  const teaching=debitSource&&teachingCashPurpose(record);if(teaching){kind=teaching.kind;method=teaching.method;}
  if(debitSource&&record.direction==='credit'&&/\u9000\u5e93\u7535\u5b50\u9000\u5e93/.test(description)&&/\u56fd\u5e93/.test(counterparty)){kind='income';method='explicit_tax_refund_income';}
  if(debitSource&&record.direction==='credit'&&(/\u9000\u4f19\u98df\u8d39/.test(description)||/^(?:\u4eba\u884c\u8de8\u884c\u6536\u6b3e\s+)?\u9000\u6b3e$/.test(description.trim()))){kind='refund';method='explicit_statement_refund';}
  if(debitSource&&record.direction==='debit'&&/\u8f6c\u8d26\u6c47\u6b3e(?:\u624b\u7eed\u8d39|\u90ae\u7535\u8d39)/.test(description)){kind='fee';method='explicit_bank_service_fee';}
  if(debitSource&&record.direction==='debit'&&!/\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9000\u6b3e|\u501f\u6b3e/.test(description)&&(/\u623f\u79df/.test(description)||/\u8f66\u4f4d.*(?:\u7eed\u79df|\d{4}\.\d{1,2}-\d{4}\.\d{1,2})/.test(description))){kind='expense';method='explicit_rent_payment';}
  if(debitSource&&record.direction==='credit'&&/\u6296\u97f3/.test(counterparty)&&/\u91d1\u5e01\u63d0\u73b0|\u73b0\u91d1\u7ea2\u5305/.test(description)){kind='income';method='explicit_platform_reward';}
  if(record.provider==='mybank'&&record.statementFlow?.schema==='mybank-current-v1'&&record.direction==='credit'&&/^\u5feb\u6377\u652f\u4ed8\u9000\u6b3e-\u652f\u4ed8\u5b9d-/.test(description)){kind='refund';method='explicit_payment_refund';}
  if(record.provider==='huaxia'&&record.statementFlow?.schema==='huaxia-debit-v1'&&record.direction==='credit'&&/\u9000\u5e93\u7535\u5b50\u9000\u5e93/.test(description)&&/\u56fd\u5e93/.test(counterparty)){kind='income';method='explicit_tax_refund_income';}
  if(record.provider==='ccb'&&record.statementFlow?.schema==='ccb-debit-v1'){
    const summary=String(record.rawFields?.['\u6458\u8981']||''),remark=String(record.rawFields?.['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']||''),text=summary+' '+remark;
    if(record.direction==='debit'&&['\u8d26\u6237\u7ba1\u7406\u8d39','\u8865\u6263\u8d26\u6237\u7ba1\u7406\u8d39'].includes(summary)&&record.rawFields?.dateBasis==='transaction_date'&&record.rawFields?.['\u4ea4\u6613\u65e5\u671f']===record.date.replace(/-/g,'')){kind='fee';method='explicit_bank_account_management_fee';}
    if(record.direction==='credit'&&/\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3$/.test(counterparty)&&/\u63d0\u53d6/.test(text)&&!/\u8d37\u6b3e/.test(text)){kind='transfer';method='explicit_provident_asset_withdrawal';}
    if(record.direction==='debit'&&summary==='\u5708\u5b58'&&/\u6821\u56ed\u4e00\u5361\u901a/.test(counterparty)){kind='transfer';method='explicit_stored_value_top_up';}
    if(record.direction==='credit'&&/\u57fa\u91d1\u4ee3\u9500\u4e13\u6237$/.test(counterparty)&&/\u4ee3\u9500\u8d4e\u56de-/.test(remark)){kind='transfer';method='explicit_fund_agency_redemption';}
    if(record.direction==='debit'&&summary==='\u76f4\u8fde\u5ba2\u6237\u4ee3\u6536\u4e13\u7528'&&counterparty==='\u6d59\u6c5f\u540c\u82b1\u987a\u57fa\u91d1\u9500\u552e\u6709\u9650\u516c\u53f8'){kind='transfer';method='explicit_fund_agency_subscription';}
    if(record.direction==='debit'&&/^(?:\u65e0\u5361\u81ea\u52a9\u4ea4\u6613|\u8de8\u884c\u4ee3\u6536)$/.test(summary)&&(/\u4fe1\u7528\u5361\u5bf9\u8d26\u8fd8\u6b3e/.test(remark)||/^\(\u7279\u7ea6\).*\u94f6\u884c.*\u4fe1\u7528\u5361\u4e2d\u5fc3$/.test(remark))){kind='debt_payment';method='explicit_credit_card_repayment';}
    if(record.direction==='debit'&&summary==='\u65e0\u5361\u81ea\u52a9\u4ea4\u6613'&&/^\(\u7279\u7ea6\)(?:\u817e\u90a6\u56fd\u9645\u673a\u7968\u5206\u9500|\u8054\u52a8\u79d1\u6280\(\u79fb\u52a8\u4ee3\u7406\u5546\u8bdd\u8d39\u5f52\u96c6\))$/.test(remark)){kind='expense';method='explicit_travel_or_telecom_purchase';}
    if(record.direction==='debit'&&summary==='\u5145\u503c'&&remark==='\u8d22\u4ed8\u901a-\u5fae\u4fe1\u96f6\u94b1\u5145\u503c\u8d26\u6237'){kind='transfer';method='explicit_bank_wallet_top_up';}
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
  if(require('./restrictedCoupons').isConfirmedRestrictedCoupon(record))return true;
  // The stated face value of a restricted non-cash coupon is not a cash leg.
  if(record.provider==='alipay'&&record.status==='completed'&&record.kind==='transfer'&&record.direction==='neutral'&&!record.accountRelations?.length&&/\u7ea2\u5305-\u975e\u73b0\u91d1\uff0c\u8fc7\u671f\u4f5c\u5e9f$/.test(record.description||'')&&record.rawFields?.['\u5546\u54c1\u8bf4\u660e']===record.description&&record.rawFields?.['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f')return true;

  if(record.provider==='jd'&&record.kind==='unknown'&&record.direction==='neutral'&&/^\u9884\u6388\u6743(?:\u51bb\u7ed3|\u89e3\u51bb)\u6210\u529f$/.test(record.rawFields?.['\u4ea4\u6613\u72b6\u6001']||''))return true;
  if(record.provider==='psbc'&&record.statementFlow?.schema==='psbc-debit-v1'&&record.status==='completed'&&record.direction==='neutral'&&record.amountMinor==='0'&&record.balanceMinor==='0'&&record.description==='\u73b0\u91d1\u5f00\u5361')return true;
  if(!['alipay','wechat'].includes(record.provider)||record.direction!=='neutral'||record.kind!=='unknown')return false;
  const status=String(record.rawFields?.['\u4ea4\u6613\u72b6\u6001']||record.rawFields?.['\u5f53\u524d\u72b6\u6001']||'');
  return /^(?:\u51bb\u7ed3\u6210\u529f|\u89e3\u51bb\u6210\u529f|\u829d\u9ebb\u514d\u62bc\u4e0b\u5355\u6210\u529f)$/.test(status);
}

function classifyPlatformPurpose(record){
  const teachingPlatform=record.provider==='alipay'||record.provider==='wechat'&&record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u8f6c\u8d26'&&record.rawFields?.['\u5f53\u524d\u72b6\u6001']==='\u5bf9\u65b9\u5df2\u6536\u94b1';
  const teaching=teachingPlatform&&record.status==='completed'&&record.kind==='transfer'&&teachingCashPurpose(record);if(teaching)return {...record,kind:teaching.kind,automaticClassification:{method:teaching.method,confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='alipay'&&record.status==='completed'&&record.direction==='debit'&&record.kind==='refund'&&record.rawFields?.['收/支']==='支出'&&record.rawFields?.['交易分类']!=='退款'&&/^淘宝退货[-－]寄件费(?:[_\s-]|$)/.test(record.description||''))return {...record,kind:'expense',automaticClassification:{method:'explicit_return_shipping_payment',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='alipay'&&record.status==='completed'&&record.direction==='neutral'&&record.kind==='transfer'&&record.description==='\u4e2a\u4eba\u6d88\u8d39\u8d37\u6b3e\u653e\u6b3e'&&record.counterparty==='\u8682\u8681\u501f\u5457')return {...record,kind:'loan_drawdown',automaticClassification:{method:'explicit_historical_loan_drawdown',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='alipay'&&record.status==='completed'&&record.direction==='credit'&&record.rawFields?.['\u4ea4\u6613\u72b6\u6001']==='\u9000\u6b3e\u6210\u529f'&&/\u4fdd\u9669\u627f\u4fdd-\u9000\u4fdd\u4fdd\u8d39\u652f\u4ed8/.test(record.description||'')&&['income','refund'].includes(record.kind))return {...record,kind:'refund',automaticClassification:{method:'explicit_policy_refund',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  if(record.provider==='wechat'&&record.status==='completed'&&record.direction==='neutral'){
    const type=String(record.rawFields?.['交易类型']||'');
    // Personal exports use '/' for income/expense, even when the transaction
    // itself explicitly states which way cash moved. Preserve that raw label.
    if(record.kind==='debt_payment'&&type==='信用卡还款')return {...record,direction:'debit',automaticClassification:{method:'explicit_credit_repayment_outflow',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
    if(record.kind==='transfer'&&type==='零钱充值'&&/银行(?:储蓄卡|借记卡)?\(\d{4}\)$/.test(record.paymentChannel||''))return {...record,direction:'debit',automaticClassification:{method:'explicit_wallet_top_up',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
  }
  if(record.status!=='completed'||record.kind!=='transfer'||record.direction!=='debit')return record;
  // Funding a merchant purchase from cash management is still consumption.
  if(record.accountRelations?.some(r=>r.role!=='funding'||r.activity!=='funding_outflow'))return record;
  const description=String(record.description||''),category=String(record.category||''),type=String(record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']||'');
  // A merchant's phone/game/utility top-up buys a service. It does not move
  // money into the payer's own wallet, even though both use the word top-up.
  if(/(?:\u652f\u4ed8\u5b9d\u4f59\u989d|\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d).*\u5145\u503c|(?:\u652f\u4ed8\u5b9d|\u5fae\u4fe1)[-\s]?\u5145\u503c|\u5145\u503c.*(?:\u96f6\u94b1|\u94b1\u5305|\u8d26\u6237\u4f59\u989d)/.test(description))return record;
  const merchant=record.provider==='wechat'&&type==='\u5546\u6237\u6d88\u8d39';
  const raw=record.rawFields||{},parts=String(record.paymentChannel||'').split('&'),legacyDiscountedRetail=record.provider==='alipay'&&parts.length>1&&/^.+\u94f6\u884c$/.test(parts[0])&&parts.slice(1).every(p=>['\u4f18\u60e0','\u7ea2\u5305','\u96c6\u5206\u5b9d','\u5546\u5bb6\u6298\u6263'].includes(p))&&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===record.paymentChannel&&raw['\u5546\u54c1\u8bf4\u660e']===description&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&typeof raw['\u5546\u5bb6\u8ba2\u5355\u53f7']==='string'&&raw['\u5546\u5bb6\u8ba2\u5355\u53f7'].length>0&&(/\u6d88\u8d39|\u6761\u7801\u652f\u4ed8|\u9984\u9968|\u9762\u9986|\u5916\u5356/.test(description+' '+record.counterparty)||/^T\d+P\d+$/.test(raw['\u5546\u5bb6\u8ba2\u5355\u53f7']))&&!/\u501f\u6b3e|\u8d37\u6b3e|\u8fd8\u6b3e|\u63d0\u73b0|\u7406\u8d22|\u57fa\u91d1|\u6295\u8d44|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d/.test(description);
  const service=record.provider==='alipay'&&(['\u5145\u503c\u7f34\u8d39','\u6587\u5316\u4f11\u95f2','\u6559\u80b2\u57f9\u8bad','\u7231\u8f66\u517b\u8f66'].includes(category)&&/\u5145\u503c/.test(category+' '+description)||/\u7535\u6869.*\u5145\u503c|\u5145\u503c[:\uff1a]\u963f\u91cc\u4e91\u670d\u52a1\u8d2d\u4e70/.test(description));
  const digitalContent=record.provider==='alipay'&&record.counterparty==='\u534e\u4e3a\u8f6f\u4ef6\u6280\u672f\u6709\u9650\u516c\u53f8'
    &&category==='\u6570\u7801\u7535\u5668'&&/^(?:\u7eb5\u6a2a\u5c0f\u8bf4|\u534e\u4e3a\u9605\u8bfb)_\u534e\u4e3a\u5145\u503c-\d+(?:\.\d{1,2})?\u5143$/.test(description)
    &&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u5546\u54c1\u8bf4\u660e']===description&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'
    &&typeof raw['\u5546\u5bb6\u8ba2\u5355\u53f7']==='string'&&raw['\u5546\u5bb6\u8ba2\u5355\u53f7'].length>0;
  return merchant||service||legacyDiscountedRetail||digitalContent?{...record,kind:'expense',automaticClassification:{method:digitalContent?'explicit_digital_reading_purchase':'explicit_merchant_service_payment',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}}:record;
}

function legacyRefundPending(record,observations=[]){
 const raw=record.rawFields||{};
 if(record.provider!=='wechat')return false;
 if(record.status==='pending'&&(raw['当前状态']||raw['交易状态'])==='已转入退款')return true;
 // A completed debit with a fully-refunded final state is not proof of the
 // refund posting date. Preserve the original debit and require settlement
 // evidence rather than silently treating its cash trail as complete.
 if(record.status!=='completed'||record.direction!=='debit'||record.paymentChannel!=='零钱'||raw['当前状态']!=='已全额退款'||BigInt(record.amountMinor)<=0n)return false;
 const at=Date.parse(record.occurredAt),kind=String(raw['交易类型']||'');
 return !observations.some(q=>{
  const r=q.rawFields||{},delay=Date.parse(q.occurredAt)-at;
  if(q.provider!=='wechat'||q.financialAccountId!==record.financialAccountId||q.currency!==record.currency||q.kind!=='refund'||q.status!=='completed'||q.direction!=='credit'||q.amountMinor!==record.amountMinor||!Number.isFinite(delay)||delay<0||delay>14*86400000||!['','/','零钱'].includes(q.paymentChannel))return false;
  if(observations.some(other=>other.provider===q.provider&&other.financialAccountId===q.financialAccountId&&(other.sourceIdentity||other.id)===(q.sourceIdentity||q.id)&&(other.sourceVersionOrdinal||0)>(q.sourceVersionOrdinal||0)))return false;
  return kind==='转账'?r['交易类型']==='转账-退款':kind.startsWith('微信红包')?r['交易类型']==='微信红包-退款':q.counterparty===record.counterparty&&r['交易类型']===record.counterparty+'-退款';
 });
}

// A closed merchant order can still have an actual debit followed by an actual
// refund. Classify the bank debit from four independent source legs, retaining
// the failed platform order and the existing refund without duplicating cash.
function closedOrderBankPayments(observations,accounts,{fundingAccount,annotatedIds=new Set(),links=[]}){
 const {actualSecond}=require('./mixedPayments'),accountMap=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()],failed=new Map(),bankIndex=new Map(),key=(account,date,amount,currency,direction)=>JSON.stringify([account,date,amount,currency,direction]);
 for(const o of rows){
  if(o.provider==='alipay'&&o.status==='failed'&&o.rawFields?.['交易状态']==='交易关闭'&&o.rawFields?.['收/支']==='支出'&&o.direction==='debit'&&o.sourceTransactionId&&actualSecond(o)&&!o.accountRelations?.length&&!/^(?:充值-|提现-|余额宝|余利宝|信用卡还款|个人消费贷款)|押金|保证金|预授权|冻结/.test(o.description||'')&&!blocked.has(identity(o))&&accountMap.get(o.financialAccountId)?.type==='wallet'){const k=JSON.stringify([o.financialAccountId,o.currency,o.sourceTransactionId]);if(!failed.has(k))failed.set(k,[]);failed.get(k).push(o);}
  if(o.provider==='mybank'&&o.statementFlow?.schema==='mybank-current-v1'&&o.status==='completed'&&actualSecond(o)&&['debit','credit'].includes(o.direction)&&!blocked.has(identity(o))){const k=key(o.financialAccountId,o.date,o.amountMinor,o.currency,o.direction);if(!bankIndex.has(k))bankIndex.set(k,[]);bankIndex.get(k).push(o);}
 }
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),proposals=[];
 for(const r of rows){
  if(r.provider!=='alipay'||r.kind!=='refund'||r.status!=='completed'||!['neutral','credit'].includes(r.direction)||!actualSecond(r)||blocked.has(identity(r)))continue;
  const order=r.sourceTransactionId||'';let at=order.indexOf('_'),parts=0;
  while(at>0&&parts++<8){
   for(const p of failed.get(JSON.stringify([r.financialAccountId,r.currency,order.slice(0,at)]))||[]){
    if(p.amountMinor!==r.amountMinor||p.relatedReference&&p.relatedReference!==r.relatedReference)continue;
    const duration=Date.parse(r.occurredAt)-Date.parse(p.occurredAt),fund=fundingAccount(p,accounts),refundFund=fundingAccount(r,accounts);if(duration<0||duration>31*86400000||fund?.type!=='debit_card'||fund.status!=='active'||refundFund?.id!==fund.id)continue;
    const debit=(bankIndex.get(key(fund.id,p.date,p.amountMinor,p.currency,'debit'))||[]).filter(b=>b.kind==='unknown'&&/^快捷支付-支付宝-/.test(b.description)&&Date.parse(b.occurredAt)>=Date.parse(p.occurredAt)&&Date.parse(b.occurredAt)<=Date.parse(p.occurredAt)+3000);
    const credit=(bankIndex.get(key(fund.id,r.date,r.amountMinor,r.currency,'credit'))||[]).filter(b=>['unknown','refund'].includes(b.kind)&&/^快捷支付退款-支付宝-/.test(b.description)&&Date.parse(b.occurredAt)>=Date.parse(r.occurredAt)&&Date.parse(b.occurredAt)<=Date.parse(r.occurredAt)+3000);
    if(debit.length!==1||credit.length!==1)continue;
    const members=[p,r,debit[0],credit[0]],ids=new Set(members.map(identity));if(vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.some(k=>ids.has(k)):keys.length===l.observationIds.length&&keys.every(k=>ids.has(k));}))continue;
    proposals.push({members,bank:debit[0]});
   }
   at=order.indexOf('_',at+1);
  }
 }
 const uses=new Map();for(const m of proposals)for(const o of m.members)uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(m=>m.members.every(o=>uses.get(identity(o))===1)).map(m=>[m.bank.id,{kind:'expense',automaticClassification:{method:'closed_order_actual_cash_payment',confidence:'inferred_source_receipts',evidenceObservationIds:m.members.map(o=>o.id),platformOrderStatusPreserved:true,refundAlreadyRepresented:true}}]));
}

function wechatTeachingBankReceipt(platform,bank){
 return platform.provider==='wechat'&&platform.kind==='expense'&&platform.direction==='debit'&&platform.automaticClassification?.method==='explicit_tutor_payment'&&bank.provider==='ccb'&&bank.statementFlow?.schema==='ccb-debit-v1'&&bank.kind==='transfer'&&bank.direction==='debit'&&bank.automaticClassification?.method==='explicit_bank_wechat_transfer'&&bank.rawFields?.dateBasis==='transaction_date'&&bank.rawFields?.['\u4ea4\u6613\u65e5\u671f']===bank.date.replace(/-/g,'');
}
module.exports={classifyBankPurpose,classifyPlatformPurpose,nonCashAuthorization,legacyRefundPending,closedOrderBankPayments,wechatTeachingBankReceipt};
