'use strict';
{
 const assert=require('node:assert/strict'),{classifyBankPurpose}=require('./bankClassification');
 for(const summary of ['\u8d26\u6237\u7ba1\u7406\u8d39','\u8865\u6263\u8d26\u6237\u7ba1\u7406\u8d39']){
  const o={id:'fee',date:'2015-08-18',provider:'ccb',kind:'unknown',status:'completed',direction:'debit',description:summary,counterparty:'',statementFlow:{schema:'ccb-debit-v1'},rawFields:{'\u6458\u8981':summary,dateBasis:'transaction_date','\u4ea4\u6613\u65e5\u671f':'20150818'}},before=JSON.stringify(o);assert.equal(classifyBankPurpose(o).kind,'fee');assert.equal(JSON.stringify(o),before);for(const patch of [{direction:'credit'},{status:'failed'},{rawFields:{}},{provider:'other'}])assert.equal(classifyBankPurpose({...o,...patch}).kind,'unknown');
 }
}
{
 const assert=require('node:assert/strict'),{classifyBankPurpose}=require('./bankClassification'),party='\u6296\u97f3\u751f\u6d3b\u670d\u52a1\u5546\u5bb6',summary='E\u5546\u5b9d',memo='\u7f51\u8054\u5e73\u53f0\u534f\u8bae\u652f\u4ed8\u4e1a\u52a1',o={id:'local-service',provider:'huaxia',status:'completed',kind:'unknown',direction:'debit',counterparty:party,description:summary+' '+memo,statementFlow:{schema:'huaxia-debit-v1'},rawFields:{'\u5bf9\u65b9\u59d3\u540d':party,'\u6458\u8981':summary,'\u9644\u8a00':memo}},before=JSON.stringify(o);assert.equal(classifyBankPurpose(o).kind,'expense');assert.equal(JSON.stringify(o),before);
 for(const patch of [{counterparty:'Generic payment processor'},{direction:'credit'},{status:'failed'},{rawFields:{}},{description:'Other purpose'}])assert.equal(classifyBankPurpose({...o,...patch}).kind,'unknown');
}
// UTF-8 source: regression cases added below use observed historical purposes.
{
 const {classifyBankPurpose,classifyPlatformPurpose}=require('./bankClassification'),assert=require('node:assert/strict');
 const fee={id:'fee',provider:'webank',status:'completed',kind:'unknown',direction:'debit',description:'\u5927\u989d\u5b58\u5355+\u8f6c\u8ba9\u624b\u7eed\u8d39',counterparty:'\u5e94\u6536\u4ee3\u7406\u4e1a\u52a1\u624b\u7eed\u8d39-\u4e2a\u4eba\u5927\u989d\u5b58\u5355',statementFlow:{schema:'webank-debit-v1'}},raw=JSON.stringify(fee);assert.equal(classifyBankPurpose(fee).kind,'fee');assert.equal(JSON.stringify(fee),raw);assert.equal(classifyBankPurpose({...fee,direction:'credit'}).kind,'unknown');
 const repayment={id:'repay',provider:'ccb',status:'completed',kind:'expense',direction:'debit',description:'\u6d88\u8d39 (\u7279\u7ea6)\u5fae\u7c92\u8d37(\u4fe1\u8d37\u8fd8\u6b3e)',counterparty:'(\u7279\u7ea6)\u5fae\u7c92\u8d37(\u4fe1\u8d37\u8fd8\u6b3e)',statementFlow:{schema:'ccb-debit-v1'}};assert.equal(classifyBankPurpose(repayment).kind,'debt_payment');assert.equal(classifyBankPurpose({...repayment,direction:'credit'}).kind,'expense');
 const draw={id:'draw',provider:'alipay',status:'completed',kind:'transfer',direction:'neutral',description:'\u4e2a\u4eba\u6d88\u8d39\u8d37\u6b3e\u653e\u6b3e',counterparty:'\u8682\u8681\u501f\u5457'};assert.equal(classifyPlatformPurpose(draw).kind,'loan_drawdown');assert.equal(classifyPlatformPurpose({...draw,counterparty:'\u666e\u901a\u5546\u6237'}).kind,'transfer');
}
const assert=require('node:assert/strict'),{classifyBankPurpose,classifyPlatformPurpose}=require('./bankClassification');
{
 const shipping={id:'shipping',provider:'alipay',status:'completed',kind:'refund',direction:'debit',description:'\u6dd8\u5b9d\u9000\u8d27-\u5bc4\u4ef6\u8d39_123',rawFields:{'\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u5206\u7c7b':'\u751f\u6d3b\u670d\u52a1'}},before=JSON.stringify(shipping);assert.equal(classifyPlatformPurpose(shipping).kind,'expense');assert.equal(JSON.stringify(shipping),before);
 for(const patch of [{direction:'credit'},{status:'failed'},{description:'\u9000\u6b3e-\u6dd8\u5b9d\u9000\u8d27-\u5bc4\u4ef6\u8d39_123'},{rawFields:{'\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u5206\u7c7b':'\u9000\u6b3e'}}]){const o={...shipping,...patch};assert.equal(classifyPlatformPurpose(o),o);}
}
const original=(summary,direction='credit',remark='')=>({id:'original',provider:'ccb',kind:'unknown',direction,status:'completed',statementFlow:{schema:'ccb-debit-v1'},rawFields:{'\u6458\u8981':summary,'\u4ea4\u6613\u5730\u70b9/\u9644\u8a00':remark}});
for(const [summary,direction,remark,expected] of [
 ['ATM\u53d6\u6b3e','debit','','transfer'],['ATM\u5b58\u6b3e','credit','','transfer'],['\u73b0\u91d1\u5b58\u5165','credit','','transfer'],
 ['\u94f6\u8054\u5165\u8d26','credit','\u4f59\u989d\u5b9d\u8f6c\u51fa\u5230\u5361','transfer'],['\u65e0\u5361\u81ea\u52a9\u4ea4\u6613','debit','(\u7279\u7ea6)\u638c\u4e0a\u751f\u6d3b\u8fd8\u6b3e','debt_payment'],
 ['\u94f6\u8f6c\u8bc1','debit','\u94f6\u884c\u8f6c\u8bc1\u5238****8253\u8f6c\u5165013','transfer'],['\u8bc1\u5238\u8f6c\u94f6\u884c****8253\u8f6c\u51fa013','credit','','transfer'],
 ['\u652f\u4ed8\u673a\u6784\u63d0\u73b0','credit','\u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0','transfer'],['\u8f6c\u8d26\u5b58\u5165','credit','\u4f59\u989d\u5b9d\u63d0\u73b0','transfer'],
 ['\u501f\u5457\u653e\u6b3e','credit','','loan_drawdown'],['\u7406\u8d22\u4ea7\u54c1\u7533\u8d2d','debit','','transfer'],['\u6570\u5b57\u4eba\u6c11\u5e01\u5151\u51fa','debit','','transfer']
]){const o=original(summary,direction,remark),copy=JSON.stringify(o),r=classifyBankPurpose(o);assert.equal(r.kind,expected);assert.equal(JSON.stringify(o),copy);assert.deepEqual(r.automaticClassification.evidenceObservationIds,['original']);}
for(const o of [original('ATM\u53d6\u6b3e','credit'),original('\u501f\u5457\u653e\u6b3e','debit'),original('\u8de8\u884c\u8f6c\u51fa','debit'),original('\u7535\u5b50\u6c47\u5165'),{...original('ATM\u53d6\u6b3e','debit'),kind:'expense'},{...original('ATM\u53d6\u6b3e','debit'),status:'pending'},{...original('ATM\u53d6\u6b3e','debit'),provider:'generic'},{...original('\u8f6c\u8d26','debit'),counterparty:'\u57fa\u91d1\u8d4e\u56de\u5546\u5e97'}])assert.equal(classifyBankPurpose(o),o,'direction, explicit bank purpose, source schema and existing classification are required');
console.log('CCB explicit cash, securities, wallet, investment and loan purposes preserve ambiguous transfers and immutable sources');
const wechatTransfer={...original('','debit'),kind:'expense',description:'\u6d88\u8d39 \u8d22\u4ed8\u901a-\u5fae\u4fe1\u652f\u4ed8:\u5fae\u4fe1\u8f6c\u8d26'};assert.equal(classifyBankPurpose(wechatTransfer).kind,'transfer');for(const changed of [{description:'\u6d88\u8d39 \u8d22\u4ed8\u901a-\u5fae\u4fe1\u652f\u4ed8:\u5fae\u4fe1\u8f6c\u8d26\u5546\u5e97'},{direction:'credit'},{status:'pending'},{statementFlow:undefined}]){const o={...wechatTransfer,...changed};assert.equal(classifyBankPurpose(o),o);}

