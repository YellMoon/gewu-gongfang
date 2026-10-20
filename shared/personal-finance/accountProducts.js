'use strict';
// These are statement products, never guesses based on a person's identity or
// a merchant. Product accounts carry no invented opening balance or valuation.
const ACCOUNT_PRODUCTS=Object.freeze({
 alipay_shanghai_credit:{label:'上海银行信用购',provider:'alipay',type:'credit_card',aliases:['上海银行信用购']},
 alipay_huabei:{label:'支付宝 · 花呗',provider:'alipay',type:'credit_card',aliases:['花呗']},
 alipay_jiebei:{label:'支付宝 · 借呗',provider:'alipay',type:'loan',aliases:['借呗']},
 alipay_yuebao:{label:'支付宝 · 余额宝',provider:'alipay',type:'investment',aliases:['余额宝']},
 alipay_yulibao:{label:'支付宝 · 余利宝',provider:'alipay',type:'investment',aliases:['余利宝']},
 alipay_funds:{label:'支付宝 · 基金',provider:'alipay',type:'investment',aliases:['蚂蚁财富','基金']},
 wechat_lingqiantong:{label:'微信支付 · 零钱通',provider:'wechat',type:'investment',aliases:['零钱通']},
 wechat_licaitong:{label:'微信支付 · 理财通',provider:'wechat',type:'investment',aliases:['理财通']},
});
const productIn=(text,provider)=>Object.entries(ACCOUNT_PRODUCTS).find(([,p])=>p.provider===provider&&p.aliases.some(alias=>String(text).includes(alias)))?.[0];
const explicitCardFundingCredit=text=>!/\u9000\u6b3e|\u9000\u8d27|\u9000\u8d39|\u8fd4\u8fd8|\u51b2\u6b63|\u64a4\u9500|refund/i.test(text)&&/\u672c\u884c\u81ea\u52a9\u8f6c\u5165|\u7f51\u8054\u81ea\u52a9\u8f6c\u5165/.test(text);
const ACTIVITIES=new Set(['repayment','investment_deposit','investment_withdrawal','investment_income','investment_exchange','investment_confirmation','investment_fee','funding_outflow','funding_inflow','credit_charge','loan_drawdown']);
function inferAccountRelations(record,provider){
 if(!['alipay','wechat'].includes(provider))return [];
 const description=record.description||'',type=record.rawFields?.['交易类型']||'',channel=record.paymentChannel||'';
 const purpose=type+' '+description+' '+record.counterparty;
 const target=productIn(purpose,provider),funding=productIn(channel,provider),relations=[];
 if(target){const spec=ACCOUNT_PRODUCTS[target];let activity;
  if(['credit_card','loan'].includes(spec.type)){
   if(record.kind==='debt_payment'||/还款/.test(purpose))activity='repayment';
   else if(record.kind==='loan_drawdown'||/借款到账|贷款发放/.test(purpose))activity='loan_drawdown';
  }else{
   if(/转换至|基金转换/.test(purpose))activity='investment_exchange';
   else if(record.kind==='fee')activity='investment_fee';
   else if(/转出|赎回|卖出|撤单退回/.test(purpose))activity='investment_withdrawal';
   else if(/转入|买入|申购|购买|定投/.test(purpose))activity='investment_deposit';
   else if(/结息|利息|收益发放/.test(purpose))activity='investment_income';
  }
  if(activity)relations.push({product:target,activity,role:'target'});
 }
 if(funding&&!relations.some(r=>r.product===funding)){
  const liability=['credit_card','loan'].includes(ACCOUNT_PRODUCTS[funding].type);
  const incoming=record.direction==='credit'||record.kind==='refund'||relations.some(r=>r.activity==='investment_withdrawal');
  const outgoing=record.direction==='debit'||relations.some(r=>['repayment','investment_deposit'].includes(r.activity));
  if(incoming||outgoing)relations.push({product:funding,activity:liability?(incoming?'repayment':'credit_charge'):(incoming?'funding_inflow':'funding_outflow'),role:'funding'});
 }
 return relations;
}
function relationDelta(relation,amount,record) {
 if(['investment_exchange','investment_confirmation','investment_fee'].includes(relation.activity))return 0n;
 const magnitude=relation.activity==='repayment'&&record?.principalMinor!==null&&record?.principalMinor!==undefined?BigInt(record.principalMinor):amount;
 return ['investment_withdrawal','funding_outflow','credit_charge','loan_drawdown'].includes(relation.activity)?-magnitude:magnitude;
}

module.exports={ACCOUNT_PRODUCTS,ACCOUNT_RELATION_ACTIVITIES:ACTIVITIES,inferAccountRelations,relationDelta,explicitCardFundingCredit};
