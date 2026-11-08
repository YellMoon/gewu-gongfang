'use strict';
const {nonCashAuthorization,legacyRefundPending}=require('../../shared/personal-finance/bankClassification');
// Presentation only: monetary decisions stay in the shared ledger.
/** @type {Record<string,string>} */
const PROVIDERS={psbc:'\u90ae\u50a8\u94f6\u884c',jsb:'\u6c5f\u82cf\u94f6\u884c',cib:'\u5174\u4e1a\u94f6\u884c',wechat:'\u5fae\u4fe1',alipay:'\u652f\u4ed8\u5b9d',mybank:'\u7f51\u5546\u94f6\u884c',huaxia:'\u534e\u590f\u94f6\u884c',minsheng:'\u6c11\u751f\u94f6\u884c',cmb:'\u62db\u5546\u94f6\u884c',bocom:'\u4ea4\u901a\u94f6\u884c',ccb:'\u5efa\u8bbe\u94f6\u884c',cgb:'\u5e7f\u53d1\u94f6\u884c',citic:'\u4e2d\u4fe1\u94f6\u884c',czbank:'\u6d59\u5546\u94f6\u884c',spdb:'\u6d66\u53d1\u94f6\u884c',hangzhou:'\u676d\u5dde\u94f6\u884c'};
/** @type {Record<string,string>} */
const {ISSUE_LABELS}=require('../../shared/personal-finance/issueLabels');
function accountLabel(a){return a?.type==='wallet'&&a.label==='\u5fae\u4fe1\u652f\u4ed8'?'\u5fae\u4fe1\u96f6\u94b1':a?.type==='wallet'&&a.label==='\u652f\u4ed8\u5b9d'?'\u652f\u4ed8\u5b9d\u4f59\u989d':a?.label||'\u5f85\u786e\u8ba4\u8d26\u6237';}
function accountGroup(a){return ['credit_card','loan'].includes(a.type)?'\u4fe1\u7528\u8d26\u6237':a.type==='investment'?'\u7406\u8d22\u8d26\u6237':['cash','bank','savings','debit_card','wallet'].includes(a.type)?'\u50a8\u84c4\u8d26\u6237':'\u5176\u4ed6\u8d26\u6237';}
function evidenceLabel(e){return !e?'\u4f59\u989d\u5f85\u6838\u5bf9':({billed_debt:'\u5df2\u51fa\u8d26\u5e94\u8fd8\u6b3e\uff08\u4e0d\u542b\u672a\u51fa\u8d26\uff09',available:'\u53ef\u7528\u4f59\u989d',estimated:'\u94f6\u884c\u8bd5\u7b97\u4f59\u989d',distributor_total:'\u4ee3\u9500\u673a\u6784\u8d44\u4ea7'}[e.balanceKind]||(e.source==='manual'?'\u4eba\u5de5\u6838\u5bf9':'\u8d26\u5355\u4f59\u989d'));}
function trendGranularity(start,end,choice='auto'){if(choice!=='auto')return choice;const days=(Date.parse(end)-Date.parse(start))/86400000;return Number.isFinite(days)&&days<=62?'day':days<=180?'week':'month';}
const {statisticsState}=require('../../shared/personal-finance/transactionStatisticsState');
function boundedObservationOptions(observations,query,selected=[],limit=40){const ids=new Set(selected),needle=String(query||'').trim().toLowerCase(),result=[];for(const o of observations){if(ids.has(o.id)){result.push(o);continue;}if(result.length>=limit)continue;if(!needle||[o.date,o.description,o.sourceTransactionId,o.id,o.paymentAccountHint].some(v=>String(v||'').toLowerCase().includes(needle)))result.push(o);}return result;}
const {BILL_CATEGORIES,billCategory,compareBillAmount,billTimestamp,compareBillTime,largeBillThresholds,isLargeBill}=require('../../shared/personal-finance/billPresentation');
module.exports={PROVIDERS,ISSUE_LABELS,accountLabel,accountGroup,evidenceLabel,trendGranularity,statisticsState,boundedObservationOptions,BILL_CATEGORIES,billCategory,compareBillAmount,billTimestamp,compareBillTime,largeBillThresholds,isLargeBill};
