// UTF-8: display server aggregates by account nature; never net assets against debts here.
import React from 'react';
import { Button, Card } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
const labels:Record<string,string>={savings:'储蓄卡账户余额',credit:'信用卡总欠款',mortgage:'房贷剩余本金',securities:'证券账户总资产',other:'其他资金账户余额'};
export function MortgageBalanceCards({accounts,models,stats,ids,ready,onSelect}:{accounts:any[];models:any[];stats:Record<string,any>;ids:string[];ready:boolean;onSelect:(ids:string[])=>void}){
 const rows=ids.map(id=>({id,account:accounts.find(a=>a.id===id),model:models.find(m=>m.financialAccountId===id),stats:stats[id]||{}}));
 const type=(row:any)=>row.account?.mortgage?.loanType||row.model?.loanType;
 const types=['commercial','provident',...(rows.some(row=>!['commercial','provident'].includes(type(row)))?['other']:[])];
 const titles:Record<string,string>={commercial:'商业贷款剩余本金',provident:'公积金贷款剩余本金',other:'其他房贷剩余本金'};
 return <>{types.map(kind=>{const loans=rows.filter(row=>kind==='other'?!['commercial','provident'].includes(type(row)):type(row)===kind);return <Card size="small" key={kind}><span>{titles[kind]}</span>{loans.length?loans.map(row=>{const known=row.stats.balanceMinor!=null,amount=known?row.stats.balanceMinor:row.stats.estimatedBalanceMinor,date=known?row.stats.balanceAnchor?.asOf?.slice(0,10)||row.stats.balanceAsOf:row.stats.estimateAsOf;return <div key={row.id}>
  <div className="finance-muted">{row.account?.label||row.model?.label}</div><div className="finance-value" data-testid={'balance-mortgage-'+kind}>{ready&&amount!=null?formatMinor((-BigInt(amount)).toString()).replace(/^-/, '−'):'—'}</div>
  <div className="finance-muted">{!ready?'读取后显示本金依据':amount==null?'本金依据待补充':known?(row.stats.actualMortgageStatement?'银行还款记录':'已核对本金'):'模型估算，非银行确认余额'}</div>
  {ready&&date&&<p className="finance-muted">依据日期：{date}</p>}<Button type="link" size="small" onClick={()=>onSelect([row.id])}>查看此贷款账户</Button>
 </div>;}):<><div className="finance-value">—</div><p className="finance-muted">{ready?'当前范围无此类贷款账户':'读取后显示贷款账户'}</p></>}</Card>;})}</>;
}
export default function FinanceBalanceGroups({groups,accounts=[],mortgages=[],accountStats={},endDate,currency,ready,onSelect}:{groups:any[];accounts?:any[];mortgages?:any[];accountStats?:Record<string,any>;endDate?:string;currency:string;ready:boolean;onSelect:(ids:string[])=>void}){
 const selected=groups.filter(g=>g.currency===currency);
 return <section aria-label="分类账户余额"><h3 className="finance-section-title">分类账户余额</h3><div className="finance-summary finance-balance-groups">
  {['savings','credit','mortgage','securities',...(selected.some(g=>g.key==='other')?['other']:[])].map(key=>{const group=selected.find(g=>g.key===key);if(key==='mortgage')return <MortgageBalanceCards key={key} accounts={accounts} models={mortgages} stats={accountStats} ids={group?.accountIds||[]} ready={ready} onSelect={onSelect}/>;return <Card size="small" key={key}>
   <span>{labels[key]}</span><div className="finance-value" data-testid={'balance-'+key}>{ready&&group?.knownCount?formatMinor(group.knownBalanceMinor).replace(/^-/, '−'):'—'}</div>
   <div className="finance-muted">{group?.knownCount||0} 个有余额依据 · {group?.unknownCount||0} 个未知</div>
   {key==='credit'&&<>
    {ready&&group?.billedDebtCount>0&&<div className="finance-billed-debt"><span>已出账应还款小计</span><div className="finance-value" data-testid="balance-credit-billed">{formatMinor(group.billedDebtMinor).replace(/^-/, '−')}</div><div className="finance-muted">{group.billedDebtCount} 个账户的最近已导入账单</div>
     <details><summary>查看各卡金额与账单日期</summary>{accounts.filter(a=>group.accountIds.includes(a.id)&&a.verifiedBalance?.balanceKind==='billed_debt'&&(!endDate||a.verifiedBalance.asOf.slice(0,10)<=endDate)).map(a=><p key={a.id}><Button type="link" size="small" onClick={()=>onSelect([a.id])}>{a.label}</Button><br/><strong className="finance-number">{formatMinor((-BigInt(a.verifiedBalance.balanceMinor)).toString()).replace(/^-/, '−')}</strong><span className="finance-muted"> · {a.verifiedBalance.asOf.slice(0,10)}</span></p>)}</details>
    </div>}
    <p className="finance-muted">正数为欠款，负数为溢缴金。{!group?.knownCount&&'当前总欠款待核对。'}{group?.billedDebtCount>0&&'账单日期可能不同，未扣除账单后的还款，不代表当前总欠款。'}</p>
   </>}
   {key==='mortgage'&&group?.estimatedCount>0&&<p className="finance-muted">另有 {group.estimatedCount} 项估算本金 {formatMinor(group.estimatedBalanceMinor)}，未并入有依据的小计。</p>}
   {key==='securities'&&<p className="finance-muted">{group?.knownCashCount>0?<>已知证券现金 {formatMinor(group.knownCashMinor)}；</>:null}总资产按已导入持仓及收盘价估值，含现金；持仓和报价日期在证券账户中查看。</p>}
   {group?.oldestAsOf&&<p className="finance-muted">依据日期：{group.oldestAsOf}{group.newestAsOf!==group.oldestAsOf?' 至 '+group.newestAsOf:''}</p>}
   {!!group?.accountIds.length&&<Button type="link" size="small" onClick={()=>onSelect(group.accountIds)}>查看这类账户</Button>}
  </Card>;})}
 </div></section>;
}
