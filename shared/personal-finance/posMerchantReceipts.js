'use strict';

// These purpose decisions are exact, reversible owner annotations. Ordinary
// bank settlements and the superseded own-credit-card interpretation do not
// activate this module. Published market rates are hypotheses, not a contract.
const TUITION='\u5de5\u4f5c\u5ba4\u5b66\u8d39POS\u6536\u6b3e\uff08\u7528\u6237\u786e\u8ba4\u6d41\u5411\uff0c\u624b\u7eed\u8d39\u63a8\u7b97\uff09';
const TUITION_DOCUMENTED='\u5de5\u4f5c\u5ba4\u5b66\u8d39POS\u6536\u6b3e\uff08\u539f\u8868\u624b\u7eed\u8d39\uff0c\u5230\u8d26\u6838\u5bf9\uff09';
const PASS_THROUGH='\u4ee3\u6536\u674e\u61cb\u5237\u5361\u5468\u8f6c\u6b3e\uff08\u7528\u6237\u786e\u8ba4\u540e\u7eed\u6d41\u5411\uff09';
const UNKNOWN='POS\u5230\u8d26\uff08\u7528\u9014\u5f85\u6838\u5bf9\uff0c\u975e\u672c\u4eba\u4fe1\u7528\u501f\u6b3e\uff09';
const party='\u674e\u61cb';
const categories=new Set([TUITION,TUITION_DOCUMENTED,PASS_THROUGH,UNKNOWN]);
const isPosMerchantAnnotation=a=>categories.has(a.patch?.category);
const sourceKey=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);

function integerGrossCandidates(netMinor,rates=[55,60]){
 const net=BigInt(netMinor);if(net<=0n)return [];
 const candidates=[];
 for(const bp of rates){
  if(!Number.isInteger(bp)||bp<=0||bp>=10000)continue;
  const b=BigInt(bp),approx=net*10000n/(10000n-b),first=(approx>200n?approx-200n:100n)/100n*100n;
  for(let gross=first;gross<=approx+200n;gross+=100n){
   if(gross<=0n)continue;const num=gross*b,whole=num/10000n,rem=num%10000n;
   const halfUp=(num+5000n)/10000n,halfEven=whole+(rem>5000n||rem===5000n&&whole%2n===1n?1n:0n);
   const rounding=[];if(gross-halfUp===net)rounding.push('half_up');if(gross-halfEven===net)rounding.push('half_even');
   if(rounding.length)candidates.push({rateBasisPoints:bp,grossMinor:String(gross),feeMinor:String(gross-net),rounding});
  }
 }
 return candidates;
}

function nativePos(o,accounts){
 const a=accounts.find(a=>a.id===o.financialAccountId);
 return o.provider==='hangzhou'&&o.status==='completed'&&o.direction==='credit'&&o.currency==='CNY'&&BigInt(o.amountMinor)>0n&&o.statementFlow?.schema==='hangzhou-debit-v1'&&o.statementFlow.incomeMinor===o.amountMinor&&o.statementFlow.expenseMinor==='0'&&o.rawFields?.description===o.description&&o.rawFields?.counterparty===o.counterparty&&a?.status==='active'&&a.type==='debit_card'&&a.currency==='CNY'&&['\uff08\u7279\u7ea6\uff09\u5e73\u5b89\u94f6\u884c\uff08\u8d44\u91d1\u7ed3\u7b97\uff09','\u5e73\u5b89\u6613\u751fT1\uff08\u8d44\u91d1\u7ed3\u7b97\uff09','\uff08\u7279\u7ea6\uff09\u5e73\u5b89\u6613\u751fT1\uff08\u8d44\u91d1\u7ed3\u7b97\uff09','\u6613\u751f\u652f\u4ed8\u6709\u9650\u516c\u53f8'].includes(o.counterparty);
}

