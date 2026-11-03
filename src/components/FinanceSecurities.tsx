// UTF-8: securities cash withdrawals may include profit; display them as cash flows.
import React from 'react';
import { Alert, Card, Table } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
export default function FinanceSecurities({registers,periods,accounts,startDate,endDate}:{registers:any[];periods:any[];accounts:any[];startDate:string;endDate:string}){
 const money=(value:any)=>value===null||value===undefined?'未知':formatMinor(value).replace(/^-/, '−');
 if(!registers.length)return <p>所选账户尚无已导入的证券账单。</p>;
 return <>
  <Alert type="info" showIcon message="证券账户独立核算" description="银证转账是资产划转；交易盈亏、分红、利息和费用均不并入生活收入支出。已实现盈亏不代表账户总收益；缺少对应日期的持仓市值时，账户总资产和浮盈浮亏保持未知。"/>
  {registers.map(register=>{const period=periods.find(p=>p.financialAccountId===register.financialAccountId),account=accounts.find(a=>a.id===register.financialAccountId);return <Card key={register.financialAccountId} title={account?.label||'证券账户'} style={{marginTop:16}}>
   <p className="finance-muted">所选期间：{startDate||'全部已导入日期'} 至 {endDate||'最近已导入日期'}。以下期间收支由云端按证券账本统计。</p>
   <div className="finance-summary">
    <Card size="small"><span>期间入金（银证转入）</span><div className="finance-value">{money(period?.depositMinor??'0')}</div></Card>
    <Card size="small"><span>期间出金（银证转出）</span><div className="finance-value">{money(period?.withdrawalMinor??'0')}</div></Card>
    <Card size="small"><span>期间已实现净收益</span><div className="finance-value">{money(period?.netRealizedMinor??'0')}</div><div className="finance-muted">含已确认交易盈亏、分红及利息，扣除交易费用；不含浮盈浮亏。</div></Card>
   </div>
   <p>期间已实现收益（费用前）：{money(period?.incomeMinor??'0')}；期间费用：{money(period?.expenseMinor??'0')}。</p>
   <h3 className="finance-section-title">已导入持仓与收盘价估值</h3>
   <p className="finance-muted">持仓与现金依据截至 {register.holdingsAsOf||register.cashBalanceAsOf||register.cashLastStatementDate||'未知日期'}；收盘价截至 {register.valuationAsOf||'尚未取得'}。按已导入持仓估值，之后未导入的交易不在其中。{register.valuationStale&&'行情暂未更新，沿用已保存的收盘价。'}</p>
   <div className="finance-summary">
    <Card size="small"><span>证券现金余额</span><div className="finance-value">{money(register.cashBalanceMinor)}</div>{!register.cashBalanceComplete&&<div className="finance-muted">现金流水完整性尚未确认。</div>}</Card>
    <Card size="small"><span>持仓市值</span><div className="finance-value">{money(register.marketValueMinor)}</div><div className="finance-muted">持仓数量 × 最近交易日收盘价，云端计算。</div></Card>
    <Card size="small"><span>账户总资产</span><div className="finance-value">{money(register.portfolioValueMinor)}</div><div className="finance-muted">浮盈浮亏：{money(register.unrealizedGainMinor)}</div></Card>
   </div>
   <Table size="small" rowKey="securityCode" dataSource={register.positions||[]} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1000}} locale={{emptyText:'已导入记录未显示剩余持仓；完整性以账单核对结果为准。'}} columns={[{title:'代码',dataIndex:'securityCode'},{title:'证券',dataIndex:'securityName'},{title:'持仓数量',dataIndex:'units',render:(v:any)=>v??'未知'},{title:'记录持仓成本',dataIndex:'costMinor',render:money},{title:'收盘价',dataIndex:'closePrice',render:(v:any)=>v??'待获取'},{title:'报价日期',dataIndex:'quoteDate',render:(v:any)=>v||'未知'},{title:'持仓市值',dataIndex:'marketValueMinor',render:money},{title:'浮盈浮亏',dataIndex:'unrealizedGainMinor',render:money}]}/>
  </Card>;})}
 </>;
}
