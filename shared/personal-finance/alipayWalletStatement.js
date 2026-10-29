'use strict';

const HEADER = ['\u6d41\u6c34\u53f7','\u65e5\u671f','\u540d\u79f0|\u5907\u6ce8','\u6536\u5165(\u5143)','\u652f\u51fa(\u5143)','\u8d26\u6237\u4f59\u989d(\u5143)','\u652f\u4ed8\u65b9\u5f0f','\u8be6\u60c5'];
const clean = value => String(value ?? '').normalize('NFKC').replace(/\s/g,'');
const fail = () => {throw new Error('BILL_WALLET_BALANCE_INVALID');};
function minor(value, optional=false) {
  const text=clean(value);
  if(optional&&!text)return 0n;
  if(!/^-?\d+\.\d{2}$/.test(text)||text.length>35)fail();
  const [integer,fraction]=text.replace('-','').split('.');
  return (BigInt(integer)*100n+BigInt(fraction))*(text.startsWith('-')?-1n:1n);
}
function parseAlipayWalletBalanceRows(rows) {
  const result={provider:'alipay',templateId:'alipay-wallet-balance-table-v1',records:[],errors:[],warnings:[{line:1,code:'BILL_BALANCE_EVIDENCE_ONLY',message:'\u4f59\u989d\u660e\u7ec6\u7528\u4e8e\u6838\u5bf9\u9010\u7b14\u8d44\u91d1\u53d8\u52a8\uff0c\u4e0d\u91cd\u590d\u8ba1\u5165\u5df2\u5bfc\u5165\u7684\u6d88\u8d39\u548c\u6536\u5165\u3002'}]};
  try {
    if(!Array.isArray(rows)||!rows.length||rows.length>100000)fail();
    const sourcePositions=new Map();
    for(const [index,row]of rows.entries()){
      if(!Array.isArray(row)||row.length!==8||row.some(cell=>typeof cell!=='string'))fail();
      const signature=JSON.stringify(row);if(!sourcePositions.has(signature))sourcePositions.set(signature,[]);sourcePositions.get(signature).push(index+1);
    }
    // Some native query pages repeat an earlier block verbatim. Keep the last
    // original occurrence without sorting, then require the full balance chain.
    // Same-reference rows with different cells remain independent and strict.
    const exactSeen=new Set(),canonical=[...rows].reverse().filter(row=>{const k=JSON.stringify(row);if(exactSeen.has(k))return false;exactSeen.add(k);return true;}),seen=new Set();let previous=null,previousTime=null;
    for(const [index,row] of canonical.entries()) {
      if(!Array.isArray(row)||row.length!==8||row.some(cell=>typeof cell!=='string'))fail();
      const [reference,time,description,inText,outText,balanceText,channel]=row.map(clean);
      if(!/^[0-9A-Za-z*_|.-]{6,128}$/.test(reference)||!/^20\d{2}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}$/.test(time)||!description||!channel)fail();
      const date=time.slice(0,10),occurredAt=date+'T'+time.slice(10)+'+08:00',moment=Date.parse(occurredAt);
      if(!Number.isFinite(moment)||new Date(moment+8*3600000).toISOString().slice(0,19)!==date+'T'+time.slice(10))fail();
      const incoming=minor(inText,true),outgoing=minor(outText,true),balance=minor(balanceText);
      if(incoming<0n||outgoing>0n||Boolean(incoming)===Boolean(outgoing)||balance<0n)fail();
      if(previous!==null&&previous+incoming+outgoing!==balance||previousTime!==null&&moment<previousTime)fail();
      const event=[reference,date.replace(/-/g,'')+time.slice(10).replace(/:/g,''),String(incoming),String(-outgoing),String(balance)].join(':');
      if(seen.has(event))fail();
      seen.add(event);previous=balance;previousTime=moment;
      const positions=sourcePositions.get(JSON.stringify(row));
      result.records.push({sourceTransactionId:'alipay_wallet_balance:'+event,occurredAt,date,amountMinor:'0',currency:'CNY',direction:'neutral',kind:'transfer',description,counterparty:'',category:'\u4f59\u989d\u6838\u5bf9',paymentChannel:'\u8d26\u6237\u4f59\u989d',paymentAccountHint:'',balanceMinor:String(balance),relatedReference:reference,status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u6d41\u6c34\u53f7':reference,'\u65f6\u95f4':time,'\u540d\u79f0\u5907\u6ce8':description,'\u6536\u5165':inText,'\u652f\u51fa':outText,'\u8d26\u6237\u4f59\u989d':balanceText,'\u8d44\u91d1\u6e20\u9053':channel,sourceTableCells:[...row],...(positions.length>1?{sourceTableRowNumbers:positions}:{})},balanceEvidence:{schema:'alipay-balance-proof-v1',incomeMinor:String(incoming),expenseMinor:String(-outgoing),sourcePage:1,sequence:index+1,openingBeforeFirstMinor:index===0?String(balance-incoming-outgoing):null}});
    }
    const duplicates=rows.length-canonical.length;
    if(duplicates){result.normalization={schema:'alipay-wallet-table-normalization-v1',sourceRowCount:rows.length,canonicalRowCount:canonical.length,exactDuplicateRowCount:duplicates,policy:'retain_last_byte_identical_row_without_reordering',retainedSourceRowNumbers:canonical.map(row=>sourcePositions.get(JSON.stringify(row)).at(-1)),duplicateSourceRowGroups:[...sourcePositions.values()].filter(p=>p.length>1)};result.warnings.push({line:1,code:'BILL_EXACT_DUPLICATE_BALANCE_ROWS',count:duplicates,message:'\u539f\u4ef6\u6709 '+duplicates+' \u884c\u5b8c\u5168\u91cd\u590d\u7684\u4f59\u989d\u660e\u7ec6\uff0c\u5df2\u5408\u5e76\u5e76\u4fdd\u7559\u539f\u59cb\u884c\u53f7\uff1b\u9010\u7b14\u4f59\u989d\u6821\u9a8c\u5df2\u901a\u8fc7\u3002'});}
  } catch {
    result.records=[];
    result.errors.push({line:1,code:'BILL_WALLET_BALANCE_INVALID',message:'\u4f59\u989d\u660e\u7ec6\u7684\u65e5\u671f\u3001\u91d1\u989d\u6216\u9010\u7b14\u4f59\u989d\u672a\u901a\u8fc7\u6821\u9a8c\uff0c\u8bf7\u68c0\u67e5\u539f\u4ef6\u3002'});
  }
  return result;
}
function parseAlipayWalletCsvRows(rows,{providerHint=''}={}) {
  if(!/alipay|\u652f\u4ed8\u5b9d/i.test(providerHint))return null;
  const index=rows.findIndex((row,i)=>i<100&&!row.issue&&row.cells.length===HEADER.length&&row.cells.every((cell,j)=>clean(cell)===HEADER[j]));
  if(index<0)return null;
  const body=rows.slice(index+1).filter(row=>row.cells.some(cell=>clean(cell)));
  if(body.some(row=>row.issue))return parseAlipayWalletBalanceRows([]);
  return parseAlipayWalletBalanceRows(body.map(row=>row.cells));
}
module.exports={parseAlipayWalletBalanceRows,parseAlipayWalletCsvRows,ALIPAY_WALLET_BALANCE_HEADER:HEADER};
