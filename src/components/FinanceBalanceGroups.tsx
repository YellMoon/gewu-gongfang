import React from 'react';
import { Button, Card, Tag } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
const money=(value:any)=>formatMinor(value).replace(/^-/, '−');
const labels:Record<string,string>={savings:'储蓄卡账户余额',credit:'信用卡总欠款',securities:'证券账户总资产',other:'其他资金账户余额'};
export function MortgageBalanceCards({accounts,models,stats,ids,ready,onSelect}:{accounts:any[];models:any[];stats:Record<string,any>;ids:string[];ready:boolean;onSelect:(ids:string[])=>void}){
 const rows=ids.map(id=>({id,account:accounts.find(a=>a.id===id),model:models.find(m=>m.financialAccountId===id),stats:stats[id]||{}}));
 const type=(row:any)=>row.account?.mortgage?.loanType||row.model?.loanType;
 const types=['commercial','provident',...(rows.some(row=>!['commercial','provident'].includes(type(row)))?['other']:[])];
 const titles:Record<string,string>={commercial:'商业贷款剩余本金',provident:'公积金贷款剩余本金',other:'其他房贷剩余本金'};
 return <>{types.map(kind=>{const loans=rows.filter(row=>kind==='other'?!['commercial','provident'].includes(type(row)):type(row)===kind);return <Card size="small" key={kind}><span>{titles[kind]}</span>{loans.length?loans.map(row=>{const known=row.stats.balanceMinor!=null,amount=known?row.stats.balanceMinor:row.stats.estimatedBalanceMinor,date=known?row.stats.balanceAnchor?.asOf?.slice(0,10)||row.stats.balanceAsOf:row.stats.estimateAsOf;return <div key={row.id}>
  <div className="finance-value" data-testid={'balance-mortgage-'+kind}>{ready&&amount!=null?money((-BigInt(amount)).toString()):'—'}</div>
  {ready&&<Tag color={known?'blue':'gold'}>{amount==null?'待核对':known?'已核对':'估算'}</Tag>}
  {ready&&date&&<p className="finance-muted">截至 {date}</p>}<Button type="link" size="small" onClick={()=>onSelect([row.id])}>查看账户</Button>
 </div>;}):<><div className="finance-value">—</div>{ready&&<span className="finance-muted">暂无贷款</span>}</>}</Card>;})}</>;
}
export default function FinanceBalanceGroups({groups,accounts=[],mortgages=[],accountStats={},endDate,currency,ready,onSelect}:{groups:any[];accounts?:any[];mortgages?:any[];accountStats?:Record<string,any>;endDate?:string;currency:string;ready:boolean;onSelect:(ids:string[])=>void}){
 const selected=groups.filter(g=>g.currency===currency);
 return <section aria-label="分类账户余额"><h3 className="finance-section-title">分类账户余额</h3><div className="finance-summary finance-balance-groups">
  {['savings','credit','mortgage','securities',...(selected.some(g=>g.key==='other')?['other']:[])].map(key=>{const group=selected.find(g=>g.key===key);if(key==='mortgage')return <MortgageBalanceCards key={key} accounts={accounts} models={mortgages} stats={accountStats} ids={group?.accountIds||[]} ready={ready} onSelect={onSelect}/>;return <Card size="small" key={key}>
   <span>{labels[key]}</span><div className="finance-value" data-testid={'balance-'+key}>{ready&&group?.knownCount?money(group.knownBalanceMinor):'—'}</div>
   {ready&&!group?.knownCount&&group?.unknownCount>0&&<Tag>待核对</Tag>}
   {key==='credit'&&ready&&group?.billedDebtCount>0&&<div className="finance-billed-debt"><span>账单应还</span><div className="finance-value" data-testid="balance-credit-billed">{money(group.billedDebtMinor)}</div>
    <details><summary>各卡账单</summary>{accounts.filter(a=>group.accountIds.includes(a.id)&&a.verifiedBalance?.balanceKind==='billed_debt'&&(!endDate||a.verifiedBalance.asOf.slice(0,10)<=endDate)).map(a=><p key={a.id}><Button type="link" size="small" onClick={()=>onSelect([a.id])}>{a.label}</Button><br/><strong className="finance-number">{money((-BigInt(a.verifiedBalance.balanceMinor)).toString())}</strong><span className="finance-muted"> · {a.verifiedBalance.asOf.slice(0,10)}</span></p>)}</details>
   </div>}
   {key==='securities'&&<><Tag>估值</Tag>{group?.knownCashCount>0&&<p className="finance-muted">现金 {money(group.knownCashMinor)}</p>}</>}
   {group?.oldestAsOf&&<p className="finance-muted">截至 {group.oldestAsOf}{group.newestAsOf!==group.oldestAsOf?' 至 '+group.newestAsOf:''}</p>}
   {!!group?.accountIds.length&&<Button type="link" size="small" onClick={()=>onSelect(group.accountIds)}>查看账户</Button>}
  </Card>;})}
 </div></section>;
}
