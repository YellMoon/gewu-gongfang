// UTF-8: display server aggregates by account nature; never net assets against debts here.
import React from 'react';
import { Button, Card } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
const labels:Record<string,string>={savings:'储蓄卡账户余额',credit:'信用卡总欠款',mortgage:'房贷剩余本金',securities:'证券账户总资产',other:'其他资金账户余额'};
export default function FinanceBalanceGroups({groups,accounts=[],endDate,currency,ready,onSelect}:{groups:any[];accounts?:any[];endDate?:string;currency:string;ready:boolean;onSelect:(ids:string[])=>void}){
 const selected=groups.filter(g=>g.currency===currency);
 return <section aria-label="分类账户余额"><h3 className="finance-section-title">分类账户余额</h3><div className="finance-summary finance-balance-groups">
  {['savings','credit','mortgage','securities',...(selected.some(g=>g.key==='other')?['other']:[])].map(key=>{const group=selected.find(g=>g.key===key);return <Card size="small" key={key}>
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
