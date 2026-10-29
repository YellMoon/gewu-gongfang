'use strict';
// A brokerage cash balance is not a portfolio valuation. Keep it on the
// brokerage evidence, never in the generic total-account balance column.
const HEADERS=['\u4ea4\u6536\u65e5\u671f','\u8d44\u91d1\u8d26\u53f7','\u4e1a\u52a1\u8bf4\u660e','\u8bc1\u5238\u4ee3\u7801','\u8bc1\u5238\u540d\u79f0','\u6210\u4ea4\u4ef7\u683c','\u6210\u4ea4\u6570\u91cf','\u6210\u4ea4\u91d1\u989d','\u8bc1\u5238\u4f59\u989d','\u8d44\u91d1\u53d1\u751f\u6570','\u8d44\u91d1\u672c','\u603b\u4f63\u91d1','\u51c0\u4f63\u91d1','\u5370\u82b1\u7a0e','\u8fc7\u6237\u8d39','\u5e01\u79cd','\u5176\u4ed6\u8d39'];
const clean=v=>String(v??'').normalize('NFKC').trim();
const error=code=>Object.assign(new Error(code),{code});
function date(v){const s=clean(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw error('BILL_BROKER_DATE_INVALID');return s;}
function money(v,{signed=false,optional=false}={}){let s=clean(v);if(optional&&!s)return null;if(!/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(s)||!signed&&s.startsWith('-'))throw error('BILL_BROKER_AMOUNT_INVALID');const negative=s.startsWith('-');s=s.replace(/^-/,'');const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));return String(negative?-n:n);}
function decimal(v){const s=clean(v);if(!/^(?:0|[1-9]\d{0,23})(?:\.\d{1,12})?$/.test(s))throw error('BILL_BROKER_DECIMAL_INVALID');return s;}
function operatorItems(operators,viewport,OPS){
 if(!operators||!Array.isArray(operators.fnArray)||!Array.isArray(operators.argsArray)||operators.fnArray.length!==operators.argsArray.length||operators.fnArray.length>500000||!Number.isFinite(viewport?.height)||viewport.height<=0)throw error('BILL_BROKER_OPERATORS_INVALID');
 const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const point=(m,x,y)=>viewport.convertToViewportPoint(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);
 let matrix=[1,0,0,1,0,0],textMatrix=[1,0,0,1,0,0],fontSize=10,explicit=false;const stack=[],items=[];
 for(let n=0;n<operators.fnArray.length;n++){
  const type=operators.fnArray[n],args=operators.argsArray[n];
  if(type===OPS.save){if(stack.length>=256)throw error('BILL_BROKER_OPERATORS_INVALID');stack.push([...matrix]);}else if(type===OPS.restore){if(!stack.length)throw error('BILL_BROKER_OPERATORS_INVALID');matrix=stack.pop();}
  else if(type===OPS.transform)matrix=multiply(matrix,Array.from(args.length===1?args[0]:args));
  else if(type===OPS.beginText){textMatrix=[1,0,0,1,0,0];explicit=true;}
  else if(type===OPS.setTextMatrix){textMatrix=Array.from(args.length===1?args[0]:args);explicit=true;}
  else if(type===OPS.moveText){textMatrix[4]+=textMatrix[0]*args[0]+textMatrix[2]*args[1];textMatrix[5]+=textMatrix[1]*args[0]+textMatrix[3]*args[1];}
  else if(type===OPS.setFont)fontSize=args[1];
  else if([OPS.showText,OPS.showSpacedText].includes(type)){
   const glyphs=args.flat(3),str=glyphs.map(g=>typeof g==='object'?g?.unicode||'':'').join('');if(!str)continue;
   if(!explicit||textMatrix.length!==6||matrix.length!==6||[...textMatrix,...matrix,fontSize].some(v=>!Number.isFinite(v))||items.length>=100000||str.length>100000)throw error('BILL_BROKER_OPERATORS_UNSUPPORTED');
   const advance=glyphs.reduce((sum,g)=>sum+(typeof g==='object'?Number(g?.width||0):typeof g==='number'?-g:0),0)*fontSize/1000;
   const [x,y]=point(matrix,textMatrix[4],textMatrix[5]),[ex,ey]=point(matrix,textMatrix[4]+textMatrix[0]*advance,textMatrix[5]+textMatrix[1]*advance);
   if([x,y,ex,ey,advance].some(v=>!Number.isFinite(v)))throw error('BILL_BROKER_OPERATORS_INVALID');items.push({str,x,y:viewport.height-y,width:Math.hypot(ex-x,ey-y)});textMatrix[4]+=textMatrix[0]*advance;textMatrix[5]+=textMatrix[1]*advance;
  }
 }
 return items;
}
function pdfRows(pages){
 const headerPage=pages.find(p=>HEADERS.every(h=>p.items.some(i=>clean(i.str).replace(/\s/g,'')===h)));
 if(!headerPage)throw error('BILL_BROKER_HEADER_INVALID');
 const centers=HEADERS.map(h=>{const i=headerPage.items.find(i=>clean(i.str).replace(/\s/g,'')===h);return i.x+i.width/2;});
 if(centers.some((v,i)=>i&&v<=centers[i-1]))throw error('BILL_BROKER_COLUMNS_INVALID');
 const edges=[0,...centers.slice(1).map((x,i)=>(centers[i]+x)/2),headerPage.width||Infinity],rows=[];
 for(const page of pages){
  const anchors=page.items.filter(i=>i.x+i.width/2>=edges[0]&&i.x+i.width/2<edges[1]&&/^\d{8}$/.test(clean(i.str))).sort((a,b)=>b.y-a.y),pageRows=[];
  for(const anchor of anchors){const items=page.items.filter(i=>Math.abs(i.y-anchor.y)<10.5),cells=HEADERS.map((_,c)=>items.filter(i=>i.x+i.width/2>=edges[c]&&i.x+i.width/2<edges[c+1]).sort((a,b)=>Math.abs(a.y-b.y)>1.5?b.y-a.y:a.x-b.x).map(i=>i.str).join('').trim());pageRows.push({cells,page:page.number});}
  // PDF.js can omit clipped currency glyphs from textContent. Its operator
  // list retains them. Accept this fallback only when every transaction on
  // the page has the same explicitly present currency and the counts agree.
  const glyphs=String(page.operatorText||'').replace(/\s/g,''),rmb=(glyphs.match(/\u4eba\u6c11\u5e01/g)||[]).length;
  for(const row of pageRows)if(!row.cells[15]&&rmb===pageRows.length&&!/USD|HKD|\u7f8e\u5143|\u6e2f\u5e01/.test(glyphs))row.cells[15]='\u4eba\u6c11\u5e01';
  rows.push(...pageRows);
 }
 if(!rows.length||rows.length>10000)throw error('BILL_BROKER_ROWS_INVALID');
 if(new Set(rows.map(r=>clean(r.cells[1]))).size!==1)throw error('BILL_BROKER_MIXED_ACCOUNTS');return rows;
}
const ACTIVITY=new Map([['\u8bc1\u5238\u4e70\u5165','buy'],['\u8bc1\u5238\u5356\u51fa','sell'],['\u94f6\u884c\u8f6c\u8bc1\u5238','deposit'],['\u8bc1\u5238\u8f6c\u94f6\u884c','withdrawal'],['\u5229\u606f\u5f52\u672c','interest'],['\u7ea2\u5229\u5165\u8d26','dividend'],['\u80a1\u606f\u5165\u8d26','dividend'],['\u6307\u5b9a\u4ea4\u6613','registration'],['\u7ea2\u80a1\u5165\u8d26','corporate_action'],['\u80a1\u606f\u8865\u7a0e','tax'],['\u80a1\u606f\u4e2a\u7a0e\u5f81\u6536','tax'],['\u65b0\u80a1\u7533\u8d2d','subscription'],['\u7533\u8d2d\u8fd8\u6b3e','subscription_return'],['\u914d\u552e\u4e2d\u7b7e','allocation'],['\u914d\u552e\u7f34\u6b3e','allocation_payment'],['\u65b0\u80a1\u5165\u5e10','share_listing'],['\u65b0\u80a1\u5165\u5e10','share_listing'],['\u65b0\u80a1\u914d\u53f7','registration'],['\u65b0\u80a1\u786e\u8ba4','allocation_confirmation']]);
ACTIVITY.set('\u65b0\u80a1\u7533\u8d2d\u5931\u8d25','registration');ACTIVITY.set('\u914d\u552e\u4ea4\u6536\u7ed3\u679c','allocation_confirmation');
ACTIVITY.set('\u878d\u5238\u56de\u8d2d','repo_open');ACTIVITY.set('\u878d\u5238\u8d2d\u56de','repo_close');
ACTIVITY.set('\u57fa\u91d1\u7533\u8d2d\u62e8\u51fa','fund_buy');ACTIVITY.set('\u57fa\u91d1\u8d4e\u56de\u62e8\u5165','fund_redeem');ACTIVITY.set('\u57fa\u91d1\u7ea2\u5229\u62e8\u5165','dividend');ACTIVITY.set('\u57fa\u91d1\u7ea2\u80a1','fund_reinvest');ACTIVITY.set('\u57fa\u91d1\u4efd\u989d\u5f3a\u51cf','share_reduction');
function recordFromCells(cells,{sequence,page=null,periodStart=null,periodEnd=null,format='pdf'}={}){
 const [day,account,operation,code,name,price,quantity,gross,stockBalance,cash,cashBalance,totalCommission,netCommission,stamp,transfer,currency,other]=cells.map(clean),activity=ACTIVITY.get(operation);
 if(!activity)throw error('BILL_BROKER_OPERATION_UNSUPPORTED');if(!/^\d{4,24}$/.test(account)||!/^(?:\u4eba\u6c11\u5e01|CNY|RMB)$/.test(currency))throw error('BILL_BROKER_IDENTITY_CURRENCY_INVALID');
 const at=date(day),cashDeltaMinor=money(cash,{signed:true}),reportedGrossMinor=money(gross,{signed:true}),grossMinor=String(BigInt(reportedGrossMinor)<0n?-BigInt(reportedGrossMinor):BigInt(reportedGrossMinor)),cashBalanceMinor=money(cashBalance,{signed:true,optional:true}),units=decimal(quantity),displayPrice=decimal(price),holdingUnits=stockBalance===''?null:decimal(stockBalance),fees={commissionMinor:money(totalCommission),netCommissionMinor:money(netCommission,{optional:true}),stampDutyMinor:money(stamp),transferMinor:money(transfer),otherMinor:money(other)};
 if(format==='pdf'&&cashBalanceMinor===null)throw error('BILL_BROKER_CASH_BALANCE_MISSING');
 if(BigInt(reportedGrossMinor)<0n&&activity!=='allocation_payment')throw error('BILL_BROKER_GROSS_SIGN_INVALID');
 if(['buy','sell','dividend','corporate_action','fund_buy','fund_redeem','fund_reinvest','share_reduction'].includes(activity)&&(!/^\d{6}$/.test(code)||!name))throw error('BILL_BROKER_SECURITY_INVALID');
 const signed=BigInt(cashDeltaMinor),grossValue=BigInt(grossMinor),feeMinor=['buy','sell','repo_open','fund_buy','fund_redeem'].includes(activity)?String(['sell','fund_redeem'].includes(activity)?grossValue-signed:-signed-grossValue):activity==='tax'?String(-signed):'0';
 if(activity==='fund_buy'&&signed>=0n||activity==='fund_redeem'&&signed<=0n||['fund_reinvest','share_reduction'].includes(activity)&&(signed!==0n||grossValue!==0n))throw error('BILL_BROKER_CASH_DIRECTION_INVALID');
 if(BigInt(feeMinor)<0n||activity==='buy'&&(signed>=0n||BigInt(units.replace('.',''))===0n)||activity==='sell'&&signed<=0n||activity==='deposit'&&signed<=0n||activity==='withdrawal'&&signed>=0n||['interest','dividend'].includes(activity)&&signed<0n||activity==='tax'&&signed>0n||activity==='registration'&&signed!==0n)throw error('BILL_BROKER_CASH_DIRECTION_INVALID');
 if(activity==='repo_open'&&signed>=0n||activity==='repo_close'&&signed<grossValue)throw error('BILL_BROKER_REPO_INVALID');
 const direction=signed<0n?'debit':signed>0n?'credit':'neutral',kind=['interest','dividend'].includes(activity)?'income':activity==='tax'?'fee':'transfer';
 const rawFields=Object.fromEntries(HEADERS.map((h,i)=>[h,i===1?'****'+account.slice(-4):clean(cells[i])]));
 return {sourceTransactionId:'',date:at,occurredAt:at+'T00:00:00+08:00',currency:'CNY',direction,kind,amountMinor:String(signed<0n?-signed:signed),description:[operation,code,name].filter(Boolean).join(' '),counterparty:format==='csv'?'':'\u56fd\u6cf0\u541b\u5b89',category:'\u8bc1\u5238\u6295\u8d44',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:activity==='repo_close'?String(signed-grossValue):null,feeMinor,rawFields,brokerage:{schema:'brokerage-trade-v1',activity,operation,securityCode:code||null,securityName:name||null,units,displayPrice,grossMinor,reportedGrossMinor,cashDeltaMinor,cashBalanceMinor,holdingUnits,feeMinor,fees,accountTail:account.slice(-4),sequence,sourcePage:page,periodStart,periodEnd,format}};
}
function checkedCashContinuity(result){
 if(result.records.some((r,i)=>i&&r.date<result.records[i-1].date))result.errors.push({line:1,code:'BILL_BROKER_DATE_ORDER_INVALID',message:'Brokerage PDF dates must follow source order.'});
 let previous=null;for(const [i,r]of result.records.entries()){
  if(previous!==null&&BigInt(r.brokerage.cashBalanceMinor)-previous!==BigInt(r.brokerage.cashDeltaMinor))result.errors.push({line:i+1,code:'BILL_BROKER_CASH_GAP',message:'\u8bc1\u5238\u8d26\u5355\u9010\u7b14\u73b0\u91d1\u4f59\u989d\u4e0e\u53d1\u751f\u91d1\u989d\u4e0d\u7b26\uff0c\u8bf7\u68c0\u67e5\u7f3a\u884c\u3001\u8de8\u9875\u6216\u5217\u5bf9\u9f50'});
  previous=BigInt(r.brokerage.cashBalanceMinor);
 }return result;
}
function parseGuotaiPdf(pages){
 const result={provider:'guotai',templateId:'guotai-brokerage-pdf-v1',records:[],errors:[],warnings:[]};
 try{const text=pages[0].items.map(i=>i.str).join('').replace(/\s/g,''),period=text.match(/\u5bf9\u8d26\u671f\u9650[:\uff1a](\d{8})-(\d{8})/);if(!/\u56fd\u6cf0(?:\u6d77\u901a|\u541b\u5b89)\u8bc1\u5238/.test(text)||!period)throw error('BILL_BROKER_HEADER_INVALID');const periodStart=date(period[1]),periodEnd=date(period[2]);if(periodStart>periodEnd)throw error('BILL_BROKER_PERIOD_INVALID');const rows=pdfRows(pages);for(const [i,row]of rows.entries())try{const record=recordFromCells(row.cells,{sequence:i+1,page:row.page,periodStart,periodEnd});if(record.date<periodStart||record.date>periodEnd)throw error('BILL_BROKER_PERIOD_INVALID');result.records.push(record);}catch(e){result.errors.push({line:i+1,code:e.code||'BILL_BROKER_RECORD_INVALID',message:'\u8bc1\u5238\u8d26\u5355\u7b2c '+(i+1)+' \u884c\u672a\u901a\u8fc7\u91d1\u989d\u3001\u5217\u5bf9\u9f50\u6216\u4e1a\u52a1\u6821\u9a8c\u3002'});}}catch(e){result.errors.push({line:1,code:e.code||'BILL_BROKER_PDF_INVALID',message:'\u8bc1\u5238 PDF \u8868\u5934\u3001\u671f\u95f4\u6216\u8868\u683c\u7ed3\u6784\u65e0\u6cd5\u6838\u9a8c\u3002'});}return checkedCashContinuity(result);
}
function parseGuotaiCsvRows(rows){
 const headers=rows[0]?.cells.map(clean),required=['\u4ea4\u6536\u65e5\u671f','\u8bc1\u5238\u4ee3\u7801','\u8bc1\u5238\u540d\u79f0','\u4ea4\u6613\u7c7b\u578b','\u6210\u4ea4\u4ef7\u683c','\u6210\u4ea4\u6570\u91cf','\u6210\u4ea4\u91d1\u989d','\u53d1\u751f\u91d1\u989d','\u4f63\u91d1','\u5370\u82b1\u7a0e','\u8fc7\u6237\u8d39','\u8d44\u91d1\u8d26\u6237','\u5e01\u79cd'];
 if(!headers||!required.every(h=>headers.includes(h)))return null;
 // This CSV layout does not identify its issuer. The owner must bind it to
 // the existing brokerage account; do not infer a broker from its filename.
 const result={provider:'brokerage',templateId:'brokerage-csv-v1',records:[],errors:[],warnings:[]};if(new Set(headers).size!==headers.length||rows.length>10001){result.errors.push({line:1,code:'BILL_BROKER_HEADER_INVALID',message:'\u8bc1\u5238 CSV \u8868\u5934\u6216\u884c\u6570\u65e0\u6548'});return result;}
 const accountColumn=headers.indexOf(required[11]),sourceAccounts=new Set(rows.slice(1).filter(r=>r.cells.some(c=>clean(c))).map(r=>clean(r.cells[accountColumn])));
 if(sourceAccounts.size>1){result.errors.push({line:1,code:'BILL_BROKER_MIXED_ACCOUNTS',message:'One import must contain one brokerage funds account.'});return result;}
 for(const [i,row]of rows.slice(1).entries()){
  if(!row.cells.some(c=>clean(c)))continue;
  try{if(row.issue||row.cells.length!==headers.length)throw error('BILL_BROKER_COLUMNS_INVALID');const get=h=>clean(row.cells[headers.indexOf(h)]),mapped=[get(required[0]),get(required[11]),get(required[3]),get(required[1]),get(required[2]),get(required[4]),get(required[5]),get(required[6]),'',get(required[7]),'',get(required[8]),'',get(required[9]),get(required[10]),get(required[12]),'0'];const record=recordFromCells(mapped,{sequence:i+1,format:'csv'});record.rawFields=Object.fromEntries(headers.map((h,n)=>[h,h==='\u8d44\u91d1\u8d26\u6237'?'****'+get(h).slice(-4):clean(row.cells[n])]));record.brokerage.disclosedComponents=Object.fromEntries(headers.filter(h=>/\u8d39|\u4f63\u91d1|\u5370\u82b1\u7a0e/.test(h)).map(h=>[h,money(get(h))]));record.relatedReference=get('\u5408\u540c\u7f16\u53f7');result.records.push(record);}catch(e){result.errors.push({line:row.line||i+2,code:e.code||'BILL_BROKER_RECORD_INVALID',message:'\u8bc1\u5238 CSV \u8bb0\u5f55\u672a\u901a\u8fc7\u91d1\u989d\u3001\u5217\u5bf9\u9f50\u6216\u4e1a\u52a1\u6821\u9a8c'});}
 }
 return result;
}
module.exports={HEADERS,pdfRows,recordFromCells,parseGuotaiPdf,parseGuotaiCsvRows,operatorItems};
