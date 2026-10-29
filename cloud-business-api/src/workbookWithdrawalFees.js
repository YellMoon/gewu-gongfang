'use strict';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const SHEET='\u5b66\u8d39\u6536\u5165',SCALE=1000000000000000000n,CENT=SCALE/100n;
function scaled(v){const s=String(v??'');if(!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/.test(s))return null;const [a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(18,'0'));}
function wholeMinor(v){if(v===null)return null;const n=(v+CENT/2n)/CENT,d=v-n*CENT;return(d<0n?-d:d)<=10000000000n?String(n):null;}
function parseWorkbookWithdrawalFees(book,XLSX,{provider='wechat',ownerConfirmedBlankFeesZero=false}={}){
 if(!['wechat','alipay'].includes(provider))fail('BILL_WITHDRAWAL_FEE_PROVIDER_INVALID');const platform=provider==='alipay'?'\u652f\u4ed8\u5b9d':'\u5fae\u4fe1';
 const sheet=book.Sheets[SHEET];if(!sheet)fail('BILL_WITHDRAWAL_FEE_SHEET_MISSING');
 const get=(r,c)=>sheet[XLSX.utils.encode_cell({r,c})]?.v,headers=[[2,'\u5165\u8d26\u65e5\u671f'],[12,'\u5b9e\u6536\u91d1\u989d'],[13,'\u7f34\u8d39\u65b9\u5f0f'],[14,'\u624b\u7eed\u8d39']];
 if(headers.some(([c,s])=>String(get(0,c)||'').trim()!==s))fail('BILL_WITHDRAWAL_FEE_HEADER_INVALID');
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(range.e.r>10000)fail('BILL_WORKSHEET_SIZE_LIMIT');const groups=new Map(),warnings=[],errors=[];
 for(let r=1;r<=range.e.r;r++){
  if(String(get(r,13)||'').trim()!==platform)continue;const rawDate=get(r,2);let date;
  if(typeof rawDate==='number'){const d=XLSX.SSF.parse_date_code(rawDate,{date1904:!!book.Workbook?.WBProps?.date1904});if(d)date=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}else {const m=String(rawDate||'').trim().match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);if(m)date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');}
  const gross=wholeMinor(scaled(get(r,12)));if(gross==='0'&&[null,'',0,'0'].includes(get(r,14)??null))continue;
  if(provider==='alipay'&&['','\u65e0'].includes(String(rawDate??'').trim())){warnings.push({row:r+1,code:'BILL_WITHDRAWAL_FEE_DATE_UNAVAILABLE'});continue;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||gross===null||BigInt(gross)<=0n){errors.push({row:r+1,code:'BILL_WITHDRAWAL_FEE_ROW_UNAVAILABLE'});continue;}
  if(!groups.has(date))groups.set(date,{gross:0n,fees:0n,complete:true,rows:[],rawFees:[],blankInterpreted:false});
  const g=groups.get(date),rawFee=get(r,14),blank=rawFee==null||typeof rawFee==='string'&&rawFee.trim()==='',confirmedBlank=blank&&ownerConfirmedBlankFeesZero===true,fee=confirmedBlank?0n:scaled(rawFee);
  g.gross+=BigInt(gross);g.rows.push(r+1);g.rawFees.push(rawFee==null?null:String(rawFee));g.blankInterpreted||=confirmedBlank;if(fee===null)g.complete=false;else g.fees+=fee;
 }
 const records=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,g])=>{const feeMinor=g.complete?wholeMinor(g.fees):null;if(feeMinor===null)warnings.push({row:g.rows[0],code:'BILL_WITHDRAWAL_FEE_PRECISION_UNRESOLVED'});return {date,occurredAt:date+'T23:59:59+08:00',currency:'CNY',sourceTransactionId:'workbook-withdrawal-fee:'+date,kind:'transfer',direction:'neutral',status:'completed',amountMinor:'0',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,description:platform+'\u63d0\u73b0\u624b\u7eed\u8d39\u6838\u5bf9\u4f9d\u636e',counterparty:'',category:'',paymentChannel:'',paymentAccountHint:'',relatedReference:'',rawFields:{sourceSheet:SHEET,sourceRows:g.rows,rawFeeValues:g.rawFees},withdrawalFeeEvidence:{schema:'workbook-withdrawal-fee-v1',...(provider==='alipay'?{platform:'alipay'}:{}),...(g.blankInterpreted?{blankFeeInterpretation:'owner_confirmed_zero'}:{}),sourceSheet:SHEET,sourceRows:g.rows,grossMinor:String(g.gross),feeMinor,rawFeeValues:g.rawFees,confirmation:'owner_confirmed_actual_fees'}};});
 return {provider,templateId:'workbook-withdrawal-fees-v1',records,errors:records.length?errors:[...errors,{row:1,code:'BILL_NO_RECORDS'}],warnings};
}
module.exports={parseWorkbookWithdrawalFees};
