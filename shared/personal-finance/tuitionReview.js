'use strict';
// Suggestions only. Names and nicknames never authorize a payment write.
const sourceFields=['observationId','financialAccountId','provider','sourceTransactionId','date','amountMinor'];
const sourceKey=s=>JSON.stringify([s.provider,s.financialAccountId,s.sourceTransactionId||s.observationId]);
const validSource=o=>o&&(['wechat','alipay','psbc','jsb','cib','mybank','huaxia','minsheng','cmb','bocom','ccb','cgb','citic','czbank','spdb','hangzhou','webank'].includes(o.provider)||!!o.bankAccount||!!o.statementFlow||!!o.bankStatement)&&o.currency==='CNY'&&o.direction==='credit'&&o.status==='completed'&&['income','transfer','unknown'].includes(o.kind)&&/^[1-9]\d*$/.test(o.amountMinor||'');
function sourceOf(o){return {observationId:o.id,financialAccountId:o.financialAccountId,provider:o.provider,sourceTransactionId:o.sourceTransactionId||'',date:o.date,amountMinor:o.amountMinor};}
const moneyMinor=value=>{const s=String(value);if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');return String(BigInt(a)*100n+BigInt(b.padEnd(2,'0')));};
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
function studentLabel(s){return [s.name,s.grade_current,s.school,s.parent_name&&'家长：'+s.parent_name,'编号：'+s.id].filter(Boolean).join(' · ');}
function similarPayments(payments,{studentId,amountMinor,date}){return payments.filter(p=>!p.deleted&&p.student_id===studentId&&moneyMinor(p.amount)===amountMinor&&Math.abs(Date.parse(p.payment_date)-Date.parse(date))<=3*86400000);}
function courseWindow(date){
 const shift=months=>{
  const value=new Date(date+'T00:00:00Z'),day=value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth()+months);
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
  value.setUTCDate(Math.min(day,last));
  return value.toISOString().slice(0,10);
 };
 return {start:shift(-2),end:shift(2)};
}
function buildTuitionCandidates({transactions=[],students=[],payments=[],links=[],schedules=[],includeAll=false}){
 const seen=new Set(),linked=new Map(links.map(l=>[sourceKey(l.source),l]));
 const courseDates=new Map([['',[]]]);
 // The empty key indexes all classes for receipts with no known student.
 for(const schedule of schedules){
  if(schedule.deleted||!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date||''))continue;
  for(const id of ['',...(schedule.studentIds||[])]){
   if(!courseDates.has(id))courseDates.set(id,[]);
   courseDates.get(id).push(schedule.date);
  }
 }
 for(const [id,dates] of courseDates)courseDates.set(id,[...new Set(dates)].sort());
 const hasCourse=(id,window)=>{
  const dates=courseDates.get(id)||[];
  let low=0,high=dates.length;
  while(low<high){
   const middle=Math.floor((low+high)/2);
   if(dates[middle]<window.start)low=middle+1;
   else high=middle;
  }
  return low<dates.length&&dates[low]<=window.end;
 };
 return transactions.flatMap(t=>{
  if(t.currency!=='CNY'||!['income','transfer','unknown'].includes(t.kind))return [];
  // External receipts can remain transfers in personal-income statistics.
  // A matched debit in another owned/settlement account is not a new receipt.
  if(Object.values(t.balanceEffects||{}).some(v=>BigInt(v)<0n))return [];
  const o=(t.sources||[]).find(validSource);if(!o)return [];
  const sourceType=String(o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']||o.rawFields?.['\u4ea4\u6613\u5206\u7c7b']||'');
  if(/\u5145\u503c|\u63d0\u73b0|\u7406\u8d22|\u57fa\u91d1|\u96f6\u94b1\u901a|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u9000\u6b3e|\u9000\u56de/.test(sourceType))return [];
  const source=sourceOf(o),key=sourceKey(source);if(seen.has(key))return [];seen.add(key);
  const text=normalize([o.description,...(t.sources||[]).map(s=>s.description)].join(' ')),party=normalize([o.counterparty,...(t.sources||[]).map(s=>s.counterparty)].join(' ')),nameMatches=students.filter(s=>!s.deleted).flatMap(s=>{
   const reasons=[];if(normalize(s.name).length>=2&&text.includes(normalize(s.name)))reasons.push('转账备注包含学生姓名');
   if(normalize(s.name).length>=2&&party.includes(normalize(s.name)))reasons.push('付款人显示名包含学生姓名');
   if(normalize(s.parent_name).length>=2&&party.includes(normalize(s.parent_name)))reasons.push('付款人显示名包含已登记家长姓名');
   return reasons.length?[{studentId:s.id,reasons}]:[];
  });
  const window=courseWindow(o.date);
  const matches=nameMatches.filter(m=>hasCourse(m.studentId,window));
  const courseEligible=nameMatches.length?matches.length>0:hasCourse('',window);
  if(!includeAll&&!courseEligible&&!linked.has(key))return [];
  const tuitionText=/学费|课时费|补课费|课程费|培训费/.test(text),familyName=/妈妈|爸爸|家长/.test(party);
  if(!includeAll&&!tuitionText&&!familyName&&!matches.length&&!linked.has(key))return [];
  const suggestedStudentId=matches.length===1?matches[0].studentId:'',warnings=[];
  if(matches.length>1)warnings.push('有多个学生候选，请按编号区分');
  if(/老师|结算|工资|薪酬/.test(party+' '+text))warnings.push('可能是教师或机构结算，请核对是否属于学生缴费');
  if(!matches.length)warnings.push('尚未匹配学生');
  if(!courseEligible)warnings.push('收入前后两个月内未找到相应课程');
  return [{id:key,source,courseEligible,counterparty:o.counterparty||'',description:o.description||'',occurredAt:o.occurredAt,sourceTransactionId:o.sourceTransactionId,amountMinor:o.amountMinor,date:o.date,provider:o.provider,matches,suggestedStudentId,reasons:[...(tuitionText?['备注包含学费相关文字']:[]),...(familyName?['付款人显示名含家长称呼']:[]),...matches.flatMap(m=>m.reasons)],warnings,linked:linked.get(key)||null,similarPayments:suggestedStudentId?similarPayments(payments,{studentId:suggestedStudentId,amountMinor:o.amountMinor,date:o.date}):[]}];
 }).sort((a,b)=>b.date.localeCompare(a.date)||String(b.occurredAt).localeCompare(String(a.occurredAt)));
}
module.exports={courseWindow,buildTuitionCandidates,sourceFields,sourceKey,sourceOf,validSource,moneyMinor,studentLabel,similarPayments};
