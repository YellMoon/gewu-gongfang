import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import dayjs from 'dayjs';
import BillRelatedAccounts,{relatedAccountsReady,relatedAccountSnapshot} from './BillRelatedAccounts';
// @ts-ignore Shared integer ledger is used by cloud and both clients.
import { buildFinanceView } from '../../shared/personal-finance/ledger.js';
// @ts-ignore Shared asset register uses immutable statement evidence.
import { buildAssetRegister } from '../../shared/personal-finance/assetRegister.js';
// @ts-ignore Shared exact-integer aggregations.
import { buildTrend } from '../../shared/personal-finance/accountAnalytics.js';
import { createPersonalFinanceClient, formatMinor, parseMoney } from '../services/personalFinanceClient.mjs';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
const TYPES: Record<string, string> = { cash: '现金', bank: '银行账户', savings: '储蓄', debit_card: '借记卡', credit_card: '信用卡', wallet: '电子钱包', loan: '贷款', investment: '证券与基金', insurance: '保险', receivable: '应收款', property: '不动产', precious_metal: '贵金属', retirement: '养老金', other: '其他资产' };
const KINDS: Record<string, string> = { expense: '消费', income: '收入', transfer: '转账', refund: '退款', loan_drawdown: '借款到账', debt_payment: '还款/月供', interest: '利息', fee: '手续费', unknown: '待分类' };
const client = createPersonalFinanceClient();
const empty = { accounts: [], observations: [], links: [], balanceSnapshots: [], imports: [], legacyRecords: [], revision: '0' };
export function FinanceTrend({rows,currency}:{rows:any[];currency:string}) {
  if(!rows.length)return null;
  const values=rows.flatMap(r=>[BigInt(r.values[currency]?.incomeMinor||'0'),BigInt(r.values[currency]?.consumptionMinor||'0')]);
  const low=values.reduce((a,b)=>a<b?a:b,0n),high=values.reduce((a,b)=>a>b?a:b,0n),range=high-low||1n;
  // Only the final pixel ratio uses floating point; monetary totals stay exact.
  const y=(v:string)=>220-Number((BigInt(v)-low)*18000n/range)/100;
  const x=(i:number)=>90+i*790/Math.max(rows.length-1,1);
  const series=[{key:'incomeMinor',label:'\u6536\u5165',color:'#1677ff'},{key:'consumptionMinor',label:'\u652f\u51fa\uff08\u6263\u9664\u9000\u6b3e\uff09',color:'#c7511f'}];
  return <figure style={{margin:'12px 0',padding:12,border:'1px solid #d9d9d9',borderRadius:8}}>
    <figcaption>{currency} {'\u6536\u652f\u8d8b\u52bf'} <span style={{color:'#1677ff'}}>{'\u2501'} {'\u6536\u5165'}</span> <span style={{color:'#c7511f'}}>{'\u2504'} {'\u652f\u51fa'}</span></figcaption>
    <svg role="img" aria-label={currency+'\u6536\u5165\u4e0e\u652f\u51fa\u8d8b\u52bf'} viewBox="0 0 920 270" style={{width:'100%',minHeight:190,maxHeight:340,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
      {[0,1,2,3,4].map(i=>{const amount=low+range*BigInt(i)/4n;return <g key={i}><line x1="90" x2="880" y1={y(amount.toString())} y2={y(amount.toString())} stroke="#e5e7eb"/><text x="82" y={y(amount.toString())+4} textAnchor="end" fontSize="12">{formatMinor(amount.toString())}</text></g>;})}
      <line x1="90" x2="880" y1={y('0')} y2={y('0')} stroke="#8c8c8c"/>
      {series.map(s=><g key={s.key}><polyline fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.key==='consumptionMinor'?'7 4':undefined} points={rows.map((r,i)=>x(i)+','+y(r.values[currency]?.[s.key]||'0')).join(' ')}/>{rows.map((r,i)=><circle key={r.date} cx={x(i)} cy={y(r.values[currency]?.[s.key]||'0')} r={rows.length>180?1.5:3} fill={s.color}><title>{r.date+' '+s.label+' '+formatMinor(r.values[currency]?.[s.key]||'0')}</title></circle>)}</g>)}
      {rows.map((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/6))===0?<text key={r.date} x={x(i)} y="250" textAnchor="middle" fontSize="12">{r.date}</text>:null)}
    </svg>
    <details><summary>{'\u67e5\u770b\u8d8b\u52bf\u6570\u636e'}</summary><Table size="small" rowKey="date" dataSource={rows.map(r=>({date:r.date,...r.values[currency]}))} pagination={{pageSize:12}} columns={[{title:'\u65e5\u671f',dataIndex:'date'},{title:'\u6536\u5165',dataIndex:'incomeMinor',render:formatMinor},{title:'\u652f\u51fa',dataIndex:'consumptionMinor',render:formatMinor}]}/></details>
  </figure>;
}
export default function PersonalFinancePanel() {
  const [ledger, setLedger] = useState<any>(empty), [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<any>([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [granularity, setGranularity] = useState('month');
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [accountModal, setAccountModal] = useState(false), [form] = Form.useForm();
  const [importAccount, setImportAccount] = useState<string>(), [file, setFile] = useState<any>(), [preview, setPreview] = useState<any>();
  const [relatedAccountIds,setRelatedAccountIds] = useState<any>({});
  const [mapping, setMapping] = useState(''), [mailStatus, setMailStatus] = useState<any>();
  const [mailLoading, setMailLoading] = useState(true), [mailFailure, setMailFailure] = useState('');
  const [passwordModal,setPasswordModal] = useState(false);
  const [linkIds, setLinkIds] = useState<string[]>([]), [linkType, setLinkType] = useState('duplicate');
  const sequence = useRef(0), fileSequence = useRef(0), mounted = useRef(true), fileRef = useRef<HTMLInputElement>(null);
  const scope = () => { try { const s = readDesktopAuthorizationSession(); return JSON.stringify([s.authorization, s.authContext.activeRole]); } catch { return ''; } };
  const reload = async () => {
    const n = ++sequence.current, owner = scope(); setFailure('');
    try { const data = await client.getLedger(); if (mounted.current && n === sequence.current && scope() === owner) setLedger(data.ledger); }
    catch (e: any) { if (mounted.current && n === sequence.current && scope() === owner) setFailure(e.code || 'FINANCE_REQUEST_FAILED'); }
  };
  const loadMailbox = async () => {
    const owner = scope(); setMailLoading(true); setMailFailure(''); setMailStatus(undefined);
    try { const value = await client.mailboxStatus(); if (mounted.current && scope() === owner) setMailStatus(value.mailbox); }
    catch (e: any) { if (mounted.current && scope() === owner) setMailFailure(e.code === 'BILL_MAIL_ACCESS_DENIED' ? '当前账号无权使用专用收件邮箱，可选择账单文件导入。' : e.code === 'BILL_MAIL_NOT_CONFIGURED' ? '专用收件邮箱尚未配置，请联系管理员；也可选择账单文件导入。' : '暂时无法读取收件邮箱，请联网后点击“查看邮箱”重试。'); }
    finally { if (mounted.current && scope() === owner) setMailLoading(false); }
  };
  useEffect(() => { mounted.current = true; void reload(); void loadMailbox(); const imported = () => void reload(); window.addEventListener('personal-finance-imported', imported); return () => { window.removeEventListener('personal-finance-imported', imported); mounted.current = false; sequence.current++; }; }, []);
  const run = async (work: (current: () => boolean) => Promise<any>) => {
    const owner = scope(); setBusy(true);
    const current = () => mounted.current && scope() === owner;
    try { const value = await work(current); if (!current()) return; await reload(); if (!current()) return; message.success('云端已处理'); return value; }
    catch (e: any) { if (mounted.current && scope() === owner) message.error(e.code === 'CLOUD_PERSONAL_FINANCE_REVISION_CONFLICT' ? '云端已更新，请刷新后重试。' : `处理失败：${e.code || 'FINANCE_REQUEST_FAILED'}`); }
    finally { if (mounted.current && scope() === owner) setBusy(false); }
  };
  const view = useMemo(() => buildFinanceView(ledger, { ...(selected.length ? { accountIds: selected } : {}), startDate: period?.[0]?.format('YYYY-MM-DD'), endDate: period?.[1]?.format('YYYY-MM-DD') }), [ledger, selected, period]);
  const accounts = ledger.accounts.map((a: any) => ({ value: a.id, label: `${a.label} · ${a.currency} · ${TYPES[a.type] || a.type}` }));
  const options = () => {
    if (!mapping.trim()) return undefined;
    const value = JSON.parse(mapping); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('INVALID_MAPPING'); return value;
  };
  const chooseFile = async (f?: File) => {
    const n = ++fileSequence.current;
    setPreview(null); setFile(null); setRelatedAccountIds({}); if (!f) return;
    if (f.size > 20 * 1024 * 1024) { message.error('文件最大 20 MB'); return; }
    const owner = scope();
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(f); });
    if (mounted.current && scope() === owner && n === fileSequence.current) setFile({ filename: f.name, base64, idempotencyKey: crypto.randomUUID() });
  };
  const doPreview = async () => {
    const owner = scope(), n = ++fileSequence.current; setBusy(true); setPreview(null);
    try { const input = { filename: file.filename, base64: file.base64, financialAccountId: importAccount, relatedFinancialAccountIds: relatedAccountIds, fieldMapping: options(), password: file.password || undefined }, key = file.idempotencyKey; const data = await client.previewFile(input); if (mounted.current && scope() === owner && n === fileSequence.current) setPreview({ ...data.preview, reviewedInput: { ...input, expectedFinancialAccountId:data.preview.accountResolution?.account?.id, expectedRelatedFinancialAccountIds:relatedAccountSnapshot(data.preview.relatedAccountResolutions) }, reviewedKey: key }); }
    catch (e: any) { if (mounted.current && scope() === owner && n === fileSequence.current) message.error(`无法解析：${e.code || '请检查字段映射'}`); }
    finally { if (mounted.current && scope() === owner) setBusy(false); }
  };
  const accountRows = ledger.accounts.filter((a: any) => !selected.length || selected.includes(a.id)).map((a: any) => ({ ...a, ...view.accountStats[a.id] }));
  const trend = useMemo(() => buildTrend(view.transactions, {startDate:period?.[0]?.format('YYYY-MM-DD'),endDate:period?.[1]?.format('YYYY-MM-DD'),granularity,currencies:Object.keys(view.currencyTotals)}), [view,period,granularity]);
  const assetRegister = useMemo(() => buildAssetRegister(ledger), [ledger]);
  const verifyBalance = (a: any) => Modal.confirm({
    title: a.label + ' \u00b7 \u4f59\u989d\u6838\u5bf9',
    okText:'\u4fdd\u5b58\u6838\u5bf9',cancelText:'\u53d6\u6d88',
    content:<Form id="asset-balance-form" layout="vertical"><Form.Item label={'\u4f59\u989d\uff08\u5143\uff09'}><Input name="balance" aria-label={'\u6838\u5bf9\u4f59\u989d'} placeholder={'\u6b20\u6b3e\u586b\u8d1f\u6570\uff1b0 \u8868\u793a\u5df2\u786e\u8ba4\u4e3a\u96f6'}/></Form.Item><Form.Item label={'\u4f59\u989d\u5bf9\u5e94\u65f6\u95f4'}><Input name="asOf" aria-label={'\u4f59\u989d\u5bf9\u5e94\u65f6\u95f4'} type="datetime-local" defaultValue={dayjs().format('YYYY-MM-DDTHH:mm')}/></Form.Item><Form.Item label={'\u6838\u5bf9\u4f9d\u636e\u6216\u5907\u6ce8'}><Input name="note" aria-label={'\u6838\u5bf9\u4f9d\u636e\u6216\u5907\u6ce8'}/></Form.Item></Form>,
    onOk: async () => {
      const data = new FormData(document.getElementById('asset-balance-form') as HTMLFormElement);
      const amount = String(data.get('balance') || ''), asOf = new Date(String(data.get('asOf') || ''));
      if (!/^-?\d+(?:\.\d{1,2})?$/.test(amount) || Number.isNaN(asOf.getTime())) throw new Error('\u8bf7\u586b\u5199\u6709\u6548\u4f59\u989d\u548c\u5bf9\u5e94\u65f6\u95f4');
      const result = await run(() => client.createBalanceSnapshot({expectedRevision:ledger.revision,snapshot:{financialAccountId:a.id,currency:a.currency,balanceMinor:parseMoney(amount),asOf:asOf.toISOString(),source:'manual',balanceConvention:'signed',note:String(data.get('note')||'')}}));
      if (!result) throw new Error('\u4f59\u989d\u6838\u5bf9\u672a\u4fdd\u5b58');
    },
  });
  const previousCategories = view.comparison?.previous.categoryTotals || {};
  const categoryRows = [...new Set([...Object.keys(view.categoryTotals), ...Object.keys(previousCategories)])].flatMap(currency => [...new Set([...Object.keys(view.categoryTotals[currency] || {}), ...Object.keys(previousCategories[currency] || {})])].map(category => ({ id: currency + category, currency, category: category || '未分类', amount: view.categoryTotals[currency]?.[category] || '0', previous: previousCategories[currency]?.[category] || '0' })));
  const observationLabel = (o: any) => `${o.date} ${ledger.accounts.find((a: any) => a.id === o.financialAccountId)?.label || o.financialAccountId} ${o.provider} ${o.currency || ''} ${formatMinor(o.amountMinor)} ${o.description} · 交易号 ${o.sourceTransactionId || '无'} · 资金尾号 ${o.paymentAccountHint || '无'}`;
  const fundingRows = view.transactions.filter((t: any) => ['expense', 'debt_payment', 'interest', 'fee', 'loan_drawdown'].includes(t.kind)).map((t: any) => ({ ...t, funding: t.financialAccountIds.map((id: string) => TYPES[ledger.accounts.find((a: any) => a.id === id)?.type] || '待确认').join(' / ') }));
  return <Card title="账户资产与账单关联" style={{ marginBottom: 16 }}>
    {failure && <Alert type="warning" showIcon message="财务云端暂不可用" description={`${failure}。原有收支记录仍可在下方查看。`} />}
    <Alert type={mailFailure ? 'warning' : 'info'} showIcon style={{ marginBottom: 16 }} message="账单收件邮箱与使用说明" description={<div style={{ lineHeight: 1.8 }}>
      <div>{mailLoading ? '正在读取当前账号可用的收件邮箱…' : mailFailure || (mailStatus?.address ? <>请将账单发送至：<strong style={{ overflowWrap: 'anywhere' }}>{mailStatus.address}</strong></> : '当前未返回可用收件地址，请点击“账单与专用邮箱”中的“查看邮箱”重试。')}</div>
      <div>在银行、支付宝或微信导出账单时，将上方邮箱填为收件地址；已有账单附件也可转发到该邮箱。此邮箱仅用于收集账单，无需在本软件填写个人邮箱密码。</div>
      <div>收件后点击下方“检查收件箱 / 逐份输入密码”，在窗口内对照邮件和文件逐份填写密码并验证，软件会按来源自动匹配或创建账户，预览后再确认导入。收件不会自动入账。</div>
    </div>} />
    <Space wrap style={{ marginBottom: 16 }}><Button type="primary" onClick={() => window.dispatchEvent?.(new Event('bill-mailbox-open'))}>检查收件箱 / 逐份输入密码</Button><span>登录且联网后自动检测一次；可在独立窗口核对每份账单并批量导入。</span></Space>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="统计账户" mode="multiple" showSearch optionFilterProp="label" allowClear placeholder="全部账户（可多选）" style={{ minWidth: 280 }} options={accounts} value={selected} onChange={setSelected} />
      <Button onClick={() => setSelected([])}>全部账户</Button>
      <Button onClick={() => setPeriod(null)}>全部日期</Button>
      <DatePicker.RangePicker placeholder={['开始日期','结束日期']} value={period} onChange={setPeriod} allowClear />
      <Button onClick={() => void reload()} disabled={busy}>刷新</Button><Button onClick={() => setAccountModal(true)}>新增账户</Button>
    </Space>
    <Alert type="info" message="收支归到实际资金账户，转账、申购本金和还款本金不计入收入或支出；退款冲减支出。账户自己的完整账单优先提供资金变动，平台记录保留为来源依据。余额推算使用已记录流水，缺失余额不会按零汇总，币种分别统计。" />
    {view.transactions.some((t:any)=>t.statisticsExclusions?.length>0)&&<Alert type="warning" showIcon message={"有 "+view.transactions.filter((t:any)=>t.statisticsExclusions?.length>0).length+" 条平台记录可能与信用卡账单重叠"} description="暂按信用卡原账单计入收支，疑似重叠的平台记录未再次计入。请在交易与关联复核中确认重复或标记为不同交易；原始记录全部保留。"/>}
    <section aria-label="账户收支与余额总览" style={{margin:'20px 0'}}>
      <h3>{selected.length ? '已选 '+selected.length+' 个账户' : '全部账户'} · 收支与余额</h3>
      <p>{period ? period[0].format('YYYY-MM-DD')+' 至 '+period[1].format('YYYY-MM-DD') : '全部已导入日期'}。余额{period ? '推算至 '+period[1].format('YYYY-MM-DD')+'（仅含已记录变动）' : '按最近余额依据和已记录变动计算'}。</p>
      <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>{Object.entries(view.currencyTotals).map(([currency,v]:any)=>{const b=view.portfolioBalances[currency];return <Card key={currency} size="small" title={currency} style={{flex:'1 1 280px'}}>
        <div style={{display:'flex',gap:28,flexWrap:'wrap',fontVariantNumeric:'tabular-nums'}}>
          <div>支出（扣除退款）<div style={{fontSize:24,fontWeight:600}} data-testid="expense-total">{formatMinor(v.consumptionMinor)}</div></div>
          <div>收入<div style={{fontSize:24,fontWeight:600}} data-testid="income-total">{formatMinor(v.incomeMinor)}</div></div>
          <div>{b?.complete?'账户组合余额':'已知余额小计'}<div style={{fontSize:24,fontWeight:600}} data-testid="balance-total">{formatMinor(b?.knownCount?b.knownBalanceMinor:null)}</div></div>
        </div>
        <p>{b?.knownCount||0} 个账户有余额依据；{b?.unknownCount||0} 个待核对；{b?.derivedCount||0} 个由余额依据与流水推算。负数表示负债。</p>
      </Card>;})}</div>
      <Space wrap style={{margin:'20px 0 8px'}}><strong>收入与支出趋势</strong><Select aria-label="趋势粒度" value={granularity} onChange={setGranularity} options={[{value:'day',label:'按日'},{value:'week',label:'按周'},{value:'month',label:'按月'}]} /></Space>
      {Object.keys(view.currencyTotals).map(currency=><FinanceTrend key={currency} currency={currency} rows={trend} />)}
      {!trend.length&&<p>所选期间暂无账单记录。</p>}
    </section>
    <Tabs defaultActiveKey="overview" items={[
      { key:'assets', label:'\u8d44\u4ea7\u7cfb\u7edf\u8868', children:<>
        <Alert type="info" showIcon style={{margin:'16px 0'}} message={'\u6309\u5b9e\u9645\u8d44\u91d1\u8d26\u6237\u6574\u7406\uff0c\u57fa\u91d1\u5728\u7406\u8d22\u8d26\u6237\u5185\u6309\u4ea7\u54c1\u5217\u793a'} description={'\u672c\u8868\u4f7f\u7528\u5168\u90e8\u5df2\u5bfc\u5165\u8d26\u5355\u3002\u6838\u5bf9\u4f59\u989d\u4fdd\u7559\u5bf9\u5e94\u65f6\u70b9\uff1b\u672a\u77e5\u4f59\u989d\u4fdd\u6301\u7a7a\u7f3a\uff0c\u4e0d\u4ee5\u96f6\u4ee3\u66ff\uff0c\u4e0d\u6c47\u603b\u4e3a\u5b8c\u6574\u51c0\u8d44\u4ea7\u3002\u94f6\u884c\u5361\u6309\u94f6\u884c\u3001\u5361\u7c7b\u578b\u548c\u5c3e\u53f7\u533a\u5206\uff0c\u5fae\u4fe1\u4e0e\u652f\u4ed8\u5b9d\u53ea\u6807\u8bb0\u8d26\u5355\u6e20\u9053\u3002'} />
        <Space wrap style={{marginBottom:16}}><Button disabled={busy || !assetRegister.proposals.accounts.length} onClick={() => void run(() => client.discoverAccounts({expectedRevision:ledger.revision}))}>{'\u6839\u636e\u8d26\u5355\u8865\u5efa\u8d26\u6237'}{assetRegister.proposals.accounts.length ? '\uff08'+assetRegister.proposals.accounts.length+'\uff09' : ''}</Button><span>{'\u540e\u7eed\u5bfc\u5165\u7684\u8d26\u5355\u53ef\u7ee7\u7eed\u8865\u5145\u8d26\u6237\uff1b\u4f59\u989d\u548c\u5173\u8054\u53ef\u9010\u6b65\u6838\u5bf9\u3002'}</span></Space>
        <Table rowKey="id" dataSource={assetRegister.accounts.filter((a:any)=>!selected.length||selected.includes(a.id))} pagination={{pageSize:15}} scroll={{x:1200}} columns={[
          {title:'\u8d26\u6237\u7c7b\u522b',dataIndex:'group'},{title:'\u8d26\u6237',dataIndex:'label',render:(v:string,a:any)=>a.type==='wallet'&&v==='\u5fae\u4fe1\u652f\u4ed8'?'\u5fae\u4fe1\u96f6\u94b1':a.type==='wallet'&&v==='\u652f\u4ed8\u5b9d'?'\u652f\u4ed8\u5b9d\u4f59\u989d':v},
          {title:'\u8d26\u5355\u6e20\u9053',dataIndex:'channels',render:(v:string[])=>v.map(x=>({wechat:'\u5fae\u4fe1',alipay:'\u652f\u4ed8\u5b9d',mybank:'\u7f51\u5546\u94f6\u884c'} as Record<string,string>)[x]||x).join(' / ')||'\u2014'},
          {title:'\u6838\u5bf9\u4f59\u989d',render:(_:any,a:any)=>a.verifiedBalance?formatMinor(a.verifiedBalance.balanceMinor):'\u5f85\u6838\u5bf9'},
          {title:'\u4f59\u989d\u4f9d\u636e',render:(_:any,a:any)=>a.verifiedBalance?({billed_debt:'已出账应还款（不含未出账）',available:'\u53ef\u7528\u4f59\u989d',estimated:'\u94f6\u884c\u8bd5\u7b97\u4f59\u989d',distributor_total:'\u8be5\u4ee3\u9500\u673a\u6784\u8d44\u4ea7'} as Record<string,string>)[a.verifiedBalance.balanceKind]||(a.verifiedBalance.source==='manual'?'\u4eba\u5de5\u6838\u5bf9':'\u8d26\u5355\u4f59\u989d'):a.balanceStatus},
          {title:'\u4f59\u989d\u65f6\u70b9',render:(_:any,a:any)=>a.verifiedBalance?dayjs(a.verifiedBalance.asOf).format('YYYY-MM-DD HH:mm'):'\u2014'},
          {title:'\u8d26\u5355\u8bb0\u5f55\u671f\u95f4',render:(_:any,a:any)=>a.firstDate?a.firstDate+' \u81f3 '+a.lastDate:'\u6682\u65e0\u8bb0\u5f55'},
          {title:'\u5173\u8054\u8bb0\u5f55',dataIndex:'evidenceCount'},
          {title:'\u64cd\u4f5c',render:(_:any,a:any)=><Space><Button size="small" disabled={busy} onClick={()=>verifyBalance(a)}>{'\u6838\u5bf9\u4f59\u989d'}</Button><Button size="small" disabled={busy} onClick={()=>Modal.confirm({title:'\u4fee\u6539\u8d26\u6237\u540d\u79f0',content:<Input id="asset-account-label" defaultValue={a.label} maxLength={128}/>,onOk:async()=>{const label=(document.getElementById('asset-account-label') as HTMLInputElement).value.trim();if(!label)throw new Error('\u8bf7\u586b\u5199\u540d\u79f0');const saved=await run(()=>client.updateAccount(a.id,{expectedRevision:ledger.revision,patch:{label}}));if(!saved)throw new Error('\u540d\u79f0\u672a\u4fdd\u5b58');}})}>{'\u6539\u540d'}</Button></Space>},
        ]}/>
        {assetRegister.proposals.unresolved.length>0&&<Alert type="warning" message={'\u6709 '+assetRegister.proposals.unresolved.length+' \u9879\u94f6\u884c\u5361\u8eab\u4efd\u5f85\u6838\u5bf9'} description={assetRegister.proposals.unresolved.map((v:any)=>(v.bank||'\u8d26\u6237')+' '+(v.tail||'')+'\uff1a'+(v.reason==='bank_type_unknown'?'\u8d26\u5355\u672a\u8bf4\u660e\u50a8\u84c4\u5361\u6216\u4fe1\u7528\u5361':'\u5df2\u6709\u8d26\u6237\u5b58\u5728\u6b67\u4e49')).join('\uff1b')}/>}
        <h3>{'\u57fa\u91d1\u4ea7\u54c1\u660e\u7ec6'}</h3>
        <Table rowKey="key" dataSource={assetRegister.products} pagination={false} scroll={{x:1150}} columns={[
          {title:'\u4ee3\u7801',dataIndex:'code'},{title:'\u57fa\u91d1\u4ea7\u54c1',dataIndex:'name'},{title:'\u4e70\u5165\u7b14\u6570',dataIndex:'count'},
          {title:'\u4e70\u5165\u786e\u8ba4\u91d1\u989d',dataIndex:'grossMinor',render:formatMinor},{title:'\u4e70\u5165\u624b\u7eed\u8d39',dataIndex:'feeMinor',render:formatMinor},{title:'\u7d2f\u8ba1\u4e70\u5165\u786e\u8ba4\u4efd\u989d',dataIndex:'boughtUnits'},
          {title:'\u8f6c\u6362\u8f6c\u51fa\u7533\u8bf7\u4efd\u989d',dataIndex:'conversionOutAppliedUnits'},{title:'\u8f6c\u6362\u8f6c\u5165\u91d1\u989d',dataIndex:'conversionInMinor',render:formatMinor},
          {title:'\u6838\u5bf9\u72b6\u6001',dataIndex:'status',render:(v:string)=>v==='conversion_units_pending'?'\u8f6c\u6362\u4efd\u989d\u5f85\u8865\u7b97':'\u4e70\u5165\u4efd\u989d\u5df2\u8bfb\u53d6\uff0c\u51c0\u503c\u5f85\u63a5\u5165'},
        ]}/>
        <p>{'\u7d2f\u8ba1\u4e70\u5165\u4efd\u989d\u4fdd\u7559\u539f\u59cb\u7cbe\u5ea6\uff0c\u4e0d\u76f4\u63a5\u5f53\u4f5c\u5f53\u524d\u6301\u4ed3\uff1b\u8f6c\u6362\u3001\u8d4e\u56de\u548c\u4f30\u503c\u7ed3\u679c\u4f1a\u5206\u522b\u6838\u5bf9\u3002'}</p>
        <Table rowKey="id" dataSource={assetRegister.conversions} pagination={false} scroll={{x:1000}} columns={[
          {title:'\u7533\u8bf7\u65f6\u95f4',dataIndex:'appliedAt',render:(v:string)=>dayjs(v).format('YYYY-MM-DD HH:mm')},
          {title:'\u8f6c\u51fa\u4ea7\u54c1',dataIndex:'sourceFundName',render:(v:string)=>v||'\u5f85\u5339\u914d'},{title:'\u8f6c\u5165\u4ea7\u54c1',dataIndex:'targetFundName',render:(v:string)=>v||'\u5f85\u5339\u914d'},
          {title:'\u8f6c\u6362\u91d1\u989d',dataIndex:'amountMinor',render:formatMinor},{title:'\u7533\u8bf7\u8f6c\u51fa\u4efd\u989d',dataIndex:'appliedUnits'},
          {title:'\u8d26\u5355\u5217\u793a\u8d39\u7528',dataIndex:'feeMinor',render:formatMinor},{title:'\u6700\u7ec8\u786e\u8ba4\u65e5\u671f',dataIndex:'confirmedAt',render:(v:string)=>v.slice(0,10)},
          {title:'\u5173\u8054\u4f9d\u636e',dataIndex:'status',render:(v:string)=>v==='products_matched'?'\u8ba2\u5355\u53f7\u3001\u91d1\u989d\u548c\u65e5\u671f\u4e00\u81f4':'\u5f85\u6838\u5bf9'},
        ]}/>
      </> },
      { key: 'overview', label: '账户与分类统计', children: <>
        <Space wrap style={{ margin: '16px 0' }}>{Object.entries(view.currencyTotals).map(([currency, totals]: any) => <Tag key={currency}>{currency} 消费 {formatMinor(totals.consumptionMinor)} · 收入 {formatMinor(totals.incomeMinor)} · 现金流 {formatMinor(totals.netCashFlowMinor)}</Tag>)}</Space>
        <Table rowKey="id" dataSource={accountRows} pagination={false} scroll={{ x: 750 }} columns={[
          { title: '账户', dataIndex: 'label' }, { title: '类别', dataIndex: 'type', render: (v: string) => TYPES[v] || v }, { title: '币种', dataIndex: 'currency' },
          { title: '支出（扣除退款）', dataIndex: 'consumptionMinor', render: formatMinor }, { title: '收入', dataIndex: 'incomeMinor', render: formatMinor }, { title: '余额', dataIndex: 'balanceMinor', render: formatMinor },
          { title: '余额依据', render:(_:any,a:any)=>a.balanceAnchor?<span>{a.balanceStatus==='derived'?'流水推算':'余额校准'} · {dayjs(a.balanceAnchor.asOf).format('YYYY-MM-DD HH:mm')}</span>:'待核对' },
          { title: '单独查看', render:(_:any,a:any)=><Button size="small" onClick={()=>setSelected([a.id])}>仅看此账户</Button> },
          { title: '校准余额', render: (_: any, a: any) => <Button size="small" onClick={() => Modal.confirm({ title: `${a.label} 余额校准`, content: <Form id="finance-balance" layout="vertical"><Input name="balance" placeholder="余额（可负数，如 -1000.00）" /><Input name="asOf" type="datetime-local" defaultValue={dayjs().format('YYYY-MM-DDTHH:mm')} /></Form>, onOk: async () => {
            const el = document.getElementById('finance-balance') as HTMLFormElement, f = new FormData(el), value = String(f.get('balance') || '');
            if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('请输入最多两位小数的金额');
            const result = await run(() => client.createBalanceSnapshot({ expectedRevision: ledger.revision, snapshot: { balanceConvention:'signed', financialAccountId: a.id, currency: a.currency, balanceMinor: parseMoney(value), asOf: new Date(String(f.get('asOf'))).toISOString(), source: 'manual' } }));
            if (!result) throw new Error('余额未提交成功，请重试');
          } })}>校准</Button> },
        ]} />
        <Table rowKey="id" dataSource={categoryRows} columns={[{ title: '支出类别', dataIndex: 'category' }, { title: '币种', dataIndex: 'currency' }, { title: '本期', dataIndex: 'amount', render: formatMinor }, { title: '上期同长度期间', dataIndex: 'previous', render: formatMinor }]} />
        <Table rowKey="currency" dataSource={Object.entries(view.fundingBreakdown || {}).map(([currency, amounts]: any) => ({ currency, ...amounts }))} scroll={{ x: 850 }} pagination={false} columns={[{ title: '币种', dataIndex: 'currency' }, { title: '现金类消费', dataIndex: 'cashFundedConsumptionMinor', render: formatMinor }, { title: '信用类消费', dataIndex: 'creditFundedConsumptionMinor', render: formatMinor }, { title: '还款本金', dataIndex: 'loanPrincipalPaidMinor', render: formatMinor }, { title: '利息', dataIndex: 'interestPaidMinor', render: formatMinor }, { title: '费用', dataIndex: 'feesPaidMinor', render: formatMinor }, { title: '待拆分还款', dataIndex: 'unsplitDebtPaymentMinor', render: formatMinor }]} />
        <Table rowKey="id" dataSource={fundingRows} scroll={{ x: 800 }} columns={[{ title: '日期', dataIndex: 'date' }, { title: '用途', dataIndex: 'kind', render: (v: string) => KINDS[v] }, {title:'统计状态',render:(_:any,t:any)=>t.statisticsExclusions?.length?'与信用卡账单疑似重叠，暂不重复计入':'已计入适用统计'}, { title: '资金账户类型', dataIndex: 'funding' }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '还款本金', dataIndex: 'principalMinor', render: formatMinor }, { title: '利息', dataIndex: 'interestMinor', render: formatMinor }, { title: '费用', dataIndex: 'feeMinor', render: formatMinor }]} />
      </> },
      { key: 'transactions', label: '交易与关联复核', children: <>
        <Alert type="warning" message={`有 ${view.unresolvedAssociations.length} 项关联或分类待复核；无明确证据的同额交易不会自动合并。`} />
        <Table rowKey="id" dataSource={view.transactions} expandable={{ expandedRowRender: (t: any) => <div>{t.sources.map((o: any) => <div key={o.id}><p>{observationLabel(o)}</p><p>关联参考：{o.relatedReference || '无'} · 状态：{o.status} · 原始分类：{o.category || '无'}</p><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(o.rawFields, null, 2)}</pre><Button onClick={() => Modal.confirm({ title: '校正类别与贷款拆分', content: <Form id="finance-annotation" layout="vertical"><Input name="category" placeholder="支出类别" defaultValue={t.category} /><select name="kind" defaultValue={t.kind}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Input name="principal" placeholder="还款本金（元；留空表示未知）" defaultValue={t.principalMinor == null ? '' : formatMinor(t.principalMinor)} /><Input name="interest" placeholder="利息（元）" defaultValue={t.interestMinor == null ? '' : formatMinor(t.interestMinor)} /><Input name="fee" placeholder="费用（元）" defaultValue={t.feeMinor == null ? '' : formatMinor(t.feeMinor)} /></Form>, onOk: async () => {
          const el = document.getElementById('finance-annotation') as HTMLFormElement, f = new FormData(el), patch: any = { category: String(f.get('category') || ''), kind: String(f.get('kind')) };
          for (const [field, name] of [['principalMinor', 'principal'], ['interestMinor', 'interest'], ['feeMinor', 'fee']]) { const value = String(f.get(name) || ''); if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('本金、利息与费用请填非负金额，最多两位小数'); patch[field] = value ? parseMoney(value) : null; }
          const result = await run(() => client.annotateObservation(o.id, { patch, expectedRevision: ledger.revision })); if (!result) throw new Error('校正未提交成功，请重试');
        } })}>校正统计分类/还款拆分</Button></div>)}</div> }} scroll={{ x: 900 }} columns={[{ title: '日期', dataIndex: 'date' }, { title: '类型', dataIndex: 'kind', render: (v: string) => KINDS[v] }, { title: '说明', dataIndex: 'description' }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '原始记录', dataIndex: 'observationIds', render: (v: string[]) => v.length }, { title: '来源', dataIndex: 'sources', render: (v: any[]) => [...new Set(v.map(s => s.provider))].join(' / ') }]} />
        <Table rowKey={(_: any, i?: number) => String(i)} dataSource={view.unresolvedAssociations} columns={[{ title: '待复核原因', dataIndex: 'reason', render:(reason:string)=>({unidentified_fund_conversion:'转换凭证未提供基金名称或代码',unresolved_product_account:'关联产品账户待确认',unresolved_account_movement:'账户划转方向或对方账户待确认',unresolved_funding_account:'付款账户待确认',unsplit_debt_payment:'还款本金、利息与费用待拆分',unknown_kind:'交易类别待确认'} as Record<string,string>)[reason]||reason }, { title: '原记录与候选证据', render: (_: any, issue: any) => <div>{[issue.observationId, ...(issue.candidateObservationIds || [])].filter(Boolean).map((id: string) => <p key={id}>{observationLabel(ledger.observations.find((o: any) => o.id === id) || { id, date: '', provider: '', amountMinor: '0' })}</p>)}</div> }]} />
        <Space wrap><Select mode="multiple" maxCount={2} style={{ minWidth: 380 }} placeholder="选择两条原始记录" value={linkIds} onChange={setLinkIds} options={ledger.observations.map((o: any) => ({ value: o.id, label: observationLabel(o) }))} />
          <Select value={linkType} onChange={setLinkType} options={[{ value: 'duplicate', label: '同一笔交易' }, { value: 'transfer', label: '转账双腿' }, { value: 'refund', label: '退款与原消费' }, { value: 'distinct', label: '明确不同交易' }]} />
          <Button disabled={linkIds.length !== 2 || busy} onClick={() => void run(() => client.createLink({ expectedRevision: ledger.revision, link: { type: linkType, observationIds: linkIds } }))}>确认关联</Button>
        </Space>
        <Table rowKey="id" dataSource={ledger.links.filter((l: any) => l.status !== 'deleted')} columns={[{ title: '关联方式', dataIndex: 'type' }, { title: '记录', dataIndex: 'observationIds', render: (ids: string[]) => ids.join(' / ') }, { title: '操作', render: (_: any, l: any) => <Button onClick={() => void run(() => client.deleteLink(l.id, { expectedRevision: ledger.revision }))}>解除关联</Button> }]} />
      </> },
      { key: 'funds', label: '基金交易确认', children: <>
        <Alert type="info" showIcon message="支付流水记录资金划转；基金确认凭证补充本笔份额与手续费，不再扣一遍买入金额。" description="下表显示所选期间的交易确认明细，不代表当前持仓或每日收益；凭证缺少的基金信息、净值和估值保持未知。" />
        <Space wrap style={{margin:'16px 0'}}><span>确认记录 {(view.investmentTrades||[]).length} 条</span><span>本期确认手续费 {formatMinor((view.investmentTrades||[]).reduce((sum:bigint,t:any)=>sum+BigInt(t.feeMinor),0n).toString())} 元</span></Space>
        <Table rowKey="id" dataSource={view.investmentTrades||[]} scroll={{x:1050}} expandable={{expandedRowRender:(t:any)=><div>原始订单：{t.orderId}<br/>原始交易类型：{t.sourceTradeType}<br/>申请份额：{t.appliedUnits??'未提供'}<br/>组合基金：{t.combination??'未提供'}<br/>凭证页码：{t.sourcePages.join('–')}</div>}} columns={[
          {title:'交易日期',dataIndex:'date'},{title:'基金代码',dataIndex:'fundCode',render:(v:any)=>v??'未提供'},{title:'基金名称',dataIndex:'fundName',render:(v:any)=>v??'未提供（转换记录）'},
          {title:'交易类型',dataIndex:'tradeType',render:(v:string)=>v==='buy'?'买入确认':'转换记录'},{title:'申请金额',dataIndex:'appliedAmountMinor',render:formatMinor},{title:'确认金额',dataIndex:'confirmedAmountMinor',render:(v:any)=>v==null?'未提供':formatMinor(v)},
          {title:'本笔确认份额',dataIndex:'confirmedUnits',render:(v:any)=>v??'未提供'},{title:'手续费',dataIndex:'feeMinor',render:formatMinor},{title:'确认日期',dataIndex:'confirmedAt',render:(v:string)=>v.slice(0,10)}
        ]}/>
      </> },
      { key: 'import', label: '账单与专用邮箱', children: <>
        <Space wrap><Select allowClear placeholder="自动按来源匹配账户（可更改）" options={accounts} value={importAccount} onChange={v => { fileSequence.current++; setImportAccount(v); setPreview(null); }} style={{ minWidth: 280 }} /><Button onClick={() => fileRef.current?.click()}>选择账单文件</Button><Button disabled={!file} onClick={() => setPasswordModal(true)}>输入此文件解压密码</Button><span>{file?.filename}</span>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.zip,.pdf,.html,.htm" hidden onChange={e => void chooseFile(e.target.files?.[0])} /><Button disabled={!file || busy} onClick={() => void doPreview()}>解析预览</Button></Space>
        <Input.TextArea rows={2} placeholder={'可选字段映射 JSON（未知表头时）：{"date":"交易日期","amount":"金额","direction":"借贷方向"}'} value={mapping} onChange={e => { fileSequence.current++; setMapping(e.target.value); setPreview(null); }} style={{ margin: '12px 0' }} />
        {preview?.accountResolution && <p>所属账户：{preview.accountResolution.account?.label || '请确认所属账户'}{preview.accountResolution.status==='create'?'（确认导入时自动创建）':preview.accountResolution.status==='matched'?'（已自动匹配）':'（无法唯一识别，请手动选择一次后重新预览）'}</p>}
        <BillRelatedAccounts items={preview?.relatedAccountResolutions} selected={relatedAccountIds} disabled={busy} onChange={(ids:any)=>{fileSequence.current++;setRelatedAccountIds(ids);setPreview(null);}}/>
        {preview && <><Alert type={preview.errors?.length ? 'error' : 'info'} message={`${preview.provider} · ${preview.records?.length || 0} 条；错误 ${preview.errors?.length || 0}，提示 ${preview.warnings?.length || 0}`} description={[...(preview.errors || []), ...(preview.warnings || [])].slice(0, 10).map((e: any) => `第${e.line || '?'}行：${e.message || e.code}`).join('；')} />
          <Table rowKey={(_: any, i?: number) => String(i)} dataSource={preview.records?.slice(0, 100)} columns={[{ title: '日期', dataIndex: 'date' }, { title: '类型', dataIndex: 'kind', render: (v: string) => KINDS[v] }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '说明', dataIndex: 'description' }]} />
          <Button type="primary" disabled={busy || !relatedAccountsReady(preview.relatedAccountResolutions) || !!preview.errors?.length || !preview.records?.length || !!preview.accountResolution&&!['matched','create'].includes(preview.accountResolution.status)} onClick={() => void run(async current => { await client.importFile(preview.reviewedInput, preview.reviewedKey); if (!current()) return; fileSequence.current++; setFile(null); setPreview(null); })}>确认整批导入</Button></>}
        <Card title="账单收集邮箱" style={{ marginTop: 16 }}><Space wrap><Button loading={mailLoading} disabled={mailLoading} onClick={() => { void loadMailbox(); window.dispatchEvent?.(new Event('bill-mailbox-open')); }}>查看邮箱</Button><span style={{ overflowWrap:'anywhere' }}>{mailStatus?.address}</span><Button onClick={() => window.dispatchEvent?.(new Event('bill-mailbox-open'))}>检查账单附件</Button></Space><p>检测结果、邮件计数、逐份密码和批量导入均在独立窗口显示，点击以上任一入口会重新检查收件箱。</p>{mailFailure && <Alert type="warning" showIcon message={mailFailure} />}</Card>
      </> },
    ]} />
    <Modal title="账单解压密码" open={passwordModal} onCancel={() => setPasswordModal(false)} onOk={() => setPasswordModal(false)}>
      <p style={{overflowWrap:'anywhere'}}>文件：{file?.filename}</p><p>此密码仅用于上面这份本地账单；输入后重新解析预览。</p><Input.Password aria-label="本地账单解压密码" autoComplete="new-password" maxLength={256} value={file?.password||''} onChange={e => { fileSequence.current++; setPreview(null); setFile((old:any) => old ? {...old,password:e.target.value} : old); }} />
    </Modal>
    <Modal title="新增金融账户" open={accountModal} confirmLoading={busy} onCancel={() => setAccountModal(false)} onOk={() => void run(async current => { const a = await form.validateFields(); if (!current()) return; await client.createAccount({ account: { ...a, balanceConvention:'signed', openingBalanceMinor: null, openingDate: null, status: 'active' }, expectedRevision: ledger.revision }); if (!current()) return; setAccountModal(false); form.resetFields(); })}>
      <Form form={form} layout="vertical" initialValues={{ type: 'bank', currency: 'CNY' }}><Form.Item name="label" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="type" label="类别"><Select options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="provider" label="银行/平台" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="maskedIdentifier" label="标识（只填尾号或脱敏值）"><Input /></Form.Item><Form.Item name="currency" label="币种" rules={[{ pattern: /^[A-Z]{3}$/, message: '请填 CNY、USD 等三字母代码' }]}><Input /></Form.Item></Form>
    </Modal>
  </Card>;
}
