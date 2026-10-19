import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import { Button, Checkbox, Input, Text, View } from '@tarojs/components';
import { personalFinanceApi } from '../utils/personalFinanceApi';
import { authSessionRuntime } from '../utils/authSession';
import { assertMiniappWriteAllowed } from '../utils/permission';
// @ts-ignore Integer ledger is identical to cloud and desktop.
import { buildFinanceView } from '../../../shared/personal-finance/ledger';
// @ts-ignore Shared integer series.
import { buildTrend } from '../../../shared/personal-finance/accountAnalytics';
const money = (v: any) => { if (v == null) return '未校准'; const s = String(v), negative = s.startsWith('-'), digits = s.replace('-', '').padStart(3, '0'); return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`; };
export default function PersonalFinanceSummary() {
  const [ledger, setLedger] = useState<any>(), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [importAccount, setImportAccount] = useState('');
  const [preview, setPreview] = useState<any>(), [file, setFile] = useState<any>(), [busy, setBusy] = useState(false);
  const [granularity,setGranularity] = useState('month');
  const visible = useRef(true), mounted = useRef(true), sequence = useRef(0), lock = useRef(false), operation = useRef(0), previousSession = useRef<any>(null);
  useEffect(() => {
    // UTF-8: The parent may mount this child after its page did-show has fired.
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; visible.current = false; sequence.current++; operation.current++; lock.current = false; };
  }, []);
  const refresh = async () => {
    const n = ++sequence.current, session = authSessionRuntime.capture();
    if (!previousSession.current || !authSessionRuntime.isSameSession(previousSession.current)) {
      operation.current++; lock.current = false;
      setSelected([]); setPreview(undefined); setFile(undefined); setImportAccount(''); setBusy(false); setStart(''); setEnd('');
    }
    previousSession.current = session; setLedger(undefined); setError('');
    try { const response = await personalFinanceApi.ledger(); if (visible.current && n === sequence.current && authSessionRuntime.isSameSession(session)) setLedger(response.ledger); }
    catch (e: any) { if (visible.current && n === sequence.current && authSessionRuntime.isSameSession(session)) setError(e.code || 'FINANCE_REQUEST_FAILED'); }
  };
  useDidShow(() => { visible.current = true; void refresh(); });
  useDidHide(() => { visible.current = false; sequence.current++; setLedger(undefined); });
  const view = ledger ? buildFinanceView(ledger, { ...(selected.length ? { accountIds: selected } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(start) ? { startDate: start } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(end) ? { endDate: end } : {}) }) : null;
  const trend = view ? buildTrend(view.transactions,{startDate:start||undefined,endDate:end||undefined,granularity,currencies:Object.keys(view.currencyTotals)}) : [];
  const readFile = async () => {
    if (lock.current || !importAccount) return;
    const session = authSessionRuntime.capture(), op = ++operation.current, accountId = importAccount;
    const current = () => mounted.current && op === operation.current && authSessionRuntime.isSameSession(session);
    lock.current = true; setBusy(true); setPreview(undefined); setFile(undefined);
    try {
      assertMiniappWriteAllowed('asset-import');
      const chosen = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['csv', 'txt', 'xls', 'xlsx', 'zip', 'pdf', 'html'] });
      if (!current()) return;
      const source = chosen.tempFiles?.[0]; if (!source?.path || source.size > 20 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
      const base64 = await new Promise<string>((resolve, reject) => Taro.getFileSystemManager().readFile({ filePath: source.path, encoding: 'base64', success: r => resolve(String(r.data)), fail: reject }));
      if (!current()) return;
      // File chooser can hide/show the page. The authenticated owner fence still applies.
      const input = { filename: source.name || 'bill.csv', base64, financialAccountId: accountId };
      const response = await personalFinanceApi.preview(input);
      if (!current()) return;
      setFile({ ...input, key: `finance-${Date.now()}-${Math.random().toString(36).slice(2)}` }); setPreview(response.preview);
    } catch (e: any) { if (current()) void Taro.showToast({ title: e.code || e.message || '解析失败', icon: 'none' }); }
    finally { if (mounted.current && op === operation.current) { lock.current = false; setBusy(false); } }
  };
  const submit = async () => {
    if (lock.current || !file || preview?.errors?.length) return;
    const session = authSessionRuntime.capture(), op = ++operation.current; lock.current = true; setBusy(true);
    const current = () => mounted.current && op === operation.current && authSessionRuntime.isSameSession(session);
    try {
      assertMiniappWriteAllowed('asset-import');
      const result = await Taro.showModal({ title: '确认整批导入', content: `${preview.records.length} 条账单将提交云端，原件加密保存。${preview.warnings?.length ? `有 ${preview.warnings.length} 项提示，请先核验预览。` : ''}` });
      if (!result.confirm || !current()) return;
      const { key, ...input } = file; await personalFinanceApi.import(input, key);
      if (!current()) return;
      setFile(undefined); setPreview(undefined); void Taro.showToast({ title: '云端已导入', icon: 'success' }); await refresh();
    } catch (e: any) { if (current()) void Taro.showToast({ title: e.code || '导入失败，可重试', icon: 'none' }); }
    finally { if (mounted.current && op === operation.current) { lock.current = false; setBusy(false); } }
  };
  return <View className='finance-ledger'>
    <Text className='finance-title'>金融账户与关联账单</Text>
    {error ? <Text>云端财务暂不可用：{error}</Text> : !ledger ? <Text>正在读取账户…</Text> : <>
      <Text>未勾选时统计全部账户；可勾选任意组合。收支归到实际资金账户，转账和还款本金不计收支。</Text><Button size="mini" onClick={()=>setSelected([])}>全部账户</Button>
      {ledger.accounts.map((a: any) => <View key={a.id} className='finance-account'><Checkbox value={a.id} checked={selected.includes(a.id)} onClick={() => setSelected(selected.includes(a.id) ? selected.filter(id => id !== a.id) : [...selected, a.id])} /><Text>{a.label} · {a.currency}　{!selected.length || selected.includes(a.id) ? '余额 '+money(view.accountStats[a.id]?.balanceMinor)+'　支出 '+money(view.accountStats[a.id]?.consumptionMinor)+'　收入 '+money(view.accountStats[a.id]?.incomeMinor) : '未选入统计'}</Text><Button size='mini' onClick={() => { setImportAccount(a.id); setPreview(undefined); setFile(undefined); }}>导入到账户</Button></View>)}
      {!ledger.accounts.length && <Text>暂无金融账户，请先在桌面端新增账户。</Text>}
      <View className='finance-dates'><Input type='text' placeholder='开始日期 YYYY-MM-DD' value={start} onInput={e => setStart(e.detail.value)} /><Input type='text' placeholder='结束日期 YYYY-MM-DD' value={end} onInput={e => setEnd(e.detail.value)} /></View>
      {Object.entries(view.currencyTotals).map(([currency, v]: any) => <View key={currency} className='finance-row'><Text>{currency} 消费 {money(v.consumptionMinor)}　收入 {money(v.incomeMinor)}　现金流 {money(v.netCashFlowMinor)}</Text></View>)}
      {view.transactions.some((t:any)=>t.statisticsExclusions?.length>0)&&<View><Text>{'部分平台记录可能与信用卡账单重叠，暂按银行账单计入收支。请在桌面端的交易与关联复核中确认重复或标记为不同交易；原始记录全部保留。'}</Text></View>}
      {Object.entries(view.portfolioBalances).map(([currency,b]:any)=><View key={currency}><Text>{currency} {b.complete?'组合余额':'已知余额小计'} {money(b.knownCount?b.knownBalanceMinor:null)}；{b.unknownCount} 个账户待核对，{b.derivedCount} 个余额由已记录流水推算。</Text></View>)}
      <Text>收入与支出趋势</Text><View>{[['day','按日'],['week','按周'],['month','按月']].map(([key,label])=><Button key={key} size="mini" type={granularity===key?'primary':'default'} onClick={()=>setGranularity(key)}>{label}</Button>)}</View>
      {Object.keys(view.currencyTotals).map(currency=>{
        const maximum=trend.reduce((m:any,r:any)=>['incomeMinor','consumptionMinor'].reduce((a,k)=>{const v=BigInt(r.values[currency]?.[k]||'0'),abs=v<0n?-v:v;return abs>a?abs:a;},m),1n);
        return <View key={currency} style={{maxHeight:'420px',overflowY:'auto'}}><Text>{currency}（蓝色为收入，橙色为支出；负支出表示退款）</Text>{trend.map((r:any)=><View key={r.date} style={{margin:'12px 0'}}><Text>{r.date}</Text>{[['incomeMinor','收入','#1677ff'],['consumptionMinor','支出','#c7511f']].map(([key,label,color])=>{const v=BigInt(r.values[currency]?.[key]||'0'),width=Number((v<0n?-v:v)*10000n/maximum)/100;return <View key={key}><Text>{label} {money(v)}</Text><View style={{height:'8px',background:color,width:width+'%',minWidth:v===0n?'0':'2px'}} /></View>;})}</View>)}</View>;
      })}
      {Object.entries(view.categoryTotals).flatMap(([currency, rows]: any) => Object.entries(rows).map(([category, amount]: any) => <View className='finance-row' key={currency + category}><Text>{category || '未分类'} {currency} {money(amount)}　上期 {money(view.comparison?.previous.categoryTotals?.[currency]?.[category] || '0')}</Text></View>))}
      {Object.entries(view.fundingBreakdown || {}).map(([currency, v]: any) => <View className='finance-row' key={currency}><Text>{currency} 现金类消费 {money(v.cashFundedConsumptionMinor)}　信用类消费 {money(v.creditFundedConsumptionMinor)}　还款本金 {money(v.loanPrincipalPaidMinor)}　利息 {money(v.interestPaidMinor)}　费用 {money(v.feesPaidMinor)}　待拆分还款 {money(v.unsplitDebtPaymentMinor)}</Text></View>)}
      <Text>待复核关联：{view.unresolvedAssociations.length} 项。余额依据与已记录流水可用于正推或反推；未知余额保持空缺，不同币种分别统计。</Text>
      <Button disabled={!importAccount || busy} onClick={() => void readFile()}>{busy ? '正在处理…' : `选择账单${importAccount ? '（' + ledger.accounts.find((a: any) => a.id === importAccount)?.label + '）' : ''}`}</Button>
      {preview && <View><Text>{preview.provider} · {preview.records?.length || 0} 条 · 错误 {preview.errors?.length || 0}</Text>{[...(preview.errors || []), ...(preview.warnings || [])].map((w: any, i: number) => <View key={i}><Text>{w.message || w.code}</Text></View>)}{preview.records?.slice(0, 12).map((r: any, i: number) => <View key={i}><Text>{r.date} {r.description} {r.currency} {money(r.amountMinor)} {r.status}</Text></View>)}<Button disabled={busy || !!preview.errors?.length || !preview.records?.length} onClick={() => void submit()}>确认整批导入</Button></View>}
    </>}
  </View>;
}
