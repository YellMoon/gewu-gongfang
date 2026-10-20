import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, DatePicker, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import dayjs from 'dayjs';
import './PersonalFinancePanel.css';
// @ts-ignore Presentation helpers do not change ledger decisions.
import { PROVIDERS, ISSUE_LABELS, accountLabel, accountGroup, evidenceLabel, trendGranularity, statisticsState, boundedObservationOptions } from './personalFinancePresentation';
import MortgageAccounts from './MortgageAccounts';
import BillRelatedAccounts,{relatedAccountsReady,relatedAccountSnapshot} from './BillRelatedAccounts';
// @ts-ignore Shared integer ledger is used by cloud and both clients.
import { buildFinanceView } from '../../shared/personal-finance/ledger.js';
// @ts-ignore Shared asset register uses immutable statement evidence.
import { buildAssetRegister } from '../../shared/personal-finance/assetRegister.js';
// @ts-ignore Shared exact-integer aggregations.
import { buildTrend } from '../../shared/personal-finance/accountAnalytics.js';
import { createPersonalFinanceClient, formatMinor as baseFormatMinor, parseMoney } from '../services/personalFinanceClient.mjs';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
const formatMinor=(value:any)=>baseFormatMinor(value).replace(/^-/, '\u2212');
const TYPES: Record<string, string> = { cash: '现金', bank: '银行账户', savings: '储蓄', debit_card: '借记卡', credit_card: '信用卡', wallet: '电子钱包', loan: '贷款', investment: '证券与基金', insurance: '保险', receivable: '应收款', property: '不动产', precious_metal: '贵金属', retirement: '养老金', other: '其他资产' };
const KINDS: Record<string, string> = { expense: '消费', income: '收入', transfer: '转账', refund: '退款', loan_drawdown: '借款到账', debt_payment: '还款/月供', interest: '利息', fee: '手续费', unknown: '待分类' };
const client = createPersonalFinanceClient();
const empty = { accounts: [], observations: [], links: [], balanceSnapshots: [], imports: [], legacyRecords: [], revision: '0' };
export function FinanceTrend({rows,currency,onSelect}:{rows:any[];currency:string;onSelect?:(date:string)=>void}) {
  if(!rows.length)return <p>所选期间暂无账单记录。</p>;
  const values=rows.flatMap(r=>[BigInt(r.values[currency]?.incomeMinor||'0'),BigInt(r.values[currency]?.consumptionMinor||'0')]);
  const low=values.reduce((a,b)=>a<b?a:b,0n),high=values.reduce((a,b)=>a>b?a:b,0n),range=high-low||1n;
  // Only the final pixel ratio uses floating point; monetary totals stay exact.
  const y=(v:string)=>220-Number((BigInt(v)-low)*18000n/range)/100;
  const x=(i:number)=>rows.length===1?465:90+i*760/Math.max(rows.length-1,1);
  const series=[{key:'incomeMinor',label:'\u6536\u5165',color:'#1677ff'},{key:'consumptionMinor',label:'\u652f\u51fa\uff08\u6263\u9664\u9000\u6b3e\uff09',color:'#c7511f'}];
  return <figure>
    <figcaption>{currency} {'\u6536\u652f\u8d8b\u52bf'} <span style={{color:'#1677ff'}}>{'\u2501'} {'\u6536\u5165'}</span> <span style={{color:'#c7511f'}}>{'\u2504'} {'\u652f\u51fa'}</span></figcaption>
    <svg role="img" aria-label={currency+'\u6536\u5165\u4e0e\u652f\u51fa\u8d8b\u52bf'} viewBox="0 0 920 270" style={{width:'100%',minHeight:190,maxHeight:340,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
      {[0,1,2,3,4].map(i=>{const amount=low+range*BigInt(i)/4n;return <g key={i}><line x1="90" x2="880" y1={y(amount.toString())} y2={y(amount.toString())} stroke="#e5e7eb"/><text x="82" y={y(amount.toString())+4} textAnchor="end" fontSize="17">{formatMinor(amount.toString())}</text></g>;})}
      <line x1="90" x2="880" y1={y('0')} y2={y('0')} stroke="#8c8c8c"/>
      {series.map(s=><g key={s.key}><polyline fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.key==='consumptionMinor'?'7 4':undefined} points={rows.map((r,i)=>x(i)+','+y(r.values[currency]?.[s.key]||'0')).join(' ')}/>{rows.map((r,i)=><circle key={r.date} cx={x(i)} cy={y(r.values[currency]?.[s.key]||'0')} r={rows.length>180?1.5:3} fill={s.color}><title>{r.date+' '+s.label+' '+formatMinor(r.values[currency]?.[s.key]||'0')}</title></circle>)}</g>)}
      {rows.map((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/6))===0?<text key={r.date} x={x(i)} y="250" textAnchor="middle" fontSize="17">{r.date}</text>:null)}
    </svg>
    {rows.length===1&&<p className="finance-muted">当前只有一个统计期间，可改用按日或按周查看变化。</p>}
    <details><summary>查看趋势数据 / 按期间查看流水</summary><Table size="small" rowKey="date" dataSource={rows.map(r=>({date:r.date,...r.values[currency]}))} pagination={{pageSize:12}} columns={[{title:'日期',dataIndex:'date',render:(v:string)=><Button type="link" size="small" onClick={()=>onSelect?.(v)}>{v}</Button>},{title:'\u6536\u5165',dataIndex:'incomeMinor',render:formatMinor},{title:'\u652f\u51fa',dataIndex:'consumptionMinor',render:formatMinor}]}/></details>
  </figure>;
}
export default function PersonalFinancePanel() {
  const [ledger, setLedger] = useState<any>(empty), [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<any>([dayjs().startOf('month'), dayjs().endOf('day')]);
  const [granularity, setGranularity] = useState('auto');
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [accountModal, setAccountModal] = useState(false), [form] = Form.useForm();
  const [importAccount, setImportAccount] = useState<string>(), [file, setFile] = useState<any>(), [preview, setPreview] = useState<any>();
  const [relatedAccountIds,setRelatedAccountIds] = useState<any>({});
  const [bankSource,setBankSource]=useState('auto');
  const [mapping, setMapping] = useState(''), [mailStatus, setMailStatus] = useState<any>();
  const [mailLoading, setMailLoading] = useState(true), [mailFailure, setMailFailure] = useState('');
  const [passwordModal,setPasswordModal] = useState(false);
  const [linkIds, setLinkIds] = useState<string[]>([]), [linkType, setLinkType] = useState('duplicate');
  const [reviewGroup,setReviewGroup]=useState<string>();
  const [activeTab,setActiveTab]=useState('overview'),[currency,setCurrency]=useState('CNY');
  const [search,setSearch]=useState(''),[transactionFilter,setTransactionFilter]=useState('all'),[categoryFilter,setCategoryFilter]=useState('');
  const [linkSearch,setLinkSearch]=useState(''),[accountDetail,setAccountDetail]=useState<string>(),[categoryDisplay,setCategoryDisplay]=useState('chart');
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
  const accountMap = useMemo(()=>new Map<string,any>(ledger.accounts.map((a:any)=>[a.id,a])),[ledger.accounts]);
  const observationMap = useMemo(()=>new Map<string,any>(ledger.observations.map((o:any)=>[o.id,o])),[ledger.observations]);
  const accounts = ledger.accounts.map((a: any) => ({ value: a.id, label: `${a.label} · ${a.currency} · ${TYPES[a.type] || a.type}` }));
  const options = () => {
    const value=mapping.trim()?JSON.parse(mapping):{};
    if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('INVALID_MAPPING');
    if(bankSource==='spdb')value.provider='spdb';else if(value.provider==='spdb')delete value.provider;
    return Object.keys(value).length?value:undefined;
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
    catch (e: any) { if (mounted.current && scope() === owner && n === fileSequence.current) message.error(`无法解析：${e.code==='BILL_BANK_SOURCE_REQUIRED'?'请在“账单来源”中选择浦发银行 Excel 明细':e.code || '请检查字段映射'}`); }
    finally { if (mounted.current && scope() === owner) setBusy(false); }
  };
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
  const observationLabel = (o: any) => `${o.date} ${accountLabel(accountMap.get(o.financialAccountId)) || o.financialAccountId} ${o.provider} ${o.currency || ''} ${formatMinor(o.amountMinor)} ${o.description} · 交易号 ${o.sourceTransactionId || '无'} · 资金尾号 ${o.paymentAccountHint || '无'}`;
  const selectedCurrency=Object.keys(view.currencyTotals).includes(currency)?currency:Object.keys(view.currencyTotals)[0]||currency;
  const totals=view.currencyTotals[selectedCurrency]||{incomeMinor:'0',consumptionMinor:'0'},balances=view.portfolioBalances[selectedCurrency];
  const accountRows=useMemo(()=>assetRegister.accounts.filter((a:any)=>(!selected.length||selected.includes(a.id))&&a.currency===selectedCurrency).map((a:any)=>({...a,...view.accountStats[a.id],group:accountGroup(a)})).sort((a:any,b:any)=>a.group.localeCompare(b.group,'zh-CN')||accountLabel(a).localeCompare(accountLabel(b),'zh-CN')),[assetRegister,selected,selectedCurrency,view.accountStats]);
  const dateBounds=useMemo(()=>view.transactions.reduce((b:any,t:any)=>({start:b.start&&b.start<t.date?b.start:t.date,end:b.end&&b.end>t.date?b.end:t.date}),{start:'',end:''}),[view.transactions]);
  const startDate=period?.[0]?.format('YYYY-MM-DD')||dateBounds.start,endDate=period?.[1]?.format('YYYY-MM-DD')||dateBounds.end;
  const effectiveGranularity=trendGranularity(startDate,endDate,granularity);
  const trend=useMemo(()=>buildTrend(view.transactions,{startDate,endDate,granularity:effectiveGranularity,currencies:[selectedCurrency]}),[view.transactions,startDate,endDate,effectiveGranularity,selectedCurrency]);
  const issueReasons=useMemo(()=>{const result=new Map<string,string[]>();for(const issue of view.unresolvedAssociations)for(const id of [issue.observationId,...(issue.observationIds||[])].filter(Boolean))result.set(id,[...(result.get(id)||[]),issue.reason]);return result;},[view.unresolvedAssociations]);
  const reviewDetail=view.review.groups.find((g:any)=>g.id===reviewGroup);
  const reasonsFor=(t:any)=>[...new Set(t.observationIds.flatMap((id:string)=>issueReasons.get(id)||[]))];
  const transactionRows=useMemo(()=>{const needle=search.trim().toLowerCase();return view.transactions.filter((t:any)=>t.currency===selectedCurrency&&(!categoryFilter||t.category===categoryFilter)&&(transactionFilter==='all'||statisticsState(t,reasonsFor(t)).key===transactionFilter)&&(!needle||[t.date,t.description,t.counterparty,t.sourceTransactionId,...t.financialAccountIds.map((id:string)=>accountLabel(accountMap.get(id)))].some(v=>String(v||'').toLowerCase().includes(needle)))).sort((a:any,b:any)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));},[view.transactions,selectedCurrency,categoryFilter,transactionFilter,search,accountMap,issueReasons]);
  const selectedObservation=(o:any)=>!selected.length||selected.includes(o.financialAccountId)||(o.accountRelations||[]).some((r:any)=>selected.includes(r.financialAccountId));
  const productRows=useMemo(()=>assetRegister.products.filter((p:any)=>p.currency===selectedCurrency&&(!selected.length||selected.includes(p.financialAccountId)||p.sourceObservationIds.some((id:string)=>selectedObservation(observationMap.get(id)||{})))),[assetRegister,selected,selectedCurrency,observationMap]);
  const conversionRows=assetRegister.conversions.filter((c:any)=>{const o=observationMap.get(c.id);return o&&o.currency===selectedCurrency&&selectedObservation(o)&&(!startDate||o.date>=startDate)&&(!endDate||o.date<=endDate);});
  const investmentRows=(view.investmentTrades||[]).filter((t:any)=>{const o=observationMap.get(t.id);return !o||o.currency===selectedCurrency;});
  const categories=categoryRows.filter((r:any)=>r.currency===selectedCurrency).sort((a:any,b:any)=>BigInt(a.amount)===BigInt(b.amount)?0:BigInt(a.amount)>BigInt(b.amount)?-1:1);
  const categoryMax=categories.reduce((m:bigint,r:any)=>{const v=BigInt(r.amount);return (v<0n?-v:v)>m?(v<0n?-v:v):m;},1n);
  const detailAccount=assetRegister.accounts.find((a:any)=>a.id===accountDetail);
  const associationOptions=useMemo(()=>boundedObservationOptions(ledger.observations,linkSearch,linkIds).map((o:any)=>({value:o.id,label:observationLabel(o)})),[ledger.observations,linkSearch,linkIds,accountMap]);
  const openTransactions=(category='',filter='all')=>{setCategoryFilter(category);setTransactionFilter(filter);setSearch('');setActiveTab('transactions');};
  const showPeriodTransactions=(date:string)=>{const from=dayjs(date),to=effectiveGranularity==='month'?from.endOf('month'):effectiveGranularity==='week'?from.add(6,'day'):from;setPeriod([from,to.isAfter(dayjs())?dayjs():to]);openTransactions();};
  const renameAccount=(a:any)=>Modal.confirm({title:'修改账户名称',content:<Input id="asset-account-label" defaultValue={a.label} maxLength={128}/>,onOk:async()=>{const label=(document.getElementById('asset-account-label') as HTMLInputElement).value.trim();if(!label)throw new Error('请填写名称');const saved=await run(()=>client.updateAccount(a.id,{expectedRevision:ledger.revision,patch:{label}}));if(!saved)throw new Error('名称未保存');}});
  const accountEffects=(t:any)=>Object.keys(t.balanceEffects||{}).length?<div>{Object.entries(t.balanceEffects).map(([id,value]:any)=><div key={id}>{accountLabel(accountMap.get(id))} <span className="finance-number">{BigInt(value)>0n?'+':''}{formatMinor(value)}</span></div>)}</div>:<span className="finance-muted">{t.coveredEffects?.length?'账户账单已记录变动，来源未重复入账':'暂无可确认账户变动'}</span>;
  return <Card className="personal-finance-panel" title={<div className="finance-toolbar"><span>资产统计</span><Space wrap><Button onClick={()=>window.dispatchEvent?.(new Event('bill-mailbox-open'))}>检查收件箱 / 逐份输入密码</Button><Button type="primary" onClick={()=>setActiveTab('import')}>导入文件</Button></Space></div>}>
    {failure&&<Alert type="warning" showIcon message="财务云端暂不可用" description={failure+'。请联网后刷新；尚未加载的数据不会按零汇总。'} />}
    <div className="finance-mail"><span>账单收件邮箱：</span>{mailLoading?<span>正在读取…</span>:mailStatus?.address?<><strong>{mailStatus.address}</strong><Button size="small" onClick={async()=>{try{await navigator.clipboard.writeText(mailStatus.address);message.success('收件邮箱已复制');}catch{message.warning('复制未完成，请选中邮箱地址复制');}}}>复制邮箱</Button></>:<span>{mailFailure||'暂未获取收件地址'}</span>}<Button type="link" size="small" onClick={()=>void loadMailbox()}>刷新邮箱</Button></div>
    <details className="finance-help"><summary>邮箱与统计使用说明</summary><p>在银行、支付宝或微信导出账单时填写上方收件地址，已有附件也可转发。登录且联网后自动检测一次；收件不会自动入账。点击“检查收件箱 / 逐份输入密码”，对照每份文件填写密码、预览后批量导入。</p><p>收支归到实际资金账户，微信与支付宝可作为来源渠道。转账、申购本金和还款本金不计收支，退款冲减支出；利息与费用另计。未知余额不按零汇总，币种分别统计。</p></details>
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={[{key:'overview',label:'总览与账户',children:null},{key:'transactions',label:'全部流水',children:null},{key:'funds',label:'理财产品',children:null},{key:'import',label:'账单与核对',children:null}]}/>
    <div className="finance-filters" aria-label="资产统计筛选">
      <Select className="finance-account-select" aria-label="统计账户" mode="multiple" showSearch optionFilterProp="label" allowClear maxTagCount="responsive" placeholder="全部账户（可多选）" style={{width:330,minWidth:250}} options={accounts} value={selected} onChange={setSelected}/><Button onClick={()=>setSelected([])}>全部账户</Button>
      <Select aria-label="统计币种" value={selectedCurrency} style={{width:90}} onChange={setCurrency} options={[...new Set<string>(ledger.accounts.map((a:any)=>a.currency))].map(v=>({value:v,label:v}))}/>
      <DatePicker.RangePicker aria-label="收支统计期间" placeholder={['开始日期','结束日期']} value={period} onChange={setPeriod} allowClear/><Button onClick={()=>setPeriod([dayjs().startOf('month'),dayjs()])}>本月至今天</Button><Button onClick={()=>setPeriod(null)}>全部日期</Button><Button disabled={busy} onClick={()=>void reload()}>刷新</Button>
    </div>
    <p className="finance-scope">{selected.length?'已选 '+selected.length+' 个账户':'全部账户'} · {selectedCurrency} · 收支期间：{startDate?startDate+' 至 '+endDate:'暂无记录'}。余额截至：{endDate||'最近已记录时点'}，仅按已有余额依据和已记录变动计算。</p>
    <section role="tabpanel" aria-label={({overview:'总览与账户',transactions:'全部流水',funds:'理财产品',import:'账单与核对'} as any)[activeTab]}>
    {activeTab==='overview'&&<>
      <div role="region" className="finance-summary" aria-label="账户收支与余额总览">
        <Card size="small"><span>{balances?.complete?'账户组合余额':'已知余额小计'}</span><div className="finance-value" data-testid="balance-total">{formatMinor(balances?.knownCount?balances.knownBalanceMinor:null)}</div><div className="finance-muted">{balances?.knownCount||0} 个有余额依据 · {balances?.unknownCount||0} 个待核对<br/>负数表示负债；仅有已出账应还款的账户不合计。</div></Card>
        <Card size="small"><span>期间支出（扣除退款）</span><div className="finance-value" data-testid="expense-total">{formatMinor(totals.consumptionMinor)}</div><div className="finance-muted">转账、申购与还款本金不计支出</div></Card>
        <Card size="small"><span>期间收入</span><div className="finance-value" data-testid="income-total">{formatMinor(totals.incomeMinor)}</div><div className="finance-muted">转入本金、赎回本金与借款不计收入</div></Card>
      </div>
      {view.review.transactionCount>0&&<Space wrap style={{marginBottom:16}}><Tag color="gold">{view.review.evidenceGroupCount} 组资料缺口</Tag><Tag>{view.review.softwareGroupCount} 组软件关联分析</Tag><span>同笔流水去重计数，按账户和原因归并</span><Button type="link" onClick={()=>setActiveTab('import')}>查看问题分组</Button></Space>}
      <div className="finance-charts">
        <section className="finance-chart"><div className="finance-toolbar"><h3>收入与支出趋势</h3><Select aria-label="趋势粒度" value={granularity} style={{width:115}} onChange={setGranularity} options={[{value:'auto',label:'自动粒度'},{value:'day',label:'按日'},{value:'week',label:'按周'},{value:'month',label:'按月'}]}/></div><FinanceTrend rows={trend} currency={selectedCurrency} onSelect={showPeriodTransactions}/><p className="finance-muted">{({day:'按日',week:'按周',month:'按月'} as any)[effectiveGranularity]} · 仅统计已导入记录；空白期间不代表账单已完整覆盖。</p></section>
        <section className="finance-chart"><div className="finance-toolbar"><h3>支出分类</h3><Button size="small" onClick={()=>setCategoryDisplay(categoryDisplay==='chart'?'table':'chart')}>{categoryDisplay==='chart'?'查看分类表':'查看分类图'}</Button></div><p className="finance-muted">净支出含退款冲减 · {selectedCurrency} · 图示金额最高的 7 类</p>{categoryDisplay==='chart'?<>{categories.slice(0,7).map((r:any)=><button type="button" key={r.id} className="finance-category-row" onClick={()=>openTransactions(r.category)} aria-label={'查看分类 '+r.category+' 流水'}><span className="finance-category-label"><span>{r.category==='Uncategorized'?'未分类':r.category}</span><span className="finance-number">{formatMinor(r.amount)}</span></span><span className="finance-category-track"><span className="finance-category-fill" style={{width:Number((BigInt(r.amount)<0n?-BigInt(r.amount):BigInt(r.amount))*10000n/categoryMax)/100+'%',background:BigInt(r.amount)<0n?'#1677ff':undefined}}/></span></button>)}{!categories.length&&<p>所选期间暂无支出分类。</p>}<Button type="link" size="small" onClick={()=>setCategoryDisplay('table')}>全部分类及上期对比</Button></>:<Table size="small" rowKey="id" dataSource={categories} pagination={{pageSize:5,showSizeChanger:false}} columns={[{title:'类别',dataIndex:'category',render:(v:string)=><Button type="link" size="small" onClick={()=>openTransactions(v)}>{v==='Uncategorized'?'未分类':v}</Button>},{title:'本期',dataIndex:'amount',align:'right',render:formatMinor},{title:'上期同长度',dataIndex:'previous',align:'right',render:formatMinor}]}/>}</section>
      </div>
      <div className="finance-toolbar"><h3 className="finance-section-title">实际资金账户</h3><Space wrap>{['储蓄账户','信用账户','理财账户'].map(group=><Button size="small" key={group} onClick={()=>setSelected(ledger.accounts.filter((a:any)=>accountGroup(a)===group).map((a:any)=>a.id))}>{group}</Button>)}<Button size="small" onClick={()=>setAccountModal(true)}>新增账户</Button></Space></div>
      <Table rowKey="id" aria-label="账户收支与余额" dataSource={accountRows} pagination={{pageSize:12,showSizeChanger:false}} scroll={{x:980}} columns={[
        {title:'账户',dataIndex:'label',width:240,render:(_:any,a:any)=><><Button type="link" size="small" onClick={()=>setAccountDetail(a.id)}>{accountLabel(a)}</Button><div className="finance-muted">{a.group} · {TYPES[a.type]||a.type}</div></>},
        {title:'期间收入',dataIndex:'incomeMinor',align:'right',render:formatMinor},{title:'期间支出',dataIndex:'consumptionMinor',align:'right',render:formatMinor},
        {title:'期末余额',dataIndex:'balanceMinor',align:'right',render:(v:any,a:any)=><span className="finance-number">{v==null?(a.estimatedBalanceMinor!=null?<>估算 {formatMinor(a.estimatedBalanceMinor)}<br/><small>非银行确认余额</small></>:a.verifiedBalance?.balanceKind==='billed_debt'?'总欠款待核对':'待核对'):formatMinor(v)}</span>},
        {title:'余额依据与时点',render:(_:any,a:any)=>a.balanceAnchor?<><div>{a.balanceStatus==='derived'?'余额依据与流水推算':evidenceLabel(a.balanceAnchor)}</div><div className="finance-muted">{dayjs(a.balanceAnchor.asOf).format('YYYY-MM-DD HH:mm')}</div></>:<span className="finance-muted">{a.verifiedBalance?.balanceKind==='billed_debt'?'仅有已出账应还款，详情可查':'尚无可用余额依据'}</span>},
        {title:'操作',render:(_:any,a:any)=><Space direction="vertical" size={0}><Button type="link" size="small" onClick={()=>{setSelected([a.id]);setAccountDetail(undefined);}}>仅看此账户</Button><Button type="link" size="small" onClick={()=>setAccountDetail(a.id)}>详情 / 核对余额</Button></Space>},
      ]}/>
      <MortgageAccounts key={scope()} models={view.mortgages} accounts={ledger.accounts} busy={busy} onSave={(account:any,existing:any)=>run(()=>existing?client.updateAccount(existing.id,{patch:{label:account.label,mortgage:account.mortgage},expectedRevision:ledger.revision}):client.createAccount({account,expectedRevision:ledger.revision}))}/>
      <details className="finance-help"><summary>消费资金与还款构成</summary><p>消费使用现金或信用资金；还款本金不计收支。未拆分还款不会被当作零费用。</p><Table rowKey="currency" size="small" dataSource={Object.entries(view.fundingBreakdown||{}).filter(([c])=>c===selectedCurrency).map(([c,v]:any)=>({currency:c,...v}))} scroll={{x:780}} pagination={false} columns={[{title:'币种',dataIndex:'currency'},{title:'现金类消费',dataIndex:'cashFundedConsumptionMinor',render:formatMinor},{title:'信用类消费',dataIndex:'creditFundedConsumptionMinor',render:formatMinor},{title:'还款本金',dataIndex:'loanPrincipalPaidMinor',render:formatMinor},{title:'利息',dataIndex:'interestPaidMinor',render:formatMinor},{title:'费用',dataIndex:'feesPaidMinor',render:formatMinor},{title:'待拆分还款',dataIndex:'unsplitDebtPaymentMinor',render:formatMinor}]}/></details>
    </>}
    {activeTab==='transactions'&&<>
      <Space wrap style={{marginBottom:16}}><Input aria-label="搜索流水" placeholder="搜索说明、对方、账户、日期或交易号" allowClear style={{width:300}} value={search} onChange={e=>setSearch(e.target.value)}/><Select aria-label="流水统计处理" value={transactionFilter} onChange={setTransactionFilter} style={{width:190}} options={[{value:'all',label:'全部记录（保留零金额）'},{value:'counted',label:'计入收入或支出'},{value:'neutral',label:'不计收支 / 确认凭证'},{value:'zero',label:'原账单零金额'},{value:'review',label:'待核对 / 待分类'},{value:'incomplete',label:'交易未完成或处理中'},{value:'outside',label:'不归入所选账户'}]}/>{categoryFilter&&<Tag closable onClose={()=>setCategoryFilter('')}>分类：{categoryFilter==='Uncategorized'?'未分类':categoryFilter}</Tag>}<span>{transactionRows.length} 条</span></Space>
      <p className="finance-muted">交易金额保留原账单数值；收入、支出是否统计与账户资金变动分别列示。展开可查看原始记录、校正分类或拆分还款。</p>
      <Table rowKey="id" dataSource={transactionRows} pagination={{pageSize:20,showSizeChanger:false}} rowClassName={(t:any)=>t.amountMinor==='0'?'finance-zero':''} expandable={{expandedRowRender:(t: any) => <div>{t.sources.map((o: any) => <div key={o.id}><p>{observationLabel(o)}</p><p>关联参考：{o.relatedReference || '无'} · 状态：{o.status} · 原始分类：{o.category || '无'}</p><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(o.rawFields, null, 2)}</pre><Button onClick={() => Modal.confirm({ title: '校正类别与贷款拆分', content: <Form id="finance-annotation" layout="vertical"><Input name="category" placeholder="支出类别" defaultValue={t.category} /><select name="kind" defaultValue={t.kind}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Input name="principal" placeholder="还款本金（元；留空表示未知）" defaultValue={t.principalMinor == null ? '' : formatMinor(t.principalMinor)} /><Input name="interest" placeholder="利息（元）" defaultValue={t.interestMinor == null ? '' : formatMinor(t.interestMinor)} /><Input name="fee" placeholder="费用（元）" defaultValue={t.feeMinor == null ? '' : formatMinor(t.feeMinor)} /></Form>, onOk: async () => {
          const el = document.getElementById('finance-annotation') as HTMLFormElement, f = new FormData(el), patch: any = { category: String(f.get('category') || ''), kind: String(f.get('kind')) };
          for (const [field, name] of [['principalMinor', 'principal'], ['interestMinor', 'interest'], ['feeMinor', 'fee']]) { const value = String(f.get(name) || ''); if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('本金、利息与费用请填非负金额，最多两位小数'); patch[field] = value ? parseMoney(value) : null; }
          const result = await run(() => client.annotateObservation(o.id, { patch, expectedRevision: ledger.revision })); if (!result) throw new Error('校正未提交成功，请重试');
        } })}>校正统计分类/还款拆分</Button></div>)}</div>}} scroll={{x:1150}} columns={[
        {title:'日期',dataIndex:'date',width:110},{title:'事项 / 对方',dataIndex:'description',width:240,render:(v:string,t:any)=><>{v}<div className="finance-muted">{KINDS[t.kind]||t.kind} · {t.counterparty}</div></>},
        {title:'交易金额',dataIndex:'amountMinor',align:'right',width:110,render:formatMinor},{title:'账户变动',render:(_:any,t:any)=>accountEffects(t),width:260},
        {title:'统计处理',render:(_:any,t:any)=>{const state=statisticsState(t,reasonsFor(t));return <div className="finance-stat"><Tag color={state.key==='review'?'gold':state.key==='counted'?'blue':undefined}>{state.label}</Tag><div className="finance-muted">{state.detail}</div>{state.key==='counted'&&<div className="finance-number">{BigInt(t.selectedIncomeMinor??t.incomeMinor)!==0n?'收入 '+formatMinor(t.selectedIncomeMinor??t.incomeMinor):'支出 '+formatMinor(t.selectedConsumptionMinor??t.consumptionMinor)}</div>}</div>;}},
        {title:'来源渠道',dataIndex:'sources',width:100,render:(sources:any[])=>[...new Set(sources.map(s=>PROVIDERS[s.provider]||s.provider))].join(' / ')},
      ]}/>
      <details className="finance-help"><summary>手动关联原始记录 / 查看已有关联</summary><p>按日期、说明、交易号或记录 ID 搜索；最多展示 40 个候选，已选记录始终保留。</p><Space wrap><Select aria-label="关联原始记录" mode="multiple" maxCount={2} showSearch filterOption={false} onSearch={setLinkSearch} style={{minWidth:380,maxWidth:'100%'}} placeholder="搜索并选择两条原始记录" value={linkIds} onChange={setLinkIds} options={associationOptions}/><Select value={linkType} onChange={setLinkType} options={[{value:'duplicate',label:'同一笔交易'},{value:'transfer',label:'转账双腿'},{value:'refund',label:'退款与原消费'},{value:'distinct',label:'明确不同交易'}]}/><Button disabled={linkIds.length!==2||busy} onClick={()=>void run(()=>client.createLink({expectedRevision:ledger.revision,link:{type:linkType,observationIds:linkIds}}))}>确认关联</Button></Space><Table rowKey="id" dataSource={ledger.links.filter((l:any)=>l.status!=='deleted')} pagination={{pageSize:8,showSizeChanger:false}} columns={[{title:'关联方式',dataIndex:'type',render:(v:string)=>({duplicate:'同一笔交易',transfer:'转账双腿',refund:'退款与原消费',distinct:'明确不同交易'} as any)[v]||v},{title:'记录',dataIndex:'observationIds',render:(ids:string[])=>ids.map(id=><p key={id}>{observationMap.has(id)?observationLabel(observationMap.get(id)):id}</p>)},{title:'操作',render:(_:any,l:any)=><Button onClick={()=>void run(()=>client.deleteLink(l.id,{expectedRevision:ledger.revision}))}>解除关联</Button>}]}/></details>
    </>}
    {activeTab==='funds'&&<>
      <Alert type="info" showIcon message="理财产品与交易确认" description="产品累计资料使用全部已导入账单；交易确认和转换使用所选期间与账户。累计买入份额不代表当前持仓，买入金额不代表市值；缺少净值与持仓证据时不展示估值或每日收益。"/><h3 className="finance-section-title">产品累计资料</h3>
              <Table rowKey="key" dataSource={productRows} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1150}} columns={[
          {title:'\u4ee3\u7801',dataIndex:'code'},{title:'\u57fa\u91d1\u4ea7\u54c1',dataIndex:'name'},{title:'\u4e70\u5165\u7b14\u6570',dataIndex:'count'},
          {title:'\u4e70\u5165\u786e\u8ba4\u91d1\u989d',dataIndex:'grossMinor',render:formatMinor},{title:'\u4e70\u5165\u624b\u7eed\u8d39',dataIndex:'feeMinor',render:formatMinor},{title:'\u7d2f\u8ba1\u4e70\u5165\u786e\u8ba4\u4efd\u989d',dataIndex:'boughtUnits'},
          {title:'\u8f6c\u6362\u8f6c\u51fa\u7533\u8bf7\u4efd\u989d',dataIndex:'conversionOutAppliedUnits'},{title:'\u8f6c\u6362\u8f6c\u5165\u91d1\u989d',dataIndex:'conversionInMinor',render:formatMinor},
          {title:'\u6838\u5bf9\u72b6\u6001',dataIndex:'status',render:(v:string)=>v==='conversion_units_pending'?'\u8f6c\u6362\u4efd\u989d\u5f85\u8865\u7b97':'\u4e70\u5165\u4efd\u989d\u5df2\u8bfb\u53d6\uff0c\u51c0\u503c\u5f85\u63a5\u5165'},
        ]}/>
        <p>{'\u7d2f\u8ba1\u4e70\u5165\u4efd\u989d\u4fdd\u7559\u539f\u59cb\u7cbe\u5ea6\uff0c\u4e0d\u76f4\u63a5\u5f53\u4f5c\u5f53\u524d\u6301\u4ed3\uff1b\u8f6c\u6362\u3001\u8d4e\u56de\u548c\u4f30\u503c\u7ed3\u679c\u4f1a\u5206\u522b\u6838\u5bf9\u3002'}</p>
        <Table rowKey="id" dataSource={conversionRows} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1000}} columns={[
          {title:'\u7533\u8bf7\u65f6\u95f4',dataIndex:'appliedAt',render:(v:string)=>dayjs(v).format('YYYY-MM-DD HH:mm')},
          {title:'\u8f6c\u51fa\u4ea7\u54c1',dataIndex:'sourceFundName',render:(v:string)=>v||'\u5f85\u5339\u914d'},{title:'\u8f6c\u5165\u4ea7\u54c1',dataIndex:'targetFundName',render:(v:string)=>v||'\u5f85\u5339\u914d'},
          {title:'\u8f6c\u6362\u91d1\u989d',dataIndex:'amountMinor',render:formatMinor},{title:'\u7533\u8bf7\u8f6c\u51fa\u4efd\u989d',dataIndex:'appliedUnits'},
          {title:'\u8d26\u5355\u5217\u793a\u8d39\u7528',dataIndex:'feeMinor',render:formatMinor},{title:'\u6700\u7ec8\u786e\u8ba4\u65e5\u671f',dataIndex:'confirmedAt',render:(v:string)=>v.slice(0,10)},
          {title:'\u5173\u8054\u4f9d\u636e',dataIndex:'status',render:(v:string)=>v==='products_matched'?'\u8ba2\u5355\u53f7\u3001\u91d1\u989d\u548c\u65e5\u671f\u4e00\u81f4':'\u5f85\u6838\u5bf9'},
        ]}/>

      <details className="finance-help" open><summary>所选期间基金交易确认</summary>
        <Alert type="info" showIcon message="支付流水记录资金划转；基金确认凭证补充本笔份额与手续费，不再扣一遍买入金额。" description="下表显示所选期间的交易确认明细，不代表当前持仓或每日收益；凭证缺少的基金信息、净值和估值保持未知。" />
        <Space wrap style={{margin:'16px 0'}}><span>确认记录 {(investmentRows).length} 条</span><span>本期确认手续费 {formatMinor((investmentRows).reduce((sum:bigint,t:any)=>sum+BigInt(t.feeMinor),0n).toString())} 元</span></Space>
        <Table rowKey="id" dataSource={investmentRows} scroll={{x:1050}} expandable={{expandedRowRender:(t:any)=><div>原始订单：{t.orderId}<br/>原始交易类型：{t.sourceTradeType}<br/>申请份额：{t.appliedUnits??'未提供'}<br/>组合基金：{t.combination??'未提供'}<br/>凭证页码：{t.sourcePages.join('–')}</div>}} columns={[
          {title:'交易日期',dataIndex:'date'},{title:'基金代码',dataIndex:'fundCode',render:(v:any)=>v??'未提供'},{title:'基金名称',dataIndex:'fundName',render:(v:any)=>v??'未提供（转换记录）'},
          {title:'交易类型',dataIndex:'tradeType',render:(v:string)=>v==='buy'?'买入确认':'转换记录'},{title:'申请金额',dataIndex:'appliedAmountMinor',render:formatMinor},{title:'确认金额',dataIndex:'confirmedAmountMinor',render:(v:any)=>v==null?'未提供':formatMinor(v)},
          {title:'本笔确认份额',dataIndex:'confirmedUnits',render:(v:any)=>v??'未提供'},{title:'手续费',dataIndex:'feeMinor',render:formatMinor},{title:'确认日期',dataIndex:'confirmedAt',render:(v:string)=>v.slice(0,10)}
        ]}/>
