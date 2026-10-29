'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPersonalFinanceRepository}=require('./personalFinanceRepository');
const {validateConversionTargetEstimatePolicy:validate}=require('../../shared/personal-finance/fundTargetConversions');
function fixture(){
 const source={id:'conversion',financialAccountId:'wallet',provider:'alipay',sourceTransactionId:'202608100000000003',recordFingerprint:'c'.repeat(64),date:'2026-08-10',occurredAt:'2026-08-10T10:00:00+08:00',amountMinor:'12935',currency:'CNY',direction:'neutral',kind:'transfer',status:'completed',description:'Conversion',counterparty:'',category:'Investment',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',principalMinor:null,interestMinor:null,feeMinor:'0',rawFields:{},investmentTrade:{schema:'ant-fund-confirmation-v1',tradeType:'conversion',orderId:'202608100000000003',fundCode:null,fundName:null,combination:null,sourceTradeType:'Conversion',appliedAmountMinor:'12935',appliedUnits:'100.00',confirmedAmountMinor:null,confirmedUnits:null,feeMinor:'0',confirmedAt:'2026-08-13T00:00:00+08:00',sourcePages:[1,1]}};
 const policy={schema:'fund-conversion-target-estimate-policy-v1',disabled:true,orderId:source.investmentTrade.orderId,sourceFingerprint:source.recordFingerprint};
 const state={revision:'0',annotation:null,writes:0,audits:[]},account={id:'wallet',provider:'alipay',type:'wallet',currency:'CNY',status:'active'};
 const q=async(sql,args)=>{
  if(sql.startsWith('SELECT revision'))return{rows:[{revision:state.revision}]};
  if(sql.startsWith('SELECT data FROM business.personal_finance_observations'))return{rows:[{data:structuredClone(source)}]};
  if(sql.startsWith('SELECT data FROM business.personal_finance_annotations'))return{rows:state.annotation?[{data:structuredClone(state.annotation)}]:[]};
  if(sql.startsWith('SELECT data FROM business.personal_finance_accounts'))return{rows:[{data:account}]};
  if(sql.startsWith('UPDATE business.personal_finance_owners')){state.revision=String(BigInt(state.revision)+1n);return{rows:[{revision:state.revision}]};}
  if(sql.startsWith('INSERT INTO business.personal_finance_annotations')){state.writes++;state.annotation=JSON.parse(args[5]);}
  if(sql.startsWith('INSERT INTO business.personal_finance_audit'))state.audits.push(JSON.parse(args[5]));
  return{rows:[]};
 };
 return{source,policy,state,repo:createPersonalFinanceRepository({query:q,transaction:async work=>work(q),parseBillFile:()=>({})}),auth:{tenantId:'test',actor:{accountId:'alice',roles:['teacher']},observationId:'conversion'}};
}
test('annotation API stores a source-bound cancellation and null restoration while retaining other user edits and audit history',async()=>{
 const f=fixture(),raw=JSON.stringify(f.source);
 await f.repo.annotateObservation({...f.auth,expectedRevision:'0',patch:{category:'User investment category',conversionTargetEstimate:f.policy}});
 assert.deepEqual(f.state.annotation.patch.conversionTargetEstimate,f.policy);assert.equal(f.state.annotation.revision,'1');
 await f.repo.annotateObservation({...f.auth,expectedRevision:'1',patch:{conversionTargetEstimate:null}});
 assert.equal(f.state.annotation.patch.conversionTargetEstimate,null);assert.equal(f.state.annotation.patch.category,'User investment category');assert.equal(f.state.writes,2);assert.equal(f.state.audits.length,2);assert.equal(JSON.stringify(f.source),raw);
});
test('annotation API rejects unknown fields, wrong original fingerprint or order, unsupported policies and stale revisions before saving',async()=>{
 for(const change of [p=>({...p,extra:true}),p=>({...p,disabled:false}),p=>({...p,orderId:'202608100000000009'}),p=>({...p,sourceFingerprint:'d'.repeat(64)}),p=>({...p,schema:'other'})]){
  const f=fixture();await assert.rejects(f.repo.annotateObservation({...f.auth,expectedRevision:'0',patch:{conversionTargetEstimate:change(f.policy)}}),/FUND_CONVERSION_ESTIMATE_POLICY_INVALID/);assert.equal(f.state.writes,0);assert.equal(f.state.audits.length,0);
 }
 const f=fixture();await assert.rejects(f.repo.annotateObservation({...f.auth,expectedRevision:'1',patch:{conversionTargetEstimate:f.policy}}),/REVISION_CONFLICT/);assert.equal(f.state.writes,0);
});
test('only the actual completed CNY Alipay conversion may carry a cancellation; normal purchases and another owner cannot',async()=>{
 for(const change of [s=>s.provider='wechat',s=>s.currency='USD',s=>s.status='pending',s=>s.investmentTrade.tradeType='buy']){const f=fixture();change(f.source);assert.throws(()=>validate(f.policy,f.source),/FUND_CONVERSION_ESTIMATE_POLICY_INVALID/);}
 const f=fixture();await assert.rejects(f.repo.annotateObservation({...f.auth,actor:{accountId:'other',roles:['student']},patch:{conversionTargetEstimate:f.policy}}),/ACCESS_DENIED/);assert.equal(f.state.writes,0);
});
test('desktop transaction route returns a precise 400 for invalid cancellation input instead of misreporting service unavailability',async()=>{
 const f=fixture(),routes=new Map(),app={};for(const verb of ['get','post','patch','delete'])app[verb]=(url,handler)=>routes.set(verb+' '+url,handler);
 require('./personalFinanceRoutes').registerPersonalFinanceRoutes({app,finance:f.repo,tenantId:'test',desktopContext:async()=>f.auth.actor,miniappContext:async()=>f.auth.actor});
 let status=200,body;const res={status(s){status=s;return this;},json(b){body=b;return this;}};
 await routes.get('patch /api/business/personal-finance/transactions/:observationId')({params:{observationId:'conversion'},body:{expectedRevision:'0',patch:{conversionTargetEstimate:{...f.policy,orderId:'202608100000000009'}}}},res);
 assert.equal(status,400);assert.equal(body.code,'CLOUD_PERSONAL_FINANCE_FUND_CONVERSION_ESTIMATE_POLICY_INVALID');assert.equal(f.state.writes,0);
});
