'use strict';
const invalid=()=>Object.assign(new Error('COUNTERPARTY_SETTLEMENT_INVALID'),{code:'COUNTERPARTY_SETTLEMENT_INVALID'});
function validateCounterpartySettlement(value){
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['schema','counterparty','scope'].includes(k))||value.scope!==undefined&&value.scope!=='annotation_only'||value.schema!=='counterparty-settlement-v1'||typeof value.counterparty!=='string'||!value.counterparty.trim()||value.counterparty.length>128||/[*＊×]/.test(value.counterparty))throw invalid();
 return {...value};
}
function isSettlementAccount(account){
 if(account?.type!=='receivable'||account.balanceConvention!=='signed'||!account.counterpartySettlement||account.sourceProduct)return false;
 try{validateCounterpartySettlement(account.counterpartySettlement);return true;}catch{return false;}
}
function annotatedSettlementAccount(record,annotation,accounts){
 const patch=annotation?.reset?null:annotation?.patch;
 if(patch?.settlementAccountId===undefined||patch.settlementAccountId===null)return null;
 const account=accounts.find(a=>a.id===patch.settlementAccountId);
 const productConflict=record.accountRelations?.some(r=>r.role!=='funding'||r.activity!=='funding_outflow'||!['alipay_yuebao','alipay_yulibao','wechat_lingqiantong'].includes(r.product));
 if(patch.kind!=='transfer'||record.status!=='completed'||!['credit','debit'].includes(record.direction)||productConflict||record.investmentTrade||record.bankStatement?.nonCash||!isSettlementAccount(account)||!['active','archived'].includes(account.status)||account.id===record.financialAccountId||account.currency!==record.currency)throw invalid();
 return account;
}
function inferredSettlementAccount(record,accounts){
 if(record.status!=='completed'||!['transfer','unknown'].includes(record.kind)||!['credit','debit'].includes(record.direction)||record.amountMinor==='0'||/\u5229\u606f|\u624b\u7eed\u8d39|\u9000\u6b3e|\u6295\u8d44|\u7406\u8d22|\u57fa\u91d1|\u8bc1\u5238|\u4fdd\u9669|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(record.description||''))return null;
 const name=String(record.counterparty||'').normalize('NFKC').trim().split('/').at(-1),source=accounts.find(a=>a.id===record.financialAccountId);
 if(!name||/[*\uff0a\u00d7]/.test(name)||!source||!['cash','bank','savings','debit_card','credit_card','wallet'].includes(source.type))return null;
 const matches=accounts.filter(a=>a.status==='active'&&isSettlementAccount(a)&&a.counterpartySettlement.scope!=='annotation_only'&&a.currency===record.currency&&a.counterpartySettlement.counterparty.normalize('NFKC').trim()===name);if(matches.length!==1)return null;
 try{return annotatedSettlementAccount(record,{patch:{kind:'transfer',settlementAccountId:matches[0].id}},accounts);}catch{return null;}
}
// A legacy merchant debit proves that an advance was paid, but an empty
// exported payment method does not identify the wallet as its payer.
function settlementMerchantFundingMissing(record){
 const raw=record.rawFields;
 const individualMerchantOrder=/^\d{4}-\d{2}-\d{2}$/.test(record.date||'')&&/^\d{8}0000100025\d{8,16}$/.test(record.sourceTransactionId||'')&&record.sourceTransactionId.startsWith(record.date.replace(/-/g,''))&&/^T\d{1,4}P\d{6,}$/.test(record.relatedReference||'')&&raw?.['\u5546\u5bb6\u8ba2\u5355\u53f7']===record.relatedReference&&require('./mixedPayments').actualSecond(record)&&raw?.['\u4ea4\u6613\u65f6\u95f4']===record.date+' '+record.occurredAt.slice(11,19)&&/^\d+$/.test(record.amountMinor||'')&&/^\d+\.\d{2}$/.test(raw?.['\u91d1\u989d']||'')&&BigInt(raw['\u91d1\u989d'].replace('.',''))===BigInt(record.amountMinor);
 return record.automaticClassification?.method==='owner_confirmed_counterparty_settlement'
  &&record.provider==='alipay'&&record.status==='completed'&&record.direction==='debit'
  &&!record.paymentChannel&&!record.paymentAccountHint&&!record.automaticFunding&&!record.accountRelations?.length
  &&(/\u516c\u53f8$/.test(record.counterparty||'')||individualMerchantOrder)&&raw?.['\u6536/\u652f']==='\u652f\u51fa'
  &&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===''&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'
  &&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===record.sourceTransactionId
  &&raw['\u4ea4\u6613\u5bf9\u65b9']===record.counterparty&&raw['\u5546\u54c1\u8bf4\u660e']===record.description;
}
module.exports={validateCounterpartySettlement,isSettlementAccount,annotatedSettlementAccount,inferredSettlementAccount,settlementMerchantFundingMissing};
