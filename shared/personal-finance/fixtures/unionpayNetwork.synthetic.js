'use strict';
// Synthetic native-list capture for regression tests. Never owner evidence.
function syntheticCapture(events=[{}]){
 const bank='\u62db\u5546\u94f6\u884c',frozen='\u51bb\u7ed3',refund='\u9000\u6b3e';
 const rows=events.map((e,i)=>{
  const amount=e.amount||'12.34',native=(e.frozen?'':e.direction==='credit'?'+':'-')+'\u00a5'+amount,title=e.title||'Synthetic merchant',time='12:34',issuer=e.bank||bank,tail=e.tail||'1234';
  return {recordId:'UI-2026-'+String(i+1).padStart(5,'0'),date:e.date||'2026-10-01',time,timePrecision:'displayed_minute',timeAccuracyVerified:false,title,bankLabel:issuer,cardLast4:tail,signedAmountCNY:(native.startsWith('-')?'-':'')+amount,amountCents:Math.round(Number(amount)*100)*(native.startsWith('-')?-1:1),accountDirection:native.startsWith('-')?'outgoing':'incoming',dateBasis:'visible_date_label',sourceYearSection:2026,sourceScope:'unionpay_network_transactions',listRowSequence:i+1,nativeRowTextVerified:true,nativeRowCandidateTexts:[[title,native,issuer+'['+tail+'] \u00b7 '+time,...(e.frozen?[frozen]:e.refund?[refund]:[])]],nativeRowStatus:e.frozen?[frozen]:e.refund?[refund]:[],nativeAmountTexts:[native],nativeNonCashAuthorization:Boolean(e.frozen),nativeSignExplicit:!e.frozen,nativeUnsignedAmount:Boolean(e.frozen),financialDirectionForReview:e.frozen?'noncash_authorization':native.startsWith('-')?'outgoing':'incoming'};
 });
 return {summary:{rows:rows.length,nativeRowTextVerified:rows.length,rowsNeedingSourceTextCheck:0,sourceSha256:'a'.repeat(64),noncashAuthorizationRows:events.filter(e=>e.frozen).length,nativeStatusCounts:{[frozen]:events.filter(e=>e.frozen).length,[refund]:events.filter(e=>e.refund).length}},transactions:rows};
}
module.exports={syntheticCapture};