</details>
    </>}
    {activeTab==='import'&&<>
      <h3 className="finance-section-title">导入账单</h3><p className="finance-muted">上方账户与日期仅筛选统计，不改变待导入文件；所属账户按每份文件预览单独确认。</p>

        <Space wrap><Select allowClear placeholder="自动按来源匹配账户（可更改）" options={accounts} value={importAccount} onChange={v => { fileSequence.current++; setImportAccount(v); setPreview(null); }} style={{ minWidth: 280 }} /><Button onClick={() => fileRef.current?.click()}>选择账单文件</Button><Button disabled={!file} onClick={() => setPasswordModal(true)}>输入此文件解压密码</Button><span>{file?.filename}</span>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.zip,.pdf,.html,.htm" hidden onChange={e => void chooseFile(e.target.files?.[0])} /><Button disabled={!file || busy} onClick={() => void doPreview()}>解析预览</Button></Space>
        <Space wrap style={{marginTop:12}}><span>账单来源</span><Select aria-label="本地账单来源" value={bankSource} style={{width:230}} onChange={v=>{fileSequence.current++;setBankSource(v);setPreview(null);}} options={[{value:'auto',label:'自动识别'},{value:'spdb',label:'浦发银行 Excel 明细'}]}/></Space>
        <details className="finance-help"><summary>高级字段映射（未知表头时使用）</summary>        <Input.TextArea rows={2} placeholder={'可选字段映射 JSON（未知表头时）：{"date":"交易日期","amount":"金额","direction":"借贷方向"}'} value={mapping} onChange={e => { fileSequence.current++; setMapping(e.target.value); setPreview(null); }} style={{ margin: '12px 0' }} /></details>
        {preview?.accountResolution && <p>所属账户：{preview.accountResolution.account?.label || '请确认所属账户'}{preview.accountResolution.status==='create'?'（确认导入时自动创建）':preview.accountResolution.status==='matched'?'（已自动匹配）':'（无法唯一识别，请手动选择一次后重新预览）'}</p>}
        <BillRelatedAccounts items={preview?.relatedAccountResolutions} selected={relatedAccountIds} disabled={busy} onChange={(ids:any)=>{fileSequence.current++;setRelatedAccountIds(ids);setPreview(null);}}/>
        {preview && <><Alert type={preview.errors?.length ? 'error' : 'info'} message={`${preview.provider} · ${preview.records?.length || 0} 条；错误 ${preview.errors?.length || 0}，提示 ${preview.warnings?.length || 0}`} description={[...(preview.errors || []), ...(preview.warnings || [])].slice(0, 10).map((e: any) => `第${e.line || '?'}行：${e.message || e.code}`).join('；')} />
          <Table rowKey={(_: any, i?: number) => String(i)} dataSource={preview.records?.slice(0, 100)} columns={[{ title: '日期', dataIndex: 'date' }, { title: '类型', dataIndex: 'kind', render: (v: string) => KINDS[v] }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '说明', dataIndex: 'description' }]} />
          <Button type="primary" disabled={busy || !relatedAccountsReady(preview.relatedAccountResolutions) || !!preview.errors?.length || !preview.records?.length || !!preview.accountResolution&&!['matched','create'].includes(preview.accountResolution.status)} onClick={() => void run(async current => { await client.importFile(preview.reviewedInput, preview.reviewedKey); if (!current()) return; fileSequence.current++; setFile(null); setPreview(null); })}>确认整批导入</Button></>}
        <Card title="账单收集邮箱" style={{ marginTop: 16 }}><Space wrap><Button loading={mailLoading} disabled={mailLoading} onClick={() => { void loadMailbox(); window.dispatchEvent?.(new Event('bill-mailbox-open')); }}>查看邮箱</Button><span style={{ overflowWrap:'anywhere' }}>{mailStatus?.address}</span><Button onClick={() => window.dispatchEvent?.(new Event('bill-mailbox-open'))}>检查账单附件</Button></Space><p>检测结果、邮件计数、逐份密码和批量导入均在独立窗口显示，点击以上任一入口会重新检查收件箱。</p>{mailFailure && <Alert type="warning" showIcon message={mailFailure} />}</Card>

      <h3 className="finance-section-title">账户与余额核对</h3><Space wrap><Button disabled={busy||!assetRegister.proposals.accounts.length} onClick={()=>void run(()=>client.discoverAccounts({expectedRevision:ledger.revision}))}>根据账单补建账户{assetRegister.proposals.accounts.length?'（'+assetRegister.proposals.accounts.length+'）':''}</Button><Button onClick={()=>setActiveTab('overview')}>从账户表核对余额</Button><Button onClick={()=>setAccountModal(true)}>新增账户</Button></Space>
      {assetRegister.proposals.unresolved.length>0&&<Alert type="warning" style={{marginTop:12}} message={'有 '+assetRegister.proposals.unresolved.length+' 项银行卡身份待核对'} description={assetRegister.proposals.unresolved.map((v:any)=>(v.bank||'账户')+' '+(v.tail||'')+'：'+(v.reason==='bank_type_unknown'?'账单未说明储蓄卡或信用卡':'已有账户存在歧义')).join('；')}/>}
      <h3 className="finance-section-title">资料缺口与软件分析</h3>
      <Alert type="info" showIcon message="信用卡还款按账户间转账处理，无需逐笔拆本息" description="利息和费用以账单的独立记录为准。下表按账户和原因汇总缺失依据，不是要求你逐笔核对。疑似重复的平台记录仍暂按银行原账单统计，原始证据全部保留。"/>
      <Table rowKey="id" dataSource={view.review.groups} pagination={{pageSize:10,showSizeChanger:false}} columns={[
        {title:'处理类型',dataIndex:'owner',render:(v:string)=>v==='software'?'软件关联分析':'账单资料缺口'},
        {title:'原因',dataIndex:'reason',render:(v:string)=>ISSUE_LABELS[v]||'关联依据待补充'},
        {title:'来源账户',dataIndex:'financialAccountId',render:(id:string)=>accountLabel(accountMap.get(id))},
        {title:'涉及期间',render:(_:any,g:any)=>g.startDate?g.startDate+' 至 '+g.endDate:'余额依据'},
        {title:'流水数（去重）',dataIndex:'transactionCount'},
        {title:'依据',render:(_:any,g:any)=><Button onClick={()=>setReviewGroup(g.id)}>展开原始证据</Button>}
      ]}/>
      {view.information.length>0&&<p className="finance-muted">{view.information.length} 笔历史退款未找到原消费凭证，已正常冲减支出，不要求逐笔关联。出现多个原消费候选时仍列出冲突。</p>}
      <details className="finance-help"><summary>已导入账单记录（全部日期）</summary><Table rowKey="id" dataSource={ledger.imports} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:650}} columns={[{title:'文件',dataIndex:'filename'},{title:'所属账户',dataIndex:'financialAccountId',render:(id:string)=>accountLabel(accountMap.get(id))},{title:'导入时间',dataIndex:'createdAt',render:(v:string)=>v?dayjs(v).format('YYYY-MM-DD HH:mm'):'未提供'},{title:'原始记录数',dataIndex:'recordCount'}]}/></details>
    </>}
    </section>
    <Drawer title={detailAccount?accountLabel(detailAccount)+' · 账户详情':'账户详情'} open={!!detailAccount} onClose={()=>setAccountDetail(undefined)} width={560}>
      {detailAccount&&<div className="finance-account-detail"><Tag>{accountGroup(detailAccount)}</Tag><p>{detailAccount.currency} · {TYPES[detailAccount.type]||detailAccount.type} · 尾号 {detailAccount.maskedIdentifier||'未提供'}</p><dl><dt>所选期间期末余额</dt><dd>{view.accountStats[detailAccount.id]?.balanceMinor==null?'待核对':formatMinor(view.accountStats[detailAccount.id].balanceMinor)}</dd><dt>最近余额证据（保留原时点与口径）</dt><dd>{detailAccount.verifiedBalance?<><strong>{evidenceLabel(detailAccount.verifiedBalance)}：{formatMinor(detailAccount.verifiedBalance.balanceMinor)}</strong><br/>{dayjs(detailAccount.verifiedBalance.asOf).format('YYYY-MM-DD HH:mm')}{detailAccount.verifiedBalance.balanceKind==='billed_debt'&&<p>仅为该账期已出账应还款，不是当前全部欠款，不计入总余额。</p>}</>:'尚无可用余额证据'}</dd><dt>已导入来源与记录时间</dt><dd>{detailAccount.channels.map((v:string)=>PROVIDERS[v]||v).join(' / ')||'暂无来源'}<br/>{detailAccount.firstDate?detailAccount.firstDate+' 至 '+detailAccount.lastDate:'暂无记录'} · {detailAccount.evidenceCount} 条关联原始记录</dd></dl><Space wrap><Button onClick={()=>{setSelected([detailAccount.id]);setAccountDetail(undefined);openTransactions();}}>查看此账户流水</Button><Button type="primary" disabled={busy} onClick={()=>verifyBalance(detailAccount)}>核对余额</Button><Button disabled={busy} onClick={()=>renameAccount(detailAccount)}>改名</Button></Space></div>}
    </Drawer>
    <Drawer title="问题分组原始证据" open={!!reviewDetail} onClose={()=>setReviewGroup(undefined)} width={760}>
      {reviewDetail&&<><p>{accountLabel(accountMap.get(reviewDetail.financialAccountId))} · {ISSUE_LABELS[reviewDetail.reason]||reviewDetail.reason} · {reviewDetail.transactionCount} 笔流水</p><Table rowKey={(issue:any)=>JSON.stringify(issue)} dataSource={reviewDetail.issues} pagination={{pageSize:10,showSizeChanger:false}} columns={[{title:'原记录与候选证据',render:(_:any,issue:any)=><div>{[issue.observationId,...(issue.candidateObservationIds||[])].filter(Boolean).slice(0,4).map((id:string)=><p key={id}>{observationMap.has(id)?observationLabel(observationMap.get(id)):id}</p>)}</div>},{title:'操作',render:(_:any,issue:any)=><Button onClick={()=>{setReviewGroup(undefined);openTransactions();const o=observationMap.get(issue.observationId);if(o)setSearch(o.sourceTransactionId||o.description);setLinkIds([issue.observationId,...(issue.candidateObservationIds||[])].filter(Boolean).slice(0,2));}}>查看流水与关联</Button>}]}/></>}
    </Drawer>
    <Modal title="账单解压密码" open={passwordModal} onCancel={() => setPasswordModal(false)} onOk={() => setPasswordModal(false)}>
      <p style={{overflowWrap:'anywhere'}}>文件：{file?.filename}</p><p>此密码仅用于上面这份本地账单；输入后重新解析预览。</p><Input.Password aria-label="本地账单解压密码" autoComplete="new-password" maxLength={256} value={file?.password||''} onChange={e => { fileSequence.current++; setPreview(null); setFile((old:any) => old ? {...old,password:e.target.value} : old); }} />
    </Modal>
    <Modal title="新增金融账户" open={accountModal} confirmLoading={busy} onCancel={() => setAccountModal(false)} onOk={() => void run(async current => { const a = await form.validateFields(); if (!current()) return; await client.createAccount({ account: { ...a, balanceConvention:'signed', openingBalanceMinor: null, openingDate: null, status: 'active' }, expectedRevision: ledger.revision }); if (!current()) return; setAccountModal(false); form.resetFields(); })}>
      <Form form={form} layout="vertical" initialValues={{ type: 'bank', currency: 'CNY' }}><Form.Item name="label" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="type" label="类别"><Select options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="provider" label="银行/平台" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="maskedIdentifier" label="标识（只填尾号或脱敏值）"><Input /></Form.Item><Form.Item name="currency" label="币种" rules={[{ pattern: /^[A-Z]{3}$/, message: '请填 CNY、USD 等三字母代码' }]}><Input /></Form.Item></Form>
    </Modal>
  </Card>;
}