function explicitFee(o){
 const matches=[...o.description.matchAll(/pos\u624b\u7eed\u8d39(\d+\.\d{2})\u5143/gi)];
 if(matches.length!==1||!o.description.startsWith('\u94f6\u8054\u5165\u8d26/'))return null;
 const fee=BigInt(matches[0][1].replace('.','')),net=BigInt(o.amountMinor);
 return fee>0n&&fee<=net&&(o.feeMinor==null||o.feeMinor==='0'||BigInt(o.feeMinor)===fee)?{status:'explicit',confidence:'explicit_bank_statement',feeMinor:String(fee),grossMinor:String(net+fee),originalFeeText:matches[0][0],sourceObservationIds:[o.id],assumptions:[]}:null;
}

function buildPosReceiptContext(observations,accounts,routingControls={}){
 const latest=new Map();for(const o of observations){const key=sourceKey(o),prior=latest.get(key);if(!prior||(o.sourceVersionOrdinal||0)>(prior.sourceVersionOrdinal||0))latest.set(key,o);}
 const rows=[...latest.values()],byStatement=new Map();
 for(const o of rows)if(o.statementFlow?.schema==='hangzhou-debit-v1'){
  const key=JSON.stringify([o.financialAccountId,o.importId]);if(!byStatement.has(key))byStatement.set(key,[]);byStatement.get(key).push(o);
 }
 for(const list of byStatement.values())list.sort((a,b)=>a.statementFlow.sequence-b.statementFlow.sequence);
 const anchors=rows.filter(o=>nativePos(o,accounts)&&explicitFee(o)?.feeMinor==='4400'&&explicitFee(o)?.grossMinor==='800000');
 return {rows,byStatement,anchors,posReceipts:rows.filter(o=>nativePos(o,accounts)),routingControls};
}

