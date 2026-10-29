'use strict';

// "Transfer/red packet" was a legacy export category, including ordinary
// paid merchant orders. Never use that category alone as a cash-flow purpose.
const excludedPurpose=/\u8f6c\u8d26|\u8f6c\u5165|\u8f6c\u51fa|\u63d0\u73b0|\u5145\u503c|\u8fd8\u6b3e|\u507f\u8fd8|\u501f\u6b3e|\u8d37\u6b3e|\u7406\u8d22|\u57fa\u91d1|\u8bc1\u5238|\u80a1\u7968|\u4fdd\u9669|\u7533\u8d2d|\u8d4e\u56de|\u5b9a\u6295|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9884\u6388\u6743|\u51bb\u7ed3|\u7ea2\u5305|\u9000\u6b3e|\u9000\u8d27|\u9000\u8d39|\u5212\u8f6c|\u5212\u62e8|\u624b\u7eed\u8d39|\u5229\u606f|\u672c\u91d1|\u8bfe\u7a0b|\u8bfe\u65f6|\u8bfe\u916c|\u5b66\u8d39|\u5de5\u8d44|\u4ecb\u7ecd\u8d39|AP.?Exam|\u521d\u4e2d\u6570\u5b66|\u9ad8\u4e2d\u6570\u5b66/;
const excludedParty=/\u94f6\u884c|\u57fa\u91d1|\u8bc1\u5238|\u91d1\u878d|\u4fe1\u6258|\u8d22\u4ed8\u901a|\u652f\u4ed8\u5b9d/;
function isLegacyAlipayPurchase(record,{excludedCounterparties=new Set()}={}){
 const raw=record.rawFields,description=String(record.description||''),reference=raw?.['\u5546\u5bb6\u8ba2\u5355\u53f7'],native=raw?.['\u4ea4\u6613\u8ba2\u5355\u53f7'];
 const meituanOrder=description.match(/^\u7f8e\u56e2\u7f51 - \u8ba2\u5355\u7f16\u53f7(\d+)$/),meituanReference=record.counterparty==='\u7f8e\u56e2/\u5927\u4f17\u70b9\u8bc4'&&meituanOrder&&typeof reference==='string'&&new RegExp('^'+meituanOrder[1]+'-\\d{10}$').test(reference)&&typeof native==='string'&&/^\d{16}$/.test(native)&&native.startsWith(String(record.date||'').replace(/-/g,''));
 const datedNative=typeof native==='string'&&native.startsWith(String(record.date||'').replace(/-/g,'')),shortNative=datedNative&&/^\d{16}$/.test(native),namedMerchantRaw=record.provider==='alipay'&&raw?.['\u4ea4\u6613\u5bf9\u65b9']===record.counterparty&&require('./mixedPayments').actualSecond(record)&&/^\d+\.\d{2}$/.test(raw?.['\u91d1\u989d']||'')&&/^\d+$/.test(record.amountMinor||'')&&BigInt(raw['\u91d1\u989d'].replace('.',''))===BigInt(record.amountMinor);
 const modernMeituanReference=namedMerchantRaw&&record.counterparty==='\u7f8e\u56e2/\u5927\u4f17\u70b9\u8bc4'&&meituanOrder&&datedNative&&/^\d{8}0000100025\d{8,16}$/.test(native)&&/^\d{20}$/.test(reference||'');
 const railwayTicketReference=namedMerchantRaw&&record.counterparty==='\u4e2d\u56fd\u94c1\u8def\u603b\u516c\u53f8\u8d44\u91d1\u6e05\u7b97\u4e2d\u5fc3'&&description==='\u706b\u8f66\u7968'&&datedNative&&/^\d{8}1100100425\d{8,16}$/.test(native)&&/^W\d{16}$/.test(reference||'')&&reference.slice(1,9)===String(record.date||'').replace(/-/g,'');
 // This literal trip accident cover is a paid travel service. Other insurance
 // products retain the conservative financial-product exclusion below.
 const travelInsuranceReference=namedMerchantRaw&&record.counterparty==='\u7f8e\u4e9a\u4fdd\u9669\u5b98\u65b9\u65d7\u8230\u5e97'&&description==='\u3010\u7f8e\u4e9a\u4fdd\u9669\u3011\u4e50\u60a0\u6e38 \u5883\u5916\u65c5\u6e38\u610f\u5916\u4fdd\u9669 \u4e1c\u5357\u4e9a\u6cf0\u56fd\u51fa\u5883\u65c5\u884c\u4fdd\u9669'&&datedNative&&/^\d{8}21\d{12,24}$/.test(native)&&/^T\d{1,4}P\d{6,}$/.test(reference||'');
 const movieDeadline=description.match(/^(\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\u524d\u4ed8\u6b3e.+\u7535\u5f71\u7968$/),deadline=movieDeadline?Date.parse('20'+movieDeadline[1].replace(' ','T')+'+08:00'):NaN,gevaraReference=namedMerchantRaw&&record.counterparty==='\u4e0a\u6d77\u683c\u74e6\u5546\u52a1\u4fe1\u606f\u54a8\u8be2\u6709\u9650\u516c\u53f8'&&shortNative&&movieDeadline&&'20'+movieDeadline[1].slice(0,8)===record.date&&Number.isFinite(deadline)&&deadline>=Date.parse(record.occurredAt)&&deadline-Date.parse(record.occurredAt)<=86400000&&/^\d{16}$/.test(reference||'')&&reference.startsWith('1'+String(record.date||'').replace(/-/g,'').slice(2));
 const baiduTicketReference=namedMerchantRaw&&record.counterparty==='\u5317\u4eac\u767e\u5ea6\u7f51\u8baf\u79d1\u6280\u6709\u9650\u516c\u53f8'&&shortNative&&/^\d{9}$/.test(reference||'')&&(/^[^\n]+\u5f71\u57ce(?:\u5355\u4eba)?\u7535\u5f71\u7968$/.test(description)||/^[^\n]+\u9762\u9986\u76d6\u6d47\u996d(?:\u9009\u4e00)?$/.test(description));
 const uberOrder=description.match(/^Uber(?: Completed| Cancelled)? @ (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/),uberTripAt=uberOrder?Date.parse(uberOrder[1].replace(' ','T')+'+08:00'):NaN,uberReference=record.counterparty==='Uber B.V.'&&uberOrder&&uberOrder[1].slice(0,10)===record.date&&Number.isFinite(uberTripAt)&&Date.parse(record.occurredAt)>=uberTripAt&&Date.parse(record.occurredAt)-uberTripAt<86400000&&raw?.['\u4ea4\u6613\u65f6\u95f4']===record.date+' '+String(record.occurredAt||'').slice(11,19)&&typeof reference==='string'&&/^[a-f0-9]{28,32}_\d{1,6}$/.test(reference)&&typeof native==='string'&&/^\d{8}0000100025\d{8,16}$/.test(native)&&native.startsWith(String(record.date||'').replace(/-/g,''))&&/^\d+\.\d{2}$/.test(raw?.['\u91d1\u989d']||'')&&/^\d+$/.test(record.amountMinor||'')&&BigInt(raw['\u91d1\u989d'].replace('.',''))===BigInt(record.amountMinor);
 // These literal services are consumed purchases, with no redeemable investment
 // or wallet balance. Retain the conservative exclusion for other insurance/top-ups.
 const shortTripCover=namedMerchantRaw&&record.counterparty==='\u4e2d\u56fd\u5e73\u5b89\u5b98\u65b9\u65d7\u8230\u5e97'&&description==='\u3010\u5e73\u5b89\u4fdd\u9669\u3011\u5883\u5185\u4e2a\u4eba\u77ed\u671f\u5ea6\u5047\u65c5\u6e38\u610f\u5916\u533b\u7597\u4fdd\u9669 \u56fd\u5185\u65c5\u884c\u4fdd\u969c\u9669'&&/^T1102P\d{6,}$/.test(reference||'');
 const buyerFreightCover=namedMerchantRaw&&record.counterparty==='\u4f17\u5b89\u4fdd\u9669'&&/^\u4fdd\u9669-\u4e70\u5bb6\u7248\u8fd0\u8d39\u9669-.{2,200}\u7b49$/.test(description)&&/^T1100P\d{6,}$/.test(reference||'');
 const documentService=namedMerchantRaw&&['\u4e1c\u5357\u4e9a\u81ea\u8d38\u57ce','\u7f51\u7edc\u670d\u52a1\u79d8\u4e66'].includes(record.counterparty)&&/^\u767e\u5ea6\u6587\u5e93 \u767e\u5ea6\u6587\u5e93\u4e0b\u8f7d\u5238 \u767e\u5ea6(?:\u6587\u5e93|\u4f1a\u5458)\u8d22\u5bcc\u503c \u79ef\u5206\u5377\u6c38\u4e45 (?:\u4f1a\u5458\u5145\u503c|vip\u5145\u503c\u53f7)$/.test(description)&&/^T200P\d{6,}$/.test(reference||'');
 const explicitConsumedService=travelInsuranceReference||shortTripCover||buyerFreightCover||documentService;
 // A bank may be the collecting acquirer while the original title names the
 // restaurant. Keep the separately printed payer and actual paid amount intact.
 const restaurantAcquirerReference=namedMerchantRaw&&datedNative&&record.counterparty==='\u5174\u4e1a\u94f6\u884c\u652f\u4ed8\u5b9d\u5546\u6237'&&/^\u6768\u56fd\u798f\u9ebb\u8fa3\u70eb.{2,40}\u5e97$/.test(description)&&/^\d{30}$/.test(reference||'')&&reference.slice(12,20)===record.date.replace(/-/g,'')&&/^.{2,12}\u94f6\u884c(?:\u4fe1\u7528\u5361|\u50a8\u84c4\u5361)\(\d{4}\)(?:&\u4f18\u60e0)?$/.test(record.paymentChannel||'');
 const oldRetailGateway=namedMerchantRaw&&datedNative&&/^\d{8}0000100025\d{8,16}$/.test(native||'')&&raw['\u4ea4\u6613\u65f6\u95f4']===record.date+' '+record.occurredAt.slice(11,19),oldMealReference=oldRetailGateway&&record.counterparty==='\u767e\u5ea6\u5728\u7ebf\u7f51\u7edc\u6280\u672f\uff08\u5317\u4eac\uff09\u6709\u9650\u516c\u53f8'&&/^\d{9}$/.test(reference||'')&&/^[^\n]{1,40}(?:\u996d\u5e84|\u53a8\u623f)(?:\uff08[^\uff08\uff09\n]{1,20}\u5e97\uff09)?$/.test(description),oldGroceryReference=oldRetailGateway&&record.counterparty==='\u4e0a\u6d77\u672c\u6765\u751f\u6d3b\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8'&&/^\d{10}$/.test(reference||'')&&description===reference;
 if(record.provider!=='alipay'||record.currency!=='CNY'||record.status!=='completed'||record.kind!=='transfer'||record.direction!=='debit'||BigInt(record.amountMinor)<=0n||!raw
  ||['kind','\u4ea4\u6613\u7c7b\u578b','\u4e1a\u52a1\u7c7b\u578b'].some(k=>Object.hasOwn(raw,k))
  ||raw['\u4ea4\u6613\u5206\u7c7b']!=='\u8f6c\u8d26\u7ea2\u5305'||record.category!==raw['\u4ea4\u6613\u5206\u7c7b']||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'
  ||raw['\u5546\u54c1\u8bf4\u660e']!==description||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==record.paymentChannel||native!==record.sourceTransactionId||reference!==record.relatedReference||typeof reference!=='string'||!reference||typeof native!=='string'
  ||!(/^\d{8}21\d{12,24}$/.test(native)||/^T\d{1,4}P\d{6,}$/.test(reference)||meituanReference||uberReference||modernMeituanReference||gevaraReference||baiduTicketReference||railwayTicketReference||oldMealReference||oldGroceryReference)
  ||!description||description==='/'||/^(?:\u4ed8\u6b3e|\u652f\u4ed8|\u6536\u6b3e|\u4ea4\u6613)(?:$|[-\uff0d])/.test(description)||excludedPurpose.test(description)&&!explicitConsumedService||excludedParty.test(record.counterparty||'')&&!restaurantAcquirerReference||excludedCounterparties.has(String(record.counterparty||'').normalize('NFKC').trim())
  ||record.accountRelations?.some(r=>r.role!=='funding'||!['funding_outflow','credit_charge'].includes(r.activity)))return false;
 return true;
}
function refreshLegacyAlipayPurchase(record,options){
 if(!isLegacyAlipayPurchase(record,options))return record;
 return {...record,kind:'expense',automaticClassification:{method:'explicit_legacy_alipay_paid_order',confidence:'original_debit_success_and_native_order',evidenceObservationIds:[record.id]}};
}
function restoredLegacyPurchasePurposes(observations,annotations,options){
 if(!annotations.some(a=>a.reset))return new Map();
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),histories=new Map(),latest=new Map();
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 for(const a of annotations){const o=byId.get(a.observationId);if(!o)continue;const k=identity(o);if(!histories.has(k))histories.set(k,[]);histories.get(k).push(a);}
 const result=new Map();
 for(const[k,history]of histories){
  const last=history.reduce((a,b)=>BigInt(a.revision)>BigInt(b.revision)?a:b),source=latest.get(k);
  // A cleared expense/category edit no longer suppresses the source parser.
  // Financial edits, old transfer decisions, family/task purposes and active
  // decisions retain the existing conservative override behavior.
  if(!last.reset||!history.some(a=>!a.reset)||!history.every(a=>a.reset?a.patch&&Object.keys(a.patch).length===0:a.patch?.kind==='expense'&&Object.keys(a.patch).every(k=>['kind','category'].includes(k)))||!isLegacyAlipayPurchase(source,options))continue;
  const converted=refreshLegacyAlipayPurchase(source,options);result.set(source.id,{...converted,automaticClassification:{...converted.automaticClassification,restoredAfterPurposeResetAnnotationId:last.id,resetOnlyHistoryPreserved:true}});
 }
 return result;
}
function requiresPurposeReview(annotation){
 const p=annotation?.reset?null:annotation?.patch;
 return p?.kind==='transfer'&&typeof p.category==='string'&&(/^(?:\u7528\u9014\u5f85\u786e\u8ba4\uff1a|\u5bb6\u5ead\u7f51\u5e97\u8ba2\u5355\u6027\u8d28\u5f85\u6838\u5bf9\uff08\u7528\u6237\u56de\u5fc6\uff09$)/.test(p.category));
}
function sourceOnlyPurposeReview(record,annotation){
 // A purpose-only expense decision does not revoke a confirmed payer identity,
 // including the first decision. Card matching still needs its existing policy.
 return !annotation?.reset&&(requiresPurposeReview(annotation)||annotation?.patch?.kind==='expense')&&record?.provider==='alipay'&&record.status==='completed'&&record.kind==='transfer'&&record.direction==='debit'&&Object.keys(annotation.patch).every(k=>['kind','category'].includes(k));
}
module.exports={isLegacyAlipayPurchase,refreshLegacyAlipayPurchase,restoredLegacyPurchasePurposes,requiresPurposeReview,sourceOnlyPurposeReview};
