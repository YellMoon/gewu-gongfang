import React from 'react';
import { Card, Table, Tag } from 'antd';
import { formatMinor } from '../services/personalFinanceClient.mjs';
export default function FinanceSecurities({registers,periods,accounts}:{registers:any[];periods:any[];accounts:any[];startDate:string;endDate:string}){
 const money=(value:any)=>value==null?'待核对':formatMinor(value).replace(/^-/, '−');
 if(!registers.length)return <p>暂无证券账单。</p>;
 return <>{registers.map(register=>{const period=periods.find(p=>p.financialAccountId===register.financialAccountId),account=accounts.find(a=>a.id===register.financialAccountId);return <Card key={register.financialAccountId} title={account?.label||'证券账户'} style={{marginTop:16}}>
   <div className="finance-summary">
    <Card size="small"><span>期间入金</span><div className="finance-value">{money(period?.depositMinor??'0')}</div></Card>
    <Card size="small"><span>期间出金</span><div className="finance-value">{money(period?.withdrawalMinor??'0')}</div></Card>
    <Card size="small"><span>已实现收益</span><div className="finance-value">{money(period?.netRealizedMinor??'0')}</div></Card>
   </div>
   <p className="finance-muted">交易费用 {money(period?.expenseMinor??'0')}</p>
   <h3 className="finance-section-title">持仓与估值</h3>
   <p className="finance-muted">持仓 {register.holdingsAsOf||register.cashBalanceAsOf||register.cashLastStatementDate||'—'} · 收盘价 {register.valuationAsOf||'—'} {register.valuationStale&&<Tag>行情待更新</Tag>}</p>
   <div className="finance-summary">
    <Card size="small"><span>现金余额</span><div className="finance-value">{money(register.cashBalanceMinor)}</div>{!register.cashBalanceComplete&&<Tag>待核对</Tag>}</Card>
    <Card size="small"><span>持仓市值</span><div className="finance-value">{money(register.marketValueMinor)}</div></Card>
    <Card size="small"><span>账户总资产</span><div className="finance-value">{money(register.portfolioValueMinor)}</div><Tag>估值</Tag><div className="finance-muted">浮盈浮亏 {money(register.unrealizedGainMinor)}</div></Card>
   </div>
   <Table size="small" rowKey="securityCode" dataSource={register.positions||[]} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1000}} locale={{emptyText:'暂无持仓记录'}} columns={[{title:'代码',dataIndex:'securityCode'},{title:'证券',dataIndex:'securityName'},{title:'数量',dataIndex:'units',render:(v:any)=>v??'待核对'},{title:'持仓成本',dataIndex:'costMinor',render:money},{title:'收盘价',dataIndex:'closePrice',render:(v:any)=>v??'待获取'},{title:'报价日期',dataIndex:'quoteDate',render:(v:any)=>v||'—'},{title:'市值',dataIndex:'marketValueMinor',render:money},{title:'浮盈浮亏',dataIndex:'unrealizedGainMinor',render:money}]}/>
  </Card>;})}</>;
}
