'use strict';
const {validDate}=require('../../shared/personal-finance/ledger');
const HEADERS=['订单号','交易时间','交易类型','基金名称','组合基金名称','基金代码','申请金额','申请份额','确认金额','确认份额','手续费','确认日期'];
const clean=value=>String(value??'').normalize('NFKC').replace(/\s/g,'');
const failure=code=>Object.assign(new Error(code),{code});
const cluster=values=>{const groups=[];for(const value of [...values].sort((a,b)=>a-b)){const last=groups.at(-1);if(last&&Math.abs(value-last.sum/last.count)<1.5){last.sum+=value;last.count++;}else groups.push({sum:value,count:1});}return groups.map(g=>g.sum/g.count);};
function cellsFromPages(pages){
 const headerPage=pages.find(page=>HEADERS.every(label=>page.items.some(item=>clean(item.str)===label)));
 if(!headerPage)throw failure('BILL_FUND_PDF_HEADER_MISSING');
 const centers=HEADERS.map(label=>{const item=headerPage.items.find(item=>clean(item.str)===label);return item.x+item.width/2;});
 const xs=cluster(headerPage.bounds.filter(b=>Math.abs(b[2]-b[0])<1&&b[3]-b[1]>5&&b[0]>centers[0]-30&&b[0]<centers.at(-1)+30).map(b=>(b[0]+b[2])/2));
 if(xs.length!==13||centers.some((x,i)=>!(x>xs[i]&&x<xs[i+1])))throw failure('BILL_FUND_PDF_GRID_INVALID');
 const rows=[];
 for(const page of pages){
  const ys=cluster(page.bounds.filter(b=>Math.abs(b[3]-b[1])<1&&xs.some((x,i)=>i<12&&Math.abs(b[0]-x)<1.6&&Math.abs(b[2]-xs[i+1])<1.6)).map(b=>(b[1]+b[3])/2)).reverse();
  let physical=0;
  for(let i=0;i<ys.length-1;i++){
   const top=ys[i],bottom=ys[i+1];if(top-bottom<3)continue;if(top-bottom>160)throw failure('BILL_FUND_PDF_GRID_INVALID');
   const cells=Array.from({length:12},(_,column)=>page.items.filter(item=>item.str.trim()&&item.y<top+0.5&&item.y>bottom-0.5&&item.x+item.width/2>xs[column]&&item.x+item.width/2<xs[column+1]).sort((a,b)=>Math.abs(a.y-b.y)>1?b.y-a.y:a.x-b.x).map(item=>item.str).join(' '));
   if(!cells.some(cell=>clean(cell)))continue;if(clean(cells[0])===HEADERS[0])continue;
   const row={cells,page:page.number,endPage:page.number};
   if(!clean(cells[5])&&!clean(cells[2])){
    const previous=rows.at(-1);if(physical!==0||!previous||previous.endPage!==page.number-1||[5,6,7,8,9,10].some(column=>clean(previous.cells[column])&&clean(cells[column])))throw failure('BILL_FUND_PDF_CONTINUATION_INVALID');
    previous.cells=previous.cells.map((value,column)=>value+' '+cells[column]);previous.endPage=page.number;
   }else rows.push(row);
   physical++;
  }
 }
 if(!rows.length||rows.length>10000)throw failure('BILL_FUND_PDF_ROW_LIMIT');return rows;
}
function amount(value,optional=false){const text=clean(value);if(optional&&(!text||text==='/'))return null;if(!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(text))throw failure('BILL_FUND_AMOUNT_INVALID');const [whole,decimal='']=text.split('.');return (BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'))).toString();}
function units(value,optional=false){const text=clean(value);if(optional&&(!text||text==='/'))return null;if(!/^(?:0|[1-9]\d{0,23})(?:\.\d{1,12})?$/.test(text))throw failure('BILL_FUND_UNITS_INVALID');return text;}
function dateTime(value){const text=clean(value),m=text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})(\d{2}):(\d{2})(?::(\d{2}))?$/);if(!m||!validDate(m[1]+'-'+m[2]+'-'+m[3])||+m[4]>23||+m[5]>59||+(m[6]||0)>59)throw failure('BILL_FUND_DATE_INVALID');return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+(m[6]||'00')+'+08:00';}
function parseAntFundPdf(pages){
 const result={provider:'alipay',templateId:'alipay-fund-confirmations-v1',records:[],errors:[],warnings:[{line:1,code:'BILL_FUND_CONFIRMATION_ONLY',message:'基金确认凭证补充份额与手续费，不重复产生买入资金划转；不是实时持仓或每日收益。'},{line:1,code:'BILL_PDF_VERIFY_REQUIRED',message:'请核验跨页拼接后的订单、基金代码、确认份额及手续费。'}]};
 let rows;try{rows=cellsFromPages(pages);}catch(error){result.errors.push({line:1,code:error.code,message:'基金 PDF 表格或跨页结构无法完整核验，请检查原件。'});return result;}
 const orders=new Set();for(let index=0;index<rows.length;index++)try{
  const {cells,page,endPage}=rows[index],values=cells.map(clean),[order,tradeTime,tradeType,fundName,combination,fundCode]=values;
  if(!/^\d{12,80}$/.test(order)||orders.has(order))throw failure('BILL_FUND_ORDER_INVALID');
  const conversion=tradeType==='确认日转换,赎回确认之后发起确认金额的申购的转换';
  if(!conversion&&!['用户买入','定投买入'].includes(tradeType))throw failure('BILL_FUND_TRADE_TYPE_UNSUPPORTED');
  if((!conversion||fundCode||fundName)&&(!/^\d{6}$/.test(fundCode)||!fundName||fundName.length>256))throw failure('BILL_FUND_IDENTITY_INVALID');
  if(/美元|港币|USD|HKD/i.test(fundName))throw failure('BILL_CURRENCY_UNSUPPORTED');
  const occurredAt=dateTime(tradeTime),confirmedAt=dateTime(values[11]),appliedAmountMinor=amount(values[6]),confirmedAmountMinor=amount(values[8],conversion),feeMinor=amount(values[10]),appliedUnits=units(values[7],true),confirmedUnits=units(values[9],conversion);
  if(BigInt(appliedAmountMinor)<=0n||confirmedAmountMinor!==null&&BigInt(confirmedAmountMinor)<=0n||BigInt(feeMinor)>BigInt(appliedAmountMinor)||Date.parse(confirmedAt)<Date.parse(occurredAt.slice(0,10)+'T00:00:00+08:00'))throw failure('BILL_FUND_CONFIRMATION_INVALID');
  orders.add(order);if(conversion&&!fundCode)result.warnings.push({line:index+1,code:'BILL_FUND_PRODUCT_UNSPECIFIED',message:'转换记录未提供基金名称和代码，保留原记录，不推断转出与转入份额。'});
  result.records.push({sourceTransactionId:'ant_fund_order:'+order,occurredAt,date:occurredAt.slice(0,10),amountMinor:appliedAmountMinor,currency:'CNY',direction:'neutral',kind:'transfer',description:(fundName||'基金转换（凭证未提供产品名称）')+' · '+tradeType,counterparty:'蚂蚁(杭州)基金销售有限公司',category:'投资理财',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor,rawFields:Object.fromEntries(HEADERS.map((label,i)=>[label,values[i]])),investmentTrade:{schema:'ant-fund-confirmation-v1',orderId:order,fundCode:fundCode||null,fundName:fundName||null,combination:combination||null,tradeType:conversion?'conversion':'buy',sourceTradeType:tradeType,appliedAmountMinor,appliedUnits,confirmedAmountMinor,confirmedUnits,feeMinor,confirmedAt,sourcePages:[page,endPage]},accountRelations:[{product:'alipay_funds',activity:'investment_confirmation',role:'target'}]});
 }catch(error){result.errors.push({line:index+1,code:error.code||'BILL_FUND_RECORD_INVALID',message:'第 '+(index+1)+' 条基金确认记录未通过校验，请核对订单、交易类型、日期、金额与份额。'});}
 return result;
}
module.exports={parseAntFundPdf,cellsFromPages};