const refund={...original('', 'credit'),provider:'mybank',statementFlow:{schema:'mybank-current-v1'},description:'\u5feb\u6377\u652f\u4ed8\u9000\u6b3e-\u652f\u4ed8\u5b9d-merchant'};assert.equal(classifyBankPurpose(refund).kind,'refund');assert.equal(classifyBankPurpose({...refund,direction:'debit'}).kind,'unknown');
const tax={...original('', 'credit'),provider:'huaxia',statementFlow:{schema:'huaxia-debit-v1'},description:'\u4eba\u884c\u5c0f\u989d\u6c47\u5165 \u9000\u5e93\u7535\u5b50\u9000\u5e93',counterparty:'\u897f\u6e56\u533a\u56fd\u5e93'};assert.equal(classifyBankPurpose(tax).kind,'income');assert.equal(classifyBankPurpose({...tax,counterparty:'Shop'}).kind,'unknown');

for(const [description,direction,expected] of [
 ['\u8de8\u884c\u8f6c\u51fa 2023.9.17-12.16\u623f\u79df','debit','expense'],
 ['\u624b\u673a\u94f6\u884c\u8f6c\u8d26 \u8f66\u4f4d926,2026.7-2026.9','debit','expense'],
 ['\u624b\u673a\u94f6\u884c\u8f6c\u8d26 \u4e2d\u6d77\u6cb3\u6620\u8f66\u4f4d926\u7eed\u79df4-6\u6708','debit','expense'],
 ['\u6c47\u51fa\u5883\u5916 \u8f6c\u8d26\u6c47\u6b3e\u90ae\u7535\u8d39','debit','fee'],
 ['\u666e\u901a\u6c47\u5151 \u9000\u4f19\u98df\u8d39','credit','refund'],
 ['\u4eba\u884c\u8de8\u884c\u6536\u6b3e \u9000\u6b3e','credit','refund']
]){const o={...original('',direction),description};assert.equal(classifyBankPurpose(o).kind,expected);assert.equal(o.kind,'unknown');}
for(const description of ['\u8de8\u884c\u8f6c\u51fa 1\u4e2a\u6708\u62bc\u91d1+3\u4e2a\u6708\u623f\u79df','\u8f66\u4f4d\u79df\u91d14000\u548c\u62bc\u91d11000','\u623f\u79df\u501f\u6b3e','\u8f66\u4f4d926','\u666e\u901a\u8f6c\u8d26'])assert.equal(classifyBankPurpose({...original('','debit'),description}).kind,'unknown','deposits, loans and bare property references need their own evidence');
assert.equal(classifyBankPurpose({...tax,provider:'ccb',statementFlow:{schema:'ccb-debit-v1'}}).kind,'income');
assert.equal(classifyBankPurpose({...tax,statementFlow:undefined}).kind,'unknown');

