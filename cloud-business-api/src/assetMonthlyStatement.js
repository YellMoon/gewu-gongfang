'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
const clean=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function money(v){const s=clean(v).replace(/^[\u00a5\uffe5]/,'');if(!/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(s))fail('BILL_ASSET_AMOUNT_INVALID');return BigInt(s.replace('.',''));}
function day(v){const s=clean(v).replace(/\u5e74|\u6708|\//g,'-').replace(/\u65e5$/,'');if(!validDate(s))fail('BILL_ASSET_DATE_INVALID');return s;}
function record({provider,account,at,amount=0n,balance=null,description,rawFields={},sequence=1}){
 const key=createHash('sha256').update(JSON.stringify([provider,account,at,description,String(amount),balance===null?null:String(balance),sequence])).digest('hex');
 return {sourceTransactionId:provider+':'+key,date:at,occurredAt:at+'T23:59:59+08:00',amountMinor:String(amount<0n?-amount:amount),currency:provider==='futu'?'HKD':'CNY',direction:amount<0n?'debit':amount>0n?'credit':'neutral',kind:balance===null?'fee':'transfer',description,counterparty:provider==='futu'?'\u5bcc\u9014\u8bc1\u5238':'\u5fae\u4f17\u94f6\u884c',category:balance===null?'\u8d26\u6237\u7ba1\u7406\u8d39':'\u8d44\u4ea7\u8bc1\u660e',paymentChannel:'',paymentAccountHint:'****'+account.slice(-4),balanceMinor:balance===null?null:String(balance),principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:'',status:'completed',rawFields,
 ...(balance===null?{}:{balanceEvidence:{schema:'financial-asset-proof-v1',balanceKind:'total',incomeMinor:'0',expenseMinor:'0',sequence}})};
}
function parseAssetMonthlyRows(input){
 const rows=input.map(r=>r.map(clean)),text=rows.flat().join('');
 const webank=text.includes('\u5fae\u4f17\u94f6\u884cApp\u4e2a\u4eba\u8d26\u6237\u8d44\u4ea7\u5bf9\u8d26\u5355(\u6708\u62a5)'),futu=text.includes('\u8b49\u5238\u6708\u7d50\u55ae')&&text.includes('\u5bcc\u9014\u8b49\u5238\u570b\u969b(\u9999\u6e2f)\u6709\u9650\u516c\u53f8');
 if(!webank&&!futu)return null;
 const result={provider:webank?'webank':'futu',templateId:webank?'webank-asset-v1':'futu-monthly-v1',records:[],errors:[],warnings:[]};
 try{if(webank)parseWebank(rows,text,result);else parseFutu(rows,text,result);}
 catch(e){result.records=[];result.errors.push({line:1,code:e.code||'BILL_ASSET_STATEMENT_INVALID',message:'\u8d44\u4ea7\u6708\u7ed3\u5355\u7684\u8d26\u6237\u3001\u671f\u95f4\u3001\u660e\u7ec6\u6216\u5408\u8ba1\u672a\u901a\u8fc7\u6821\u9a8c\uff1b\u672a\u81ea\u52a8\u5165\u8d26\u3002'});}
 return result;
}
function parseWebank(rows,text,result){
 const month=text.match(/\u8d44\u4ea7\u5bf9\u8d26\u5355\(\u6708\u62a5\)-(20\d{2})\u5e74(\d{2})\u6708/),account=text.match(/\u8d26\u53f7\/\u5361\u53f7[:\uff1a](\d{12,24})/)?.[1],end=text.match(/\u622a\u6b62\u65e5\u671f[:\uff1a](20\d{2}\u5e74\d{2}\u6708\d{2}\u65e5)/)?.[1],range=text.match(/\u7edf\u8ba1\u65f6\u95f4[:\uff1a](20\d{2}\u5e74\d{2}\u6708\d{2}\u65e5)[\uff5e~](20\d{2}\u5e74\d{2}\u6708\d{2}\u65e5)/);
 if(!month||!account||!end||!range||!text.includes('\u5e01\u79cd:\u4eba\u6c11\u5e01')||!text.includes('\u7b2c1\u9875\u51711\u9875')||!text.includes('\u672c\u671f\u65e0\u4ea4\u6613\u6570\u636e'))fail('BILL_ASSET_LAYOUT_UNSUPPORTED');
 const at=day(end),start=day(range[1]);if(at!==day(range[2])||start!==month[1]+'-'+month[2]+'-01'||at!==new Date(Date.UTC(+month[1],+month[2],0)).toISOString().slice(0,10))fail('BILL_ASSET_PERIOD_INVALID');
 const begin=rows.findIndex(r=>r[0]==='\u8d44\u4ea7\u6982\u89c8'),finish=rows.findIndex(r=>r[0]==='\u4ea4\u6613\u6982\u89c8'),assets=rows.slice(begin+1,finish);
 // Parent product and child holding describe the same assets, counted once.
 if(begin<0||finish<=begin||assets.length!==3||assets[0][0]!=='\u6d3b\u671f+'||assets[1][0]!=='\u65e5\u65e5\u65b01\u53f7C'||assets[2][0]!=='\u5408\u8ba1'||assets.some(r=>r.length!==2))fail('BILL_ASSET_LAYOUT_UNSUPPORTED');
 const balances=assets.map(r=>money(r[1]));if(balances.some(v=>v<0n||v!==balances[2]))fail('BILL_ASSET_TOTAL_MISMATCH');
 result.accountIdentity={provider:'\u5fae\u4f17\u94f6\u884c',type:'investment',maskedIdentifier:account.slice(-4),currency:'CNY'};
 result.records=[record({provider:'webank',account,at,balance:balances[2],description:'\u5fae\u4f17\u94f6\u884c\u6d3b\u671f+\u8d44\u4ea7\u6708\u62a5',rawFields:{periodStart:start,periodEnd:at,product:'\u6d3b\u671f+',holding:'\u65e5\u65e5\u65b01\u53f7C',noTransactions:true}})];
 result.warnings.push({line:1,code:'BILL_ASSET_NO_CASH_ACTIVITY',message:'\u672c\u671f\u65e0\u4ea4\u6613\uff0c\u4ec5\u4fdd\u5b58\u6d3b\u671f+\u8d44\u4ea7\u4f59\u989d\uff1b\u4e0d\u8ba1\u5165\u6536\u652f\uff0c\u4e0d\u8986\u76d6\u50a8\u84c4\u5361\u4f59\u989d\u3002'});
}
function parseFutu(rows,text,result){
 const periods=[...text.matchAll(/\u8b49\u5238\u6708\u7d50\u55ae(20\d{2})\/(\d{2})/g)].map(m=>m[1]+'-'+m[2]);
 const header=rows.findIndex(r=>r.join('|')==='\u540d\u7a31|\u5e33\u6236\u865f\u78bc|\u5e33\u6236\u985e\u578b|\u5730\u5740|\u57fa\u6e96\u8ca8\u5e63'),identity=rows[header+1];
 if(!periods.length||new Set(periods).size!==1||header<0||identity?.length!==5||!/^\d{12,24}$/.test(identity[1])||identity[4]!=='HKD')fail('BILL_ASSET_HEADER_INVALID');
 const account=identity[1],start=periods[0]+'-01',at=new Date(Date.UTC(+periods[0].slice(0,4),+periods[0].slice(5),0)).toISOString().slice(0,10);
 if(!validDate(start)||!validDate(at)||rows.flat().flatMap(s=>[...s.matchAll(/\u8cec\u6236\u865f\u78bc[:\uff1a](\d+)/g)]).some(m=>m[1]!==account)||!text.includes('\u4fdd\u8b49\u91d1\u7d9c\u5408\u5e33\u6236('+account.slice(-4)+')'))fail('BILL_ASSET_IDENTITY_INVALID');
 const pageTags=rows.flat().filter(s=>/^\d{1,3}\/\d{1,3}$/.test(s)),total=Number(pageTags[0]?.split('/')[1]);
 if(!Number.isInteger(total)||total<1||pageTags.length!==total||pageTags.some((s,i)=>s!==(i+1)+'/'+total))fail('BILL_ASSET_PAGE_INVALID');
 const summaryAt=rows.findIndex(r=>r[0]==='\u8cc7\u7522\u7d44\u5408\u6458\u8981'),summary=rows.slice(summaryAt+1,rows.findIndex((r,i)=>i>summaryAt&&r[0]==='\u671f\u521d\u6982\u89bd'));
 const values=['\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a','\u73fe\u91d1\u7d50\u9918','\u8cc7\u7522\u6de8\u503c'].map(label=>{const r=summary.find(r=>r[0]===label);if(!r||r.length!==4)fail('BILL_ASSET_SUMMARY_INVALID');const v=r.slice(1).map(money);if(v[1]-v[0]!==v[2])fail('BILL_ASSET_TOTAL_MISMATCH');return v;});
 if(!summary.some(r=>r.join('|')==='\u671f\u521d\u91d1\u984d(HKD)|\u671f\u672b\u91d1\u984d(HKD)|\u8b8a\u52d5(HKD)')||values[0].some((v,i)=>v+values[1][i]!==values[2][i]))fail('BILL_ASSET_TOTAL_MISMATCH');
 // Verify per-currency matrices; converted totals are not currency cash flows.
 for(const [section,column]of [['\u671f\u521d\u8cc7\u7522\u6de8\u503c\u7e3d\u89bd',0],['\u671f\u672b\u8cc7\u7522\u6de8\u503c\u7e3d\u89bd',1]]){
  const i=rows.findIndex(r=>r[0]===section);if(i<0||rows[i].join('|')!==section+'|\u5408\u8a08(HKD)|\u6e2f\u5e63\u8cc7\u7522|\u7f8e\u5143\u8cc7\u7522|\u4eba\u6c11\u5e63\u8cc7\u7522|\u65e5\u5143\u8cc7\u7522|\u65b0\u52a0\u5761\u5143\u8cc7\u7522|\u97d3\u5143\u8cc7\u7522')fail('BILL_ASSET_LAYOUT_UNSUPPORTED');
  for(const [n,label]of ['\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a','\u73fe\u91d1\u7d50\u9918','\u8cc7\u7522\u6de8\u503c'].entries()){
   const r=rows.slice(i+1,i+6).find(r=>r[0]===label);if(!r||r.length!==8)fail('BILL_ASSET_LAYOUT_UNSUPPORTED');const v=r.slice(1).map(money);
   if(v[0]!==values[n][column]||v[1]!==v[0]||v.slice(2).some(x=>x!==0n))fail('BILL_ASSET_CURRENCY_UNSUPPORTED');
  }
 }
 const tips=rows.findIndex(r=>r[0]==='\u91cd\u8981\u63d0\u793a');if(tips<0)fail('BILL_ASSET_LAYOUT_UNSUPPORTED');
 const content=rows.slice(0,tips);
 if(content.some(r=>/^(?:\u8b49\u5238\u4ea4\u6613|\u4ea4\u6613\u660e\u7d30|\u6210\u4ea4\u660e\u7d30|\u80a1\u7968\u4ea4\u6613)/.test(r[0])))fail('BILL_ASSET_ACTIVITY_UNSUPPORTED');
 const cashStart=content.findIndex(r=>r[0]==='\u8cc7\u91d1\u9032\u51fa'),cashEnd=content.findIndex((r,i)=>i>cashStart&&r[0]==='\u671f\u672b\u6982\u89bd');
 if(cashStart<0||cashEnd<0||content[cashStart+1].join('|')!=='\u65e5\u671f|\u65b9\u5411|\u985e\u578b|\u8ca8\u5e63\u7a2e\u985e|\u91d1\u984d|\u5099\u8a3b')fail('BILL_ASSET_LAYOUT_UNSUPPORTED');
 let delta=0n;
 for(const [i,r]of content.slice(cashStart+2,cashEnd).entries()){
  if(r.length!==6||r[1]!=='\u6e1b\u5c11'||r[2]!=='\u8cc7\u7522\u8abf\u6574'||r[3]!=='HKD'||r[5]!=='DormantAccountManagementFee')fail('BILL_ASSET_ACTIVITY_UNSUPPORTED');
  const date=day(r[0]),amount=money(r[4]);if(date<start||date>at||amount>=0n)fail('BILL_ASSET_AMOUNT_INVALID');delta+=amount;
  result.records.push(record({provider:'futu',account,at:date,amount,description:'\u4f11\u7720\u8d26\u6237\u7ba1\u7406\u8d39',sequence:i+1,rawFields:{sourceDescription:'Dormant Account Management Fee',periodStart:start,periodEnd:at}}));
 }
 if(values[1][0]+delta!==values[1][1])fail('BILL_ASSET_CASH_MISMATCH');
 const positions=label=>{
  const i=content.findIndex(r=>r[0]===label);if(i<0||content[i+1]?.slice(0,7).join('|')!=='\u4ee3\u78bc\u540d\u7a31|\u4ea4\u6613\u6240/\u5e02\u5834|\u8ca8\u5e63\u7a2e\u985e|\u6578\u91cf|\u50f9\u683c|\u4e58\u6578|\u5e02\u503c')fail('BILL_ASSET_HOLDINGS_INVALID');
  const out=[];for(const r of content.slice(i+2)){if(!/^\d{5}\(.+\)$/.test(r[0]))break;if(![7,10].includes(r.length)||r[1]!=='SEHK'||r[2]!=='HKD'||!/^\d+(?:\.\d+)?$/.test(r[3])||r[5]!=='-')fail('BILL_ASSET_HOLDINGS_INVALID');out.push(r);}
  if(!out.length)fail('BILL_ASSET_HOLDINGS_INVALID');return out;
 };
 const opening=positions('\u671f\u521d\u6982\u89bd-\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a'),closing=positions('\u671f\u672b\u6982\u89bd-\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a');
 if(JSON.stringify(opening.map(r=>r.slice(0,4)))!==JSON.stringify(closing.map(r=>r.slice(0,4)))||opening.reduce((s,r)=>s+money(r[6]),0n)!==values[0][0]||closing.reduce((s,r)=>s+money(r[6]),0n)!==values[0][1])fail('BILL_ASSET_HOLDINGS_INVALID');
 result.accountIdentity={provider:'\u5bcc\u9014\u8bc1\u5238',type:'investment',maskedIdentifier:account.slice(-4),currency:'HKD'};
 result.records.push(record({provider:'futu',account,at,balance:values[2][1],description:'\u5bcc\u9014\u8bc1\u5238\u6708\u672b\u8d44\u4ea7\u51c0\u503c',rawFields:{periodStart:start,periodEnd:at,cashBalanceMinor:String(values[1][1]),securitiesValueMinor:String(values[0][1]),holdings:closing.map(r=>({security:r[0],market:r[1],currency:r[2],units:r[3],price:r[4],valueMinor:String(money(r[6]))}))}}));
}
module.exports={parseAssetMonthlyRows};

