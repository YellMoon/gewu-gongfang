'use strict';
const {GUOHUA_PRODUCT,isGuohuaInvestmentPurchase}=require('./guohuaInvestment');
// These are statement products, never guesses based on a person's identity or
// a merchant. Product accounts carry no invented opening balance or valuation.
const ACCOUNT_PRODUCTS=Object.freeze({
 cn_medical_personal_account:{label:'\u533b\u4fdd\u4e2a\u4eba\u8d26\u6237',provider:'medical_insurance',type:'wallet',nonCash:true,aliases:[]},
 alipay_hangzhou_transit:{label:'\u676d\u5dde\u901a\u7535\u5b50\u516c\u4ea4\u5361',provider:'\u676d\u5dde\u5e02\u6c11\u5361',type:'other',aliases:[]},
 alipay_guohua_no1_enhanced:{label:'\u652f\u4ed8\u5b9d \u00b7 \u56fd\u534e1\u53f7\u589e\u5f3a\u7248',provider:'alipay',type:'investment',aliases:['\u56fd\u534e1\u53f7\u589e\u5f3a\u7248']},
 jd_gangbeng:{label:'\u4eac\u4e1c \u00b7 \u94a2\u955a\uff08\u79ef\u5206\uff09',provider:'jd',type:'wallet',nonCash:true,aliases:['\u94a2\u955a','\u94a2\u8e66']},
 alipay_1688_chengeshe:{label:'1688 · 诚e赊',provider:'alipay',type:'credit_card',aliases:['诚e赊']},
 alipay_feiyuebao:{label:'支付宝 · 建信养老飞月宝',provider:'alipay',type:'investment',aliases:['建信养老飞月宝']},
 alipay_chaoyuebao:{label:'支付宝 · 国寿超月宝',provider:'alipay',type:'investment',aliases:['国寿超月宝']},
 alipay_ecny:{label:'\u6570\u5b57\u4eba\u6c11\u5e01\uff08\u603b\u8d26\u6237\uff09',provider:'alipay',type:'wallet',aliases:['\u6570\u5b57\u4eba\u6c11\u5e01']},
 jd_baitiao:{label:'\u4eac\u4e1c \u00b7 \u767d\u6761',provider:'jd',type:'credit_card',aliases:['\u4eac\u4e1c\u767d\u6761']},
 jd_jintiao:{label:'\u4eac\u4e1c \u00b7 \u91d1\u6761',provider:'jd',type:'loan',aliases:['\u4eac\u4e1c\u91d1\u6761','\u4eac\u4e1c\u501f\u94b1']},
 webank_weilidai:{label:'\u5fae\u4f17\u94f6\u884c \u00b7 \u5fae\u7c92\u8d37',provider:'webank',type:'loan',aliases:['\u5fae\u7c92\u8d37']},
 jd_xiaojinku:{label:'\u4eac\u4e1c \u00b7 \u5c0f\u91d1\u5e93',provider:'jd',type:'investment',aliases:['\u4eac\u4e1c\u5c0f\u91d1\u5e93']},
 alipay_1688_credit:{label:'1688 \u5148\u91c7\u540e\u4ed8',provider:'alipay',type:'credit_card',aliases:['\u5148\u91c7\u540e\u4ed8']},
 alipay_shanghai_credit:{label:'上海银行信用购',provider:'alipay',type:'credit_card',aliases:['上海银行信用购']},
 alipay_huabei:{label:'支付宝 · 花呗',provider:'alipay',type:'credit_card',aliases:['花呗']},
 alipay_jiebei:{label:'支付宝 · 借呗',provider:'alipay',type:'loan',aliases:['借呗']},
 alipay_cunjinbao:{label:'\u652f\u4ed8\u5b9d \u00b7 \u5b58\u91d1\u5b9d',provider:'alipay',type:'investment',aliases:['\u5b58\u91d1\u5b9d']},
 alipay_yuebao:{label:'支付宝 · 余额宝',provider:'alipay',type:'investment',aliases:['余额宝']},
 alipay_yulibao:{label:'支付宝 · 余利宝',provider:'alipay',type:'investment',aliases:['余利宝']},
 alipay_funds:{label:'支付宝 · 基金',provider:'alipay',type:'investment',aliases:['蚂蚁财富','基金']},
 wechat_lingqiantong:{label:'微信支付 · 零钱通',provider:'wechat',type:'investment',aliases:['零钱通']},
 wechat_licaitong:{label:'微信支付 · 理财通',provider:'wechat',type:'investment',aliases:['理财通']},
});
// This legacy contract is recognized only through its complete native fields.
const productIn=(text,provider)=>Object.entries(ACCOUNT_PRODUCTS).find(([key,p])=>key!==GUOHUA_PRODUCT&&p.provider===provider&&p.aliases.some(alias=>String(text).includes(alias)))?.[0];
const explicitCardFundingCredit=text=>!/\u9000\u6b3e|\u9000\u8d27|\u9000\u8d39|\u8fd4\u8fd8|\u51b2\u6b63|\u64a4\u9500|refund/i.test(text)&&/\u672c\u884c\u81ea\u52a9\u8f6c\u5165|\u7f51\u8054\u81ea\u52a9\u8f6c\u5165/.test(text);
const ambiguousCardCredit=text=>/^(?:\u4ee3\u53d1\u6b3e\u9879|\u652f\u4ed8\u5b9d)$/.test(String(text||'').normalize('NFKC').replace(/\s/g,''));
const ACTIVITIES=new Set(['repayment','investment_deposit','investment_withdrawal','investment_income','investment_exchange','investment_confirmation','investment_fee','funding_outflow','funding_inflow','credit_charge','loan_drawdown']);
function inferAccountRelations(record,provider){
 if(provider==='alipay'&&isGuohuaInvestmentPurchase(record))return [{product:GUOHUA_PRODUCT,activity:'investment_deposit',role:'target'}];
 if(provider==='wechat'&&require('./legacyWechatInvestmentWithdrawals').nativeLegacyWechatWithdrawal(record))return [{product:'wechat_licaitong',activity:'investment_withdrawal',role:'target'}];
 if(provider==='jd'){
  const channel=record.paymentChannel;
  if(record.status!=='completed'||!['\u94a2\u955a','\u94a2\u8e66'].includes(channel)||record.rawFields?.['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==channel||record.rawFields?.['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f')return [];
  const outgoing=record.kind==='expense'&&record.direction==='debit'&&record.rawFields['\u6536/\u652f']==='\u652f\u51fa',incoming=record.kind==='refund'&&record.direction==='credit'&&['\u6536\u5165','\u4e0d\u8ba1\u6536\u652f'].includes(record.rawFields['\u6536/\u652f']);
  return outgoing||incoming?[{product:'jd_gangbeng',role:'funding',activity:outgoing?'funding_outflow':'funding_inflow'}]:[];
 }
 if(!['alipay','wechat'].includes(provider))return [];
 const description=record.description||'',type=record.rawFields?.['交易类型']||'',channel=record.paymentChannel||'';
 const purpose=type+' '+description+' '+record.counterparty;
 const namedFundTrade=provider==='alipay'&&/^\u8682\u8681\u8d22\u5bcc-.+-(?:\u4e70\u5165|\u5356\u51fa\u81f3)/.test(description);
 let target=namedFundTrade?'alipay_funds':productIn(purpose,provider);const funding=productIn(channel.replace(/\u57fa\u91d1\u4efd\u989d\u7ea2\u5305/g,''),provider),relations=[];
 if(['alipay_feiyuebao','alipay_chaoyuebao'].includes(target)&&!(record.kind==='transfer'&&/^定期理财(?:赎回)?-(?:建信养老飞月宝|国寿超月宝)$/.test(description)))target=null;
 if(target==='alipay_1688_chengeshe'&&!(record.kind==='debt_payment'&&/^1688增值服务-诚e赊还款-\d{4}年\d{1,2}月账单$/.test(description)))target=null;
 if(target){const spec=ACCOUNT_PRODUCTS[target];let activity;
  if(spec.type==='wallet'){
   if(record.kind==='transfer'&&/^\u6570\u5b57\u4eba\u6c11\u5e01-\u8f6c\u5165$/.test(description))activity='funding_inflow';
   else if(record.kind==='transfer'&&/^\u6570\u5b57\u4eba\u6c11\u5e01-\u8f6c\u51fa$/.test(description))activity='funding_outflow';
   else if(['transfer','expense'].includes(record.kind)&&record.direction==='debit'&&description==='\u6570\u5b57\u4eba\u6c11\u5e01\u8f6c\u8d26')activity='funding_outflow';
  }else if(['credit_card','loan'].includes(spec.type)){
   if(record.kind==='debt_payment'||/还款/.test(purpose))activity='repayment';
   else if(record.kind==='loan_drawdown'||/借款到账|贷款发放/.test(purpose))activity='loan_drawdown';
  }else{
   if(['alipay_feiyuebao','alipay_chaoyuebao'].includes(target))activity=description.startsWith('定期理财赎回-')?'investment_withdrawal':'investment_deposit';
   else if(target==='alipay_yuebao'&&record.kind==='transfer'&&description==='转账收款到余额宝')activity='investment_deposit';
   else if(/转换至|基金转换/.test(purpose))activity='investment_exchange';
   else if(record.kind==='fee')activity='investment_fee';
   else if(/转出|赎回|卖出|撤单退回/.test(purpose))activity='investment_withdrawal';
   else if(/转入|买入|申购|购买|定投/.test(purpose))activity='investment_deposit';
   else if(/结息|利息|收益发放/.test(purpose))activity='investment_income';
  }
  if(activity)relations.push({product:target,activity,role:spec.type==='wallet'&&description==='\u6570\u5b57\u4eba\u6c11\u5e01\u8f6c\u8d26'?'funding':'target'});
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

module.exports={ACCOUNT_PRODUCTS,ACCOUNT_RELATION_ACTIVITIES:ACTIVITIES,inferAccountRelations,relationDelta,explicitCardFundingCredit,ambiguousCardCredit};
