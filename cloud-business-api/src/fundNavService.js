'use strict';
const crypto=require('node:crypto');
const {validateFundNavSeries,investmentHoldingAccount}=require('../../shared/personal-finance/fundValuation');
const {latestInvestmentConfirmations}=require('../../shared/personal-finance/investmentTrades');
const officialProviders=[[/^易方达/,'efund'],[/^华夏/,'amc'],[/^财通/,'ctfund'],[/^嘉实/,'jsfund'],[/^广发/,'gffund'],[/^建信/,'ccbfund']];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const day=d=>new Date(d.getTime()+8*3600000).toISOString().slice(0,10);
const realDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const cell=s=>s.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').trim();
function htmlNavRows(html){const rows=[];for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const c=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>cell(m[1]));if(c.length>=3&&realDate(c[0])&&/^\d+\.\d+$/.test(c[1])&&/^\d+\.\d+$/.test(c[2]))rows.push({date:c[0],unitNav:c[1],accumulatedNav:c[2]});}return rows;}
function createFundNavService({fetchImpl=globalThis.fetch,now=()=>new Date(),timeoutMs=5000,successTtlMs=6*3600000,failureTtlMs=15*60000}={}){
 const cache=new Map(),inflight=new Map();let ccbProtocol=null;
 async function request(url,{method='GET',body,form,referer}={},documents){
  const headers={'User-Agent':'Mozilla/5.0','Referer':referer||new URL(url).origin+'/'};
  let payload;if(body){headers['Content-Type']='application/json';payload=JSON.stringify(body);}if(form){headers['Content-Type']='application/x-www-form-urlencoded; charset=UTF-8';payload=new URLSearchParams(form).toString();}
  const response=await fetchImpl(url,{method,headers,body:payload,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw Error('FUND_NAV_HTTP_UNAVAILABLE');
  const source=await response.text();if(Buffer.byteLength(source,'utf8')>3*1024*1024)throw Error('FUND_NAV_RESPONSE_TOO_LARGE');
  documents?.push({url,sha256:sha(source),fetchedAt:now().toISOString(),...(body?{request:body}:{})});return source;
 }
 async function ccbData(code,documents){
  if(!ccbProtocol||Date.now()-ccbProtocol.time>3600000){const s=await request('https://m.ccbfund.cn/ccbfundmob/skin/phone/js/common/encrypt.js',{},documents),a=s.match(/Encrypt.aeskey="([A-Za-z0-9+/=]+)"/),k=s.match(/Encrypt.signKey="([A-Za-z0-9]+)"/);if(!a||!k)throw Error('FUND_NAV_PROTOCOL_CHANGED');const key=Buffer.from(a[1],'base64');if(key.length!==16)throw Error('FUND_NAV_PROTOCOL_CHANGED');ccbProtocol={key,signKey:k[1],time:Date.now()};}
  const enc=v=>{const c=crypto.createCipheriv('aes-128-ecb',ccbProtocol.key,null);return encodeURIComponent(Buffer.concat([c.update(String(v),'utf8'),c.final()]).toString('base64'));},id=crypto.randomUUID(),time=String(now().getTime())+'.123456',sign=crypto.createHash('md5').update(ccbProtocol.signKey+'s-requestId'+id+'s-timeStamp'+time+ccbProtocol.signKey).digest('hex'),url='https://m.ccbfund.cn/ccbfundmob/q/fundDetail!ajaxQueryFundDetail.action';
  const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Referer':'https://m.ccbfund.cn/ccbfundmob/q/fundDetail.action?fundCode='+code,'s-requestId':enc(id),'s-timeStamp':enc(time),'s-sign':enc(sign)},body:'fundCode='+enc(code),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw Error('FUND_NAV_HTTP_UNAVAILABLE');
  const raw=await response.text();if(Buffer.byteLength(raw,'utf8')>3*1024*1024)throw Error('FUND_NAV_RESPONSE_TOO_LARGE');documents.push({url,sha256:sha(raw),fetchedAt:now().toISOString(),request:{fundCode:code}});let decoded=raw;
  if(!raw.trimStart().startsWith('{')){const c=crypto.createDecipheriv('aes-128-ecb',ccbProtocol.key,null);decoded=Buffer.concat([c.update(Buffer.from(raw,'base64')),c.final()]).toString('utf8');}
  const d=JSON.parse(decoded);if(!d.success||d.fundCode!==code||d.isMoneyFund)throw Error('FUND_NAV_IDENTITY_MISMATCH');return{name:d.fundName,rows:(d.yearChartViews||[]).map(r=>({date:r.date.slice(0,10),unitNav:String(r.netValue),accumulatedNav:String(r.totalnetvalue)}))};
 }
 async function load({fundCode,provider,periodStart,periodEnd}){
  if(!/^\d{6}$/.test(fundCode)||!realDate(periodStart)||!realDate(periodEnd)||periodStart>periodEnd||Date.parse(periodEnd)-Date.parse(periodStart)>370*86400000)throw Error('FUND_NAV_RANGE_INVALID');
  const documents=[];let rows=[],name='';
  if(provider==='efund'){
   const body={fundCode,pageIndex:0,pageSize:150,startDate:periodStart,endDate:periodEnd,siteID:'1'},url='https://api.efunds.com.cn/xcowch/front/fund/nav';
   for(let i=0;i<4;i++){const d=JSON.parse(await request(url,{method:'POST',body:{...body,pageIndex:i},referer:'https://www.efunds.com.cn/fund/'+fundCode+'.shtml'},documents));if(d.status!==1||!Array.isArray(d.data?.data)||!Number.isInteger(d.data.total))throw Error('FUND_NAV_PROTOCOL_CHANGED');if(i===0)name=d.data.data[0]?.shortName||'';rows.push(...d.data.data.map(r=>({date:r.navDate,unitNav:r.netValue,accumulatedNav:r.totalNetValue})));if(rows.length>=d.data.total)break;if(i===3)throw Error('FUND_NAV_HISTORY_TRUNCATED');}
  }else if(provider==='ctfund'){
   const url='https://www.ctfund.com/middle-platform-gateway/wechatwork-product-biz/front/api/nav',d=JSON.parse(await request(url,{method:'POST',body:{fundCode,pageNo:1,pageSize:1000,startTime:periodStart,endTime:periodEnd}},documents));if(!d.success||!Array.isArray(d.result?.records)||d.result.records.some(r=>r.fundCode!==fundCode))throw Error('FUND_NAV_IDENTITY_MISMATCH');if(Number(d.result.total)>d.result.records.length)throw Error('FUND_NAV_HISTORY_TRUNCATED');name=d.result.records[0]?.fundName||'';rows=d.result.records.map(r=>({date:r.releaseDate,unitNav:r.netValue,accumulatedNav:r.totalNetValue}));
  }else if(provider==='amc'){
   for(let page=1;page<=15;page++){const url='https://www.chinaamc.com/product/fundLishijingzhi.do?'+new URLSearchParams({fundcode:fundCode,beginDate:periodStart,endDate:periodEnd,pageIndex:String(page),isQuery:'1'}),html=await request(url,{},documents);if(!new RegExp('id="fundcode"[^>]+value="'+fundCode+'"').test(html))throw Error('FUND_NAV_IDENTITY_MISMATCH');const batch=htmlNavRows(html);if(!batch.length)break;rows.push(...batch);if(batch.at(-1).date<=periodStart||batch.length<20)break;if(page===15)throw Error('FUND_NAV_HISTORY_TRUNCATED');}
   name='ChinaAMC '+fundCode;
  }else if(provider==='jsfund'){
   const html=await request('https://www.jsfund.cn/Services/cn/jsp/product/NavHistory.jsp?'+new URLSearchParams({FundCode:fundCode,SiteID:'1'}),{},documents),selected=html.match(new RegExp('<option value="'+fundCode+'" selected="selected">([^<]+)'));
   if(!selected)throw Error('FUND_NAV_IDENTITY_MISMATCH');name=cell(selected[1]);rows=htmlNavRows(html);if(rows.length&&rows.at(-1).date>periodStart)throw Error('FUND_NAV_HISTORY_TRUNCATED');
  }else if(provider==='gffund'){
   let totalPages=1;for(let page=1;page<=totalPages;page++){if(page>15)throw Error('FUND_NAV_HISTORY_TRUNCATED');const url='https://www.gffunds.com.cn/apistore/JsonService?'+new URLSearchParams({service:'MarketPerformance',method:'NAV',op:'queryNAVByFundcode',fundcode:fundCode,startdate:periodStart.replaceAll('-',''),enddate:periodEnd.replaceAll('-',''),curpage:String(page),orderby:'NAVDATE_DESC',pagelines:'150'}),d=JSON.parse(await request(url,{referer:'https://www.gffunds.com.cn/funds/?fundcode='+fundCode},documents));if(d.errorno!=='20000'||!Array.isArray(d.data)||d.data.some(r=>r.FUNDCODE!==fundCode))throw Error('FUND_NAV_IDENTITY_MISMATCH');totalPages=Number(d.totalpages);if(!Number.isInteger(totalPages)||totalPages<1)throw Error('FUND_NAV_PROTOCOL_CHANGED');name=d.data[0]?.FUNDNAME||name;rows.push(...d.data.map(r=>({date:r.NAVDATE.slice(0,4)+'-'+r.NAVDATE.slice(4,6)+'-'+r.NAVDATE.slice(6,8),unitNav:r.NAVUNIT,accumulatedNav:r.NAVACCUMULATED})));}
  }else if(provider==='ccbfund'){
   const d=await ccbData(fundCode,documents);name=d.name;rows=d.rows;if(rows.length&&rows.map(r=>r.date).sort()[0]>periodStart)throw Error('FUND_NAV_HISTORY_TRUNCATED');
  }else throw Error('FUND_NAV_PROVIDER_UNSUPPORTED');
  const unique=new Map();for(const q of rows){if(q.date<periodStart||q.date>periodEnd)continue;const previous=unique.get(q.date);if(previous&&(previous.unitNav!==q.unitNav||previous.accumulatedNav!==q.accumulatedNav))throw Error('FUND_NAV_CONFLICT');unique.set(q.date,q);}
  return validateFundNavSeries({schema:'fund-nav-series-v1',fundCode,fundName:name,currency:'CNY',provider,periodStart,periodEnd,coverageComplete:true,sourceDocuments:documents,quotes:[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date))});
 }
 async function get(request){const key=JSON.stringify(request),at=now().getTime(),cached=cache.get(key);if(cached&&at-cached.at<(cached.error?failureTtlMs:successTtlMs)){if(cached.error)throw Error(cached.error);return structuredClone(cached.value);}if(inflight.has(key))return structuredClone(await inflight.get(key));const promise=load(request).then(value=>{cache.set(key,{at:now().getTime(),value});return value;},e=>{cache.set(key,{at:now().getTime(),error:String(e.message).startsWith('FUND_NAV_')?e.message:'FUND_NAV_UNAVAILABLE'});throw e;}).finally(()=>inflight.delete(key));inflight.set(key,promise);return structuredClone(await promise);}
 async function forLedger(ledger){
  const accounts=new Map((ledger.accounts||[]).map(a=>[a.id,a])),requests=new Map(),blocked=new Set(),periodEnd=day(now()),issues=[];
  for(const o of latestInvestmentConfirmations(ledger.observations||[])){const t=o.investmentTrade,a=investmentHoldingAccount(o,accounts),start=a?.investmentIncomePolicy?.dailyAcquisitionsFrom;if(!a||t.tradeType!=='buy'||!start||o.date<start||o.currency!=='CNY'||o.date>periodEnd||blocked.has(t.fundCode))continue;const provider=officialProviders.find(([re])=>re.test(t.fundName))?.[1];if(!provider){issues.push({fundCode:t.fundCode,reason:'FUND_NAV_PROVIDER_UNSUPPORTED'});continue;}const previous=requests.get(t.fundCode);if(previous&&previous.provider!==provider){issues.push({fundCode:t.fundCode,reason:'FUND_NAV_PROVIDER_AMBIGUOUS'});requests.delete(t.fundCode);blocked.add(t.fundCode);continue;}requests.set(t.fundCode,{fundCode:t.fundCode,provider,periodStart:previous&&previous.periodStart<start?previous.periodStart:start,periodEnd});}
  if(requests.size>32)return{schema:'investment-market-data-v1',series:[],issues:[{reason:'FUND_NAV_PRODUCT_LIMIT'}],fetchedAt:now().toISOString()};
  const series=[];await Promise.all([...requests.values()].map(async request=>{try{series.push(await get(request));}catch(e){issues.push({fundCode:request.fundCode,reason:String(e.message).startsWith('FUND_NAV_')?e.message:'FUND_NAV_UNAVAILABLE'});}}));
  return{schema:'investment-market-data-v1',series:series.sort((a,b)=>a.fundCode.localeCompare(b.fundCode)),issues,fetchedAt:now().toISOString()};
 }
 return{get,forLedger};
}
module.exports={createFundNavService,htmlNavRows};
