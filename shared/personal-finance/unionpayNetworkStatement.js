'use strict';

// A channel capture never proves complete bank coverage. Native list text owns
// signs and statuses; an unsigned freeze is not incoming money.
const SCHEMA='unionpay-network-capture-v1',CHANNEL='\u4e91\u95ea\u4ed8',FROZEN='\u51bb\u7ed3',REFUND='\u9000\u6b3e';
const BANKS=new Set(['\u62db\u5546\u94f6\u884c','\u534e\u590f\u94f6\u884c','\u5efa\u8bbe\u94f6\u884c','\u6c11\u751f\u94f6\u884c','\u5174\u4e1a\u94f6\u884c','\u4ea4\u901a\u94f6\u884c','\u6d59\u6c5f\u519c\u5546\u8054\u5408\u94f6\u884c','\u676d\u5dde\u94f6\u884c','\u5de5\u5546\u94f6\u884c','\u90ae\u50a8\u94f6\u884c','\u5e7f\u53d1\u94f6\u884c','\u6d66\u53d1\u94f6\u884c','\u6c5f\u82cf\u94f6\u884c']);
const issue=(code,message,line=1)=>({code,message,line});
const invalid=()=>{throw Object.assign(new Error('Native network row is inconsistent'),{code:'BILL_NETWORK_ROW_INVALID'});};
const dateValid=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
const isRepayment=title=>/\u4fe1\u7528\u5361\u8fd8\u6b3e|\u638c\u4e0a\u751f\u6d3b\u8fd8\u6b3e/.test(title);
const amount=text=>{const m=text.match(/^([+-]?)\u00a5((?:0|[1-9]\d{0,12}|[1-9]\d{0,2}(?:,\d{3}){1,4})\.\d{2})$/);if(m)m[2]=m[2].replace(/,/g,'');return m;};
const cents=m=>String(BigInt(m[2].split('.')[0])*100n+BigInt(m[2].split('.')[1]));
const header=(bank,tail,time)=>bank+'['+tail+'] \u00b7 '+time;
function validateBankNetwork(e,r){
 if(!e||e.schema!==SCHEMA||!BANKS.has(e.bank)||!/^\d{4}$/.test(e.cardTail)||!/^UI-20\d{2}-\d{5}$/.test(e.recordId)||e.scope!=='channel_only'||e.timePrecision!=='day'||e.timeAccuracyVerified!==false||e.bankTransactionIdPrinted!==false||e.bankPostingDatePrinted!==false||!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.displayedTime)||!['frozen','refund','settled'].includes(e.nativeStatus)||!/^[a-f0-9]{64}$/.test(e.sourceSha256)||r.currency!=='CNY'||r.balanceMinor!==null||r.bankStatement||r.statementFlow||r.balanceEvidence||r.sourceTransactionId!==''||r.relatedReference!==''||r.occurredAt!==r.date+'T23:59:59+08:00'||r.paymentChannel!==CHANNEL||r.paymentAccountHint!==e.bank+'('+e.cardTail+')')invalid();
 const raw=r.rawFields,cells=raw?.nativeRowText;
 if(raw?.captureRecordId!==e.recordId||raw.sourceSha256!==e.sourceSha256||raw.displayedTime!==e.displayedTime||raw.timeAccuracyVerified!==false||!['visible_date_label','continuous_list_order'].includes(raw.dateBasis)||raw.dateBasis!==e.dateBasis||!Array.isArray(cells)||cells.some(c=>typeof c!=='string')||cells[0]!==r.description||r.counterparty!==r.description||cells[1]!==e.nativeAmountText||cells[2]!==header(e.bank,e.cardTail,e.displayedTime)||cells.length!==(e.nativeStatus==='settled'?3:4)||e.nativeStatus!=='settled'&&cells[3]!==({frozen:FROZEN,refund:REFUND}[e.nativeStatus]))invalid();
 const m=amount(e.nativeAmountText);if(!m||cents(m)!==r.amountMinor||r.amountMinor==='0')invalid();
 const frozen=e.nativeStatus==='frozen';
 if(frozen?(m[1]!==''||r.direction!=='neutral'||r.kind!=='unknown'||r.status!=='pending'):(m[1]===''||r.direction!==(m[1]==='+'?'credit':'debit')||r.status!=='completed'))invalid();
 if(e.nativeStatus==='refund'&&(r.kind!=='refund'||r.direction!=='credit'))invalid();
 if(e.nativeStatus==='settled'&&r.kind!==(isRepayment(r.description)?'debt_payment':'unknown'))invalid();
 if(r.bankAccount&&(r.bankAccount.provider!==e.bank||r.bankAccount.maskedIdentifier!==e.cardTail||r.bankAccount.currency!=='CNY'))invalid();
 return e;
}
function nativeRow(row,sourceSha256){
 if(!row||!/^UI-20\d{2}-\d{5}$/.test(row.recordId)||!dateValid(row.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)||row.timePrecision!=='displayed_minute'||row.timeAccuracyVerified!==false||row.sourceScope!=='unionpay_network_transactions'||!['visible_date_label','continuous_list_order'].includes(row.dateBasis)||!BANKS.has(row.bankLabel)||!/^\d{4}$/.test(row.cardLast4)||typeof row.title!=='string'||!row.title||row.title.length>1000)invalid();
 if(row.nativeRowTextVerified!==true||!Array.isArray(row.nativeRowCandidateTexts)||!row.nativeRowCandidateTexts.length||row.nativeRowCandidateTexts.length>20)invalid();
 const cells=row.nativeRowCandidateTexts[0];
 if(!Array.isArray(cells)||!row.nativeRowCandidateTexts.every(c=>JSON.stringify(c)===JSON.stringify(cells)))invalid();
 const m=typeof cells[1]==='string'&&amount(cells[1]);if(!m)invalid();
 const frozen=cells[3]===FROZEN,refund=cells[3]===REFUND,minor=cents(m),statuses=cells.length===4?[cells[3]]:[];
 if((!m[1])!==frozen||refund&&m[1]!=='+'||JSON.stringify(row.nativeRowStatus)!==JSON.stringify(statuses)||JSON.stringify(row.nativeAmountTexts)!==JSON.stringify([cells[1]])||row.nativeNonCashAuthorization!==frozen||row.nativeSignExplicit!==Boolean(m[1])||row.nativeUnsignedAmount!==!m[1])invalid();
 if(row.signedAmountCNY!==(m[1]==='-'?'-':'')+m[2]||!Number.isSafeInteger(row.amountCents)||BigInt(row.amountCents)!==(m[1]==='-'?-BigInt(minor):BigInt(minor)))invalid();
 const direction=frozen?'neutral':m[1]==='+'?'credit':'debit';
 if(row.financialDirectionForReview!==(frozen?'noncash_authorization':direction==='credit'?'incoming':'outgoing'))invalid();
 if(!Number.isInteger(row.listRowSequence)||row.listRowSequence<1||row.sourceYearSection!==Number(row.date.slice(0,4))||!row.recordId.startsWith('UI-'+row.sourceYearSection+'-')||Number(row.recordId.slice(-5))!==row.listRowSequence)invalid();
 const record={sourceTransactionId:'',date:row.date,occurredAt:row.date+'T23:59:59+08:00',amountMinor:minor,currency:'CNY',direction,kind:frozen?'unknown':refund?'refund':isRepayment(row.title)?'debt_payment':'unknown',description:row.title,counterparty:row.title,category:'',paymentChannel:CHANNEL,paymentAccountHint:row.bankLabel+'('+row.cardLast4+')',balanceMinor:null,relatedReference:'',status:frozen?'pending':'completed',principalMinor:null,interestMinor:null,feeMinor:null,
  rawFields:{captureRecordId:row.recordId,displayedTime:row.time,timeAccuracyVerified:false,dateBasis:row.dateBasis,nativeRowText:[...cells],originalCapturedDirection:row.accountDirection,sourceSha256},
  bankNetwork:{schema:SCHEMA,recordId:row.recordId,bank:row.bankLabel,cardTail:row.cardLast4,scope:'channel_only',dateBasis:row.dateBasis,timePrecision:'day',displayedTime:row.time,timeAccuracyVerified:false,nativeStatus:frozen?'frozen':refund?'refund':'settled',nativeAmountText:cells[1],sourceSha256,bankTransactionIdPrinted:false,bankPostingDatePrinted:false}};
 validateBankNetwork(record.bankNetwork,record);return record;
}
function parseUnionpayNetworkCapture(input){
 const result={provider:'unionpay',templateId:SCHEMA,records:[],errors:[],warnings:[]},rows=input?.transactions,summary=input?.summary;
 if(!summary||!Array.isArray(rows)||!rows.length||rows.length>10000||summary.rows!==rows.length||summary.nativeRowTextVerified!==rows.length||summary.rowsNeedingSourceTextCheck!==0||!/^[a-f0-9]{64}$/.test(summary.sourceSha256||'')){
  result.errors.push(issue('BILL_NETWORK_NATIVE_TEXT_REQUIRED','\u9700\u8981\u5305\u542b\u539f\u59cb\u5217\u8868\u6587\u5b57\u548c\u72b6\u6001\u7684\u4e91\u95ea\u4ed8\u91c7\u96c6\u6838\u9a8c\u6587\u4ef6\u3002'));return result;
 }
 const seen=new Set();let frozen=0,refunds=0;
 for(const [i,row] of rows.entries())try{
  if(seen.has(row?.recordId))invalid();seen.add(row.recordId);const record=nativeRow(row,summary.sourceSha256);result.records.push(record);
  frozen+=record.bankNetwork.nativeStatus==='frozen';refunds+=record.bankNetwork.nativeStatus==='refund';
 }catch(error){result.errors.push(issue(error.code||'BILL_NETWORK_ROW_INVALID','\u539f\u59cb\u4e91\u95ea\u4ed8\u6587\u5b57\u4e0e\u91d1\u989d\u3001\u65e5\u671f\u6216\u72b6\u6001\u4e0d\u4e00\u81f4\u3002',i+1));}
 if(!result.errors.length&&(summary.noncashAuthorizationRows!==frozen||summary.nativeStatusCounts?.[FROZEN]!==frozen||summary.nativeStatusCounts?.[REFUND]!==refunds))result.errors.push(issue('BILL_NETWORK_TOTAL_MISMATCH','\u51bb\u7ed3\u6216\u9000\u6b3e\u6570\u91cf\u4e0e\u539f\u4ef6\u6c47\u603b\u4e0d\u4e00\u81f4\u3002'));
 result.warnings.push(issue('BILL_NETWORK_CHANNEL_ONLY','\u4ec5\u8986\u76d6\u4e91\u95ea\u4ed8\u7f51\u7edc\u4ea4\u6613\uff0c\u4e0d\u80fd\u4ee3\u66ff\u94f6\u884c\u5361\u5b8c\u6574\u6d41\u6c34\uff1b\u5bfc\u5165\u524d\u9700\u4e0e\u5df2\u6709\u8d26\u5355\u6838\u5bf9\u53bb\u91cd\u3002'));
 return result;
}
// Caller supplies owner-scoped accounts. No inferred account types or new cards.
function bindUnionpayNetworkAccounts(records,accounts){
 const errors=[],bound=[];
 for(const [i,record] of records.entries()){
  const e=record.bankNetwork;validateBankNetwork(e,record);
  const candidates=accounts.filter(a=>['debit_card','credit_card'].includes(a.type)&&a.provider===e.bank&&a.maskedIdentifier===e.cardTail&&a.currency==='CNY'&&a.status==='active');
  if(candidates.length!==1){bound.push(record);errors.push({...issue(candidates.length?'BILL_NETWORK_ACCOUNT_AMBIGUOUS':'BILL_NETWORK_ACCOUNT_IDENTITY_REQUIRED','\u8bf7\u786e\u8ba4\u8fd9\u6761\u8bb0\u5f55\u7684\u94f6\u884c\u5361\u8eab\u4efd\u548c\u8d26\u6237\u7c7b\u578b\u3002',i+1),captureRecordId:e.recordId,bank:e.bank,cardTail:e.cardTail});continue;}
  const a=candidates[0];bound.push({...record,bankAccount:{provider:e.bank,type:a.type,maskedIdentifier:e.cardTail,currency:'CNY'}});
 }
 return {records:bound,errors};
}
module.exports={parseUnionpayNetworkCapture,validateBankNetwork,bindUnionpayNetworkAccounts,UNIONPAY_NETWORK_SCHEMA:SCHEMA};