const walletTopup=original('\u5145\u503c','debit','\u8d22\u4ed8\u901a-\u5fae\u4fe1\u96f6\u94b1\u5145\u503c\u8d26\u6237');assert.equal(classifyBankPurpose(walletTopup).kind,'transfer');assert.equal(classifyBankPurpose({...walletTopup,direction:'credit'}).kind,'unknown');
for(const [summary,direction,remark,counterparty,kind]of [
 ['\u7535\u5b50\u6c47\u5165','credit','\u67dc\u9762\u63d0\u53d6','\u676d\u5dde\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3','transfer'],
 ['\u5708\u5b58','debit','','DSS\u6821\u56ed\u4e00\u5361\u901a-\u6d59\u6c5f\u5927\u5b66\u6237','transfer'],
 ['\u94f6\u8054\u5165\u8d26','credit','\u4ee3\u9500\u8d4e\u56de-Example','\u6d59\u6c5f\u540c\u82b1\u987a\u57fa\u91d1\u9500\u552e\u6709\u9650\u516c\u53f8\u57fa\u91d1\u4ee3\u9500\u4e13\u6237','transfer'],
 ['\u76f4\u8fde\u5ba2\u6237\u4ee3\u6536\u4e13\u7528','debit','','\u6d59\u6c5f\u540c\u82b1\u987a\u57fa\u91d1\u9500\u552e\u6709\u9650\u516c\u53f8','transfer'],
 ['\u8de8\u884c\u4ee3\u6536','debit','(\u7279\u7ea6)\u4fe1\u7528\u5361\u5bf9\u8d26\u8fd8\u6b3e','','debt_payment'],
 ['\u65e0\u5361\u81ea\u52a9\u4ea4\u6613','debit','(\u7279\u7ea6)\u62db\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8\u4fe1\u7528\u5361\u4e2d\u5fc3','','debt_payment'],
 ['\u65e0\u5361\u81ea\u52a9\u4ea4\u6613','debit','(\u7279\u7ea6)\u817e\u90a6\u56fd\u9645\u673a\u7968\u5206\u9500','','expense']
]){const o={...original(summary,direction,remark),counterparty},raw=JSON.stringify(o);assert.equal(classifyBankPurpose(o).kind,kind);assert.equal(JSON.stringify(o),raw);assert.equal(classifyBankPurpose({...o,direction:direction==='credit'?'debit':'credit'}).kind,'unknown');}
const policyRefund={id:'policy',provider:'alipay',direction:'credit',kind:'income',status:'completed',description:'\u4fdd\u9669\u627f\u4fdd-\u9000\u4fdd\u4fdd\u8d39\u652f\u4ed8[masked]',rawFields:{'\u4ea4\u6613\u72b6\u6001':'\u9000\u6b3e\u6210\u529f'}};assert.equal(classifyPlatformPurpose(policyRefund).kind,'refund');assert.equal(policyRefund.kind,'income');assert.equal(classifyPlatformPurpose({...policyRefund,description:'\u4fdd\u9669\u7406\u8d54'}).kind,'income');
for(const description of ['\u8f66\u5e93\u7535\u6869\u652f\u4ed8\u5b9d\u5c0f\u7a0b\u5e8f\u5145\u503c','\u5145\u503c:\u963f\u91cc\u4e91\u670d\u52a1\u8d2d\u4e70']){const o={id:'service',provider:'alipay',status:'completed',direction:'debit',kind:'transfer',category:'\u5176\u4ed6',description};assert.equal(classifyPlatformPurpose(o).kind,'expense');}
for(const description of ['\u652f\u4ed8\u5b9d\u5145\u503c','\u5fae\u4fe1\u94b1\u5305\u5145\u503c','\u8d26\u6237\u4f59\u989d\u5145\u503c']){const o={id:'own-topup',provider:'alipay',status:'completed',direction:'debit',kind:'transfer',category:'\u5145\u503c\u7f34\u8d39',description};assert.equal(classifyPlatformPurpose(o),o);}