function posMerchantReceipt(record,sources,annotations,accounts,context){
 const decision=annotations.find(isPosMerchantAnnotation);if(!decision)return null;
 const versions=new Map();for(const o of sources){const key=sourceKey(o),prior=versions.get(key);if(!prior||(o.sourceVersionOrdinal||0)>(prior.sourceVersionOrdinal||0))versions.set(key,o);}
 if(versions.size!==1)return null;const source=[...versions.values()][0];if(!nativePos(source,accounts))return null;
 const category=decision.patch.category,purpose=[TUITION,TUITION_DOCUMENTED].includes(category)?'studio_tuition':category===PASS_THROUGH?'third_party_pos_pass_through':'unresolved';
 if(record.kind!==(purpose==='studio_tuition'?'income':purpose==='third_party_pos_pass_through'?'transfer':'unknown'))return null;
 const sequence=context.byStatement.get(JSON.stringify([source.financialAccountId,source.importId]))||[],index=sequence.findIndex(o=>o.id===source.id),next=index>=0?sequence.slice(index+1,index+6):[],net=BigInt(source.amountMinor);
 const studio=accounts.filter(a=>a.status==='active'&&a.currency==='CNY'&&a.type==='debit_card'&&a.fundsRole==='studio_public'&&a.maskedIdentifier==='2110');
 let onward=[],routeBasis=null,bridge=null;
 const target=o=>o.direction==='debit'&&(purpose==='studio_tuition'?o.rawFields?.counterAccount==='****2110'&&studio.length===1:purpose==='third_party_pos_pass_through'?[party,'\u652f\u4ed8\u5b9d-'+party].includes(o.counterparty):false);
 const exact=next.filter(o=>target(o)&&o.amountMinor===source.amountMinor);
 if(exact.length===1){onward=exact;routeBasis='unique_next_native_transfer_equals_net';}
 else if(next.length>=2&&next.slice(0,2).every(target)&&next.slice(0,2).reduce((sum,o)=>sum+BigInt(o.amountMinor),0n)===net){onward=next.slice(0,2);routeBasis='consecutive_two_native_transfers_equal_net';}
 else if(purpose==='studio_tuition'&&next[0]&&target(next[0])&&next[0].description.includes('\u5b66\u8d39')&&source.balanceMinor===next[0].amountMinor&&BigInt(next[0].amountMinor)-net===4n&&next[0].balanceMinor==='0'){
  onward=[next[0]];routeBasis='whole_balance_tuition_sweep_includes_prior_four_cents';
 }
 if(purpose==='studio_tuition'&&!onward.length&&studio.length===1){bridge=require('./posStudioBankBridge').findPosStudioBankBridge(source,next,studio[0],accounts,context);if(bridge){onward=[bridge.terminalTransfer];routeBasis='unique_original_bank_route_via_cleared_mybank_to_studio';}}
 if(purpose==='studio_tuition'&&!onward.length&&studio.length===1){bridge=require('./posStudioProductBridge').findPosStudioProductBridge(source,next,studio[0],accounts,context);if(bridge){onward=[bridge.terminalTransfer];routeBasis='unique_original_platform_yuebao_route_to_studio';}}
 if(purpose!=='unresolved'&&!onward.length)return null;
 // A chronological sequence plus the owner's routing decision is required;
 // matching arbitrary equal amounts elsewhere never establishes purpose.
 if(onward.some(o=>o.date<source.date||Date.parse(o.date)-Date.parse(source.date)>31*86400000))return null;
 const originalSource=context.rows.find(o=>sourceKey(o)===sourceKey(source))||source;
 let fee=explicitFee(originalSource);
 // A documentary annotation preserves the original statement and links through
 // the annotation audit. It is distinct from a fee written on the bank original.
 // Later actual bank fee text takes precedence over this earlier reconciliation.
 if(!fee&&category===TUITION_DOCUMENTED&&/^(0|[1-9]\d*)$/.test(String(decision.patch.feeMinor))){
  const actual=BigInt(decision.patch.feeMinor),gross=net+actual;
  if(actual<=net&&gross%100n===0n)fee={status:'documented_annotation',confidence:'document_supported_annotation',feeMinor:String(actual),grossMinor:String(gross),sourceObservationIds:[source.id],annotationId:decision.id,documentarySource:'owner_workbook_annotation',assumptions:[],reversible:true,autoCorrectOnActualEvidence:true};
 }
 const separateFee=context.rows.some(o=>o.id!==source.id&&o.financialAccountId===source.financialAccountId&&o.date===source.date&&o.direction==='debit'&&o.kind==='fee'&&/pos/i.test(o.description));
 if(separateFee)fee={status:'unknown',confidence:'separate_fee_requires_reconciliation',feeMinor:null,grossMinor:null,assumptions:[]};
 if(!fee){
  const candidates=integerGrossCandidates(source.amountMinor),preferred=candidates.filter(c=>c.rateBasisPoints===55);
  fee=preferred.length===1&&context.anchors.length&&(!source.feeMinor||source.feeMinor==='0')?{status:'estimated',confidence:'owner_authorized_rate_and_integer_gross_inference',...preferred[0],candidates,sourceObservationIds:[source.id,...context.anchors.map(o=>o.id)],assumptions:['rate_0.55_percent','whole_yuan_gross','no_fixed_fee','no_cap','single_rate_for_settlement_batch','fee_rounded_to_cent'],reversible:true,autoCorrectOnActualEvidence:true}:{status:'unknown',confidence:'fee_model_does_not_reconcile',feeMinor:null,grossMinor:null,candidates,assumptions:[]};
 }
 return {method:'owner_confirmed_pos_onward_purpose',confidence:purpose==='unresolved'?'purpose_unresolved':'owner_confirmed_onward_route',purpose,sourceObservationId:source.id,receivingAccountId:source.financialAccountId,netMinor:source.amountMinor,onwardObservationIds:onward.map(o=>o.id),onwardMinor:String(onward.reduce((sum,o)=>sum+BigInt(o.amountMinor),0n)),routeBasis,...(bridge?{bridgeEvidence:bridge.evidence}:{}),...(purpose==='studio_tuition'?{studioAccountId:studio[0].id}:{}),fee,feeStatistics:purpose==='studio_tuition'?'studio_collection_cost':purpose==='third_party_pos_pass_through'?'counterparty_withholding_not_personal_expense':'not_posted_pending_purpose',cardChargeIndependentlyVerified:false,reversible:true};
}
module.exports={TUITION,TUITION_DOCUMENTED,PASS_THROUGH,UNKNOWN,isPosMerchantAnnotation,integerGrossCandidates,buildPosReceiptContext,posMerchantReceipt};
