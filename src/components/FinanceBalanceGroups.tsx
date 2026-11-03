// UTF-8: display server aggregates by account nature; never net assets against debts here.
import React from 'react';
import { Button, Card } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
const labels:Record<string,string>={savings:'储蓄卡账户余额',credit:'信用卡总欠款',mortgage:'房贷剩余本金',securities:'证券账户总资产',other:'其他资金账户余额'};
export default function FinanceBalanceGroups({groups,currency,ready,onSelect}:{groups:any[];currency:string;ready:boolean;onSelect:(ids:string[])=>void}){
 const selected=groups.filter(g=>g.currency===currency);
 return <section aria-label="分类账户余额"><h3 className="finance-section-title">分类账户余额</h3><div className="finance-summary finance-balance-groups">
  {['savings','credit','mortgage','securities',...(selected.some(g=>g.key==='other')?['other']:[])].map(key=>{const group=selected.find(g=>g.key===key);return <Card size="small" key={key}>
   <span>{labels[key]}</span><div className="finance-value" data-testid={'balance-'+key}>{ready&&group?.knownCount?formatMinor(group.knownBalanceMinor).replace(/^-/, '−'):'—'}</div>
   <div className="finance-muted">{group?.knownCount||0} 个有余额依据 · {group?.unknownCount||0} 个未知</div>
   {key==='credit'&&<p className="finance-muted">正数为欠款，负数为溢缴金。{group?.billedDebtCount>0&&<>另有 {group.billedDebtCount} 个账户仅有已出账应还款 {formatMinor(group.billedDebtMinor)}，未作为总欠款相加。</>}</p>}
   {key==='mortgage'&&group?.estimatedCount>0&&<p className="finance-muted">另有 {group.estimatedCount} 项估算本金 {formatMinor(group.estimatedBalanceMinor)}，未并入有依据的小计。</p>}
   {key==='securities'&&<p className="finance-muted">{group?.knownCashCount>0?<>已知证券现金 {formatMinor(group.knownCashMinor)}；</>:null}现金不代表含持仓市值的账户总资产。</p>}
   {group?.oldestAsOf&&<p className="finance-muted">依据日期：{group.oldestAsOf}{group.newestAsOf!==group.oldestAsOf?' 至 '+group.newestAsOf:''}</p>}
   {!!group?.accountIds.length&&<Button type="link" size="small" onClick={()=>onSelect(group.accountIds)}>查看这类账户</Button>}
  </Card>;})}
 </div></section>;
}