const conversion={id:'conversion',provider:'spdb',status:'completed',kind:'unknown',direction:'credit',amountMinor:'34681',description:'\u94f6\u8054\u5206\u671f\u8f6c\u5206\u671f\u4ed8\u6b3e',bankStatement:{schema:'bank-credit-detail-v1',nonCash:false},rawFields:{statementCredit:true,statementAmountMinor:'-34681'}},beforeConversion=JSON.stringify(conversion),classifiedConversion=classifyBankPurpose(conversion);assert.equal(classifiedConversion.kind,'transfer');assert.equal(classifiedConversion.direction,'neutral');assert.equal(classifiedConversion.bankStatement.nonCash,true);assert.equal(JSON.stringify(conversion),beforeConversion);
for(const patch of [{provider:'other'},{direction:'debit'},{description:conversion.description+'\u9000\u6b3e'},{rawFields:{statementCredit:true,statementAmountMinor:'-100'}},{status:'pending'}]){const o={...conversion,...patch};assert.equal(classifyBankPurpose(o),o);}

{
 const {nonCashAuthorization}=require('./bankClassification'),{buildFinanceView}=require('./ledger'),description='Merchant\u7ea2\u5305-\u975e\u73b0\u91d1\uff0c\u8fc7\u671f\u4f5c\u5e9f',o={id:'coupon',provider:'alipay',financialAccountId:'wallet',date:'2015-10-14',occurredAt:'2015-10-14T10:55:59+08:00',currency:'CNY',amountMinor:'89',direction:'neutral',kind:'transfer',status:'completed',description,counterparty:'Merchant',category:'',paymentChannel:'',paymentAccountHint:'',sourceTransactionId:'coupon',relatedReference:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u5546\u54c1\u8bf4\u660e':description,'\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f'}},ledger={accounts:[{id:'wallet',type:'wallet',provider:'alipay',label:'Wallet',currency:'CNY',status:'active'}],imports:[],observations:[o],annotations:[],links:[],balanceSnapshots:[]},before=JSON.stringify(ledger),v=buildFinanceView(ledger);
 assert(nonCashAuthorization(o));assert.equal(v.transactions.length,1);assert.equal(v.transactions[0].amountMinor,'89');assert.equal(v.review.transactionCount,0);assert.deepEqual(v.transactions[0].balanceEffects,{});assert.deepEqual(v.transactions[0].cashEffects,{});assert.equal(v.transactions[0].consumptionMinor,'0');assert.equal(v.transactions[0].incomeMinor,'0');assert.equal(JSON.stringify(ledger),before);
 for(const patch of [{direction:'credit'},{kind:'income'},{status:'failed'},{rawFields:{}},{description:'\u73b0\u91d1\u7ea2\u5305'},{paymentChannel:'\u57fa\u91d1\u4efd\u989d\u7ea2\u5305',description:'\u7ea2\u5305\u5956\u52b1\u53d1\u653e'},{accountRelations:[{role:'funding',activity:'funding_outflow'}]}])assert.equal(nonCashAuthorization({...o,...patch}),false);
}
