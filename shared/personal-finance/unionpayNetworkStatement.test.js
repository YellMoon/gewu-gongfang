'use strict';
// All fixtures are synthetic, not owner transaction evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const {parseUnionpayNetworkCapture:parse,validateBankNetwork,bindUnionpayNetworkAccounts:bind}=require('./unionpayNetworkStatement');
const bank='\u62db\u5546\u94f6\u884c',freeze='\u51bb\u7ed3',refund='\u9000\u6b3e';
function row(n,{native='-\u00a512.34',status,title='Synthetic shop',dateBasis='visible_date_label'}={}){
 const unsigned=native.replace(/^[+-]?\u00a5/,'').replace(/,/g,''),sign=native.startsWith('-')?-1:1;
 return {recordId:'UI-2026-'+String(n).padStart(5,'0'),date:'2026-10-01',time:'12:34',timePrecision:'displayed_minute',timeAccuracyVerified:false,title,bankLabel:bank,cardLast4:'1234',signedAmountCNY:(sign<0?'-':'')+unsigned,amountCents:Math.round(Number(unsigned)*100)*sign,accountDirection:sign<0?'outgoing':'incoming',dateBasis,sourceYearSection:2026,sourceScope:'unionpay_network_transactions',listRowSequence:n,nativeRowTextVerified:true,nativeRowCandidateTexts:[[title,native,bank+'[1234] \u00b7 12:34',...(status?[status]:[])]],nativeRowStatus:status?[status]:[],nativeAmountTexts:[native],nativeNonCashAuthorization:status===freeze,nativeSignExplicit:/^[+-]/.test(native),nativeUnsignedAmount:!/^[-+]/.test(native),financialDirectionForReview:status===freeze?'noncash_authorization':sign<0?'outgoing':'incoming'};
}
function capture(rows){return {summary:{rows:rows.length,nativeRowTextVerified:rows.length,rowsNeedingSourceTextCheck:0,sourceSha256:'a'.repeat(64),noncashAuthorizationRows:rows.filter(r=>r.nativeNonCashAuthorization).length,nativeStatusCounts:{[freeze]:rows.filter(r=>r.nativeNonCashAuthorization).length,[refund]:rows.filter(r=>r.nativeRowStatus.includes(refund)).length}},transactions:rows};}
const account=(extra={})=>({id:'own-cny-card',provider:bank,maskedIdentifier:'1234',type:'credit_card',currency:'CNY',status:'active',...extra});
test('native unsigned freeze keeps face amount but never becomes incoming cash',()=>{
 const p=parse(capture([row(1,{native:'\u00a526.00',status:freeze})]));assert.deepEqual(p.errors,[]);
 const r=p.records[0];assert.equal(r.amountMinor,'2600');assert.equal(r.direction,'neutral');assert.equal(r.kind,'unknown');assert.equal(r.status,'pending');assert.equal(r.rawFields.originalCapturedDirection,'incoming');assert.equal(r.bankNetwork.nativeStatus,'frozen');
 const x=structuredClone(r);x.direction='credit';x.status='completed';assert.throws(()=>validateBankNetwork(x.bankNetwork,x));
});
test('refunds reduce credit debt without being classified as ordinary income',()=>{
 const p=parse(capture([row(1,{native:'+\u00a51,234.50',status:refund})]));assert.deepEqual(p.errors,[]);const r=p.records[0];assert.equal(r.amountMinor,'123450');assert.equal(r.kind,'refund');assert.equal(r.direction,'credit');assert.equal(r.sourceTransactionId,'');assert.equal(r.balanceMinor,null);assert.equal(r.bankStatement,undefined);assert.equal(r.statementFlow,undefined);
});
test('ordinary incoming channel rows do not manufacture an income purpose',()=>{
 const p=parse(capture([row(1,{native:'+\u00a5100.00'})]));assert.deepEqual(p.errors,[]);assert.equal(p.records[0].kind,'unknown');
});
test('repayment title does not choose a card type or invent a receiving account',()=>{
 const p=parse(capture([row(1,{native:'+\u00a5100.00',title:'\u4fe1\u7528\u5361\u8fd8\u6b3e'})]));assert.deepEqual(p.errors,[]);assert.equal(p.records[0].kind,'debt_payment');assert.equal(p.records[0].bankAccount,undefined);assert.equal(p.records[0].accountRelations,undefined);
});
test('displayed minute and continued list dates retain their accuracy limits',()=>{
 const p=parse(capture([row(1,{dateBasis:'continuous_list_order'})]));assert.deepEqual(p.errors,[]);const r=p.records[0];assert.equal(r.occurredAt,'2026-10-01T23:59:59+08:00');assert.equal(r.bankNetwork.timePrecision,'day');assert.equal(r.bankNetwork.displayedTime,'12:34');assert.equal(r.bankNetwork.timeAccuracyVerified,false);assert.equal(r.bankNetwork.dateBasis,'continuous_list_order');assert.equal(r.bankNetwork.bankPostingDatePrinted,false);assert.equal(r.bankNetwork.bankTransactionIdPrinted,false);assert.equal(r.bankNetwork.scope,'channel_only');
});
test('correct grouping punctuation parses to exact integer cents',()=>{
 const p=parse(capture([row(1,{native:'-\u00a512,345,678.90'})]));assert.deepEqual(p.errors,[]);assert.equal(p.records[0].amountMinor,'1234567890');
 const bad=capture([row(1)]);bad.transactions[0].nativeRowCandidateTexts[0][1]='-\u00a512,34.00';assert(p.errors.length===0);assert.equal(parse(bad).errors[0].code,'BILL_NETWORK_ROW_INVALID');
});
test('a bare extraction lacking native list text is rejected',()=>{
 const p=parse({transactions:[row(1)],totalOrderedListRows:1});assert.equal(p.errors[0].code,'BILL_NETWORK_NATIVE_TEXT_REQUIRED');assert.equal(p.records.length,0);
});
test('duplicate capture IDs and conflicting repeated native rows fail visibly',()=>{
 const a=row(1);assert(parse(capture([a,a])).errors.some(e=>e.code==='BILL_NETWORK_ROW_INVALID'));
 const b=row(1);b.nativeRowCandidateTexts.push(['Other merchant','-\u00a512.34',bank+'[1234] \u00b7 12:34']);assert(parse(capture([b])).errors.length);
});
test('contradicting raw amounts, signs, statuses, dates and account labels are rejected',()=>{
 const mutations=[r=>r.amountCents=1234,r=>r.signedAmountCNY='-12.35',r=>r.nativeRowCandidateTexts[0][0]='Other',r=>r.nativeRowCandidateTexts[0][2]=bank+'[9999] \u00b7 12:34',r=>r.date='2026-02-30',r=>r.time='25:00',r=>r.nativeRowStatus=[refund],r=>r.timeAccuracyVerified=true,r=>r.nativeSignExplicit=false,r=>r.financialDirectionForReview='incoming'];
 for(const mutate of mutations){const r=row(1);mutate(r);assert(parse(capture([r])).errors.length,String(mutate));}
});
test('native status summary cannot silently omit freezes or refunds',()=>{
 const p=capture([row(1,{native:'\u00a526.00',status:freeze})]);p.summary.noncashAuthorizationRows=0;assert.equal(parse(p).errors[0].code,'BILL_NETWORK_TOTAL_MISMATCH');
});
test('only one active owner-scoped CNY bank and suffix binds the identity',()=>{
 const p=parse(capture([row(1)]));const before=structuredClone(p.records);
 const result=bind(p.records,[account({currency:'USD'}),account()]);assert.deepEqual(result.errors,[]);assert.deepEqual(result.records[0].bankAccount,{provider:bank,type:'credit_card',maskedIdentifier:'1234',currency:'CNY'});assert.deepEqual(p.records,before);
});
test('missing, archived, different-bank and competing types cannot invent an account',()=>{
 const records=parse(capture([row(1)])).records;
 for(const accounts of [[],[account({status:'archived'})],[account({provider:'Different bank'})],[account({maskedIdentifier:'9999'})],[account({currency:'USD'})]]){const r=bind(records,accounts);assert.equal(r.errors[0].code,'BILL_NETWORK_ACCOUNT_IDENTITY_REQUIRED');assert.equal(r.records[0].bankAccount,undefined);assert.equal(r.records.length,1);}
 const r=bind(records,[account(),account({id:'other',type:'debit_card'})]);assert.equal(r.errors[0].code,'BILL_NETWORK_ACCOUNT_AMBIGUOUS');assert.equal(r.records[0].bankAccount,undefined);
});
test('validation refuses to disguise channel-only evidence as a full bank statement',()=>{
 const r=parse(capture([row(1)])).records[0];for(const field of ['bankStatement','statementFlow','balanceEvidence']){const x=structuredClone(r);x[field]={};assert.throws(()=>validateBankNetwork(x.bankNetwork,x));}
 const x=structuredClone(r);x.sourceTransactionId='made-up-bank-id';assert.throws(()=>validateBankNetwork(x.bankNetwork,x));
});
