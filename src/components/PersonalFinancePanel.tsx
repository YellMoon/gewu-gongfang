import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import dayjs from 'dayjs';
import BillRelatedAccounts,{relatedAccountsReady,relatedAccountSnapshot} from './BillRelatedAccounts';
// @ts-ignore Shared integer ledger is used by cloud and both clients.
import { buildFinanceView } from '../../shared/personal-finance/ledger.js';
import { createPersonalFinanceClient, formatMinor, parseMoney } from '../services/personalFinanceClient.mjs';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
const TYPES: Record<string, string> = { cash: '现金', bank: '银行账户', savings: '储蓄', debit_card: '借记卡', credit_card: '信用卡', wallet: '电子钱包', loan: '贷款', investment: '证券与基金', insurance: '保险', receivable: '应收款', property: '不动产', precious_metal: '贵金属', retirement: '养老金', other: '其他资产' };
const KINDS: Record<string, string> = { expense: '消费', income: '收入', transfer: '转账', refund: '退款', loan_drawdown: '借款到账', debt_payment: '还款/月供', interest: '利息', fee: '手续费', unknown: '待分类' };
const client = createPersonalFinanceClient();
const empty = { accounts: [], observations: [], links: [], balanceSnapshots: [], imports: [], legacyRecords: [], revision: '0' };
export default function PersonalFinancePanel() {
  const [ledger, setLedger] = useState<any>(empty), [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<any>([dayjs().startOf('month'), dayjs().endOf('month')]);
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
      <Select mode="multiple" placeholder="全部账户（可多选）" style={{ minWidth: 280 }} options={accounts} value={selected} onChange={setSelected} />
      <DatePicker.RangePicker value={period} onChange={setPeriod} allowClear />
      <Button onClick={() => void reload()} disabled={busy}>刷新</Button><Button onClick={() => setAccountModal(true)}>新增账户</Button>
    </Space>
    <Alert type="info" message="消费按关联交易统计；账户行展示各自关联消费，渠道与资金账户可关联同一笔，组合合计以去重总览为准。转账、贷款到账、还款本金分别列示。资产余额为正、负债欠款为负；余额需有期初值或账单余额校准，币种分别统计。" />
    <Tabs items={[
      { key: 'overview', label: '账户与分类统计', children: <>
        <Space wrap style={{ margin: '16px 0' }}>{Object.entries(view.currencyTotals).map(([currency, totals]: any) => <Tag key={currency}>{currency} 消费 {formatMinor(totals.consumptionMinor)} · 收入 {formatMinor(totals.incomeMinor)} · 现金流 {formatMinor(totals.netCashFlowMinor)}</Tag>)}</Space>
        <Table rowKey="id" dataSource={accountRows} pagination={false} scroll={{ x: 750 }} columns={[
          { title: '账户', dataIndex: 'label' }, { title: '类别', dataIndex: 'type', render: (v: string) => TYPES[v] || v }, { title: '币种', dataIndex: 'currency' },
          { title: '消费', dataIndex: 'consumptionMinor', render: formatMinor }, { title: '收入', dataIndex: 'incomeMinor', render: formatMinor }, { title: '余额', dataIndex: 'balanceMinor', render: formatMinor },
          { title: '校准余额', render: (_: any, a: any) => <Button size="small" onClick={() => Modal.confirm({ title: `${a.label} 余额校准`, content: <Form id="finance-balance" layout="vertical"><Input name="balance" placeholder="余额（可负数，如 -1000.00）" /><Input name="asOf" type="datetime-local" defaultValue={dayjs().format('YYYY-MM-DDTHH:mm')} /></Form>, onOk: async () => {
            const el = document.getElementById('finance-balance') as HTMLFormElement, f = new FormData(el), value = String(f.get('balance') || '');
            if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('请输入最多两位小数的金额');
            const result = await run(() => client.createBalanceSnapshot({ expectedRevision: ledger.revision, snapshot: { balanceConvention:'signed', financialAccountId: a.id, currency: a.currency, balanceMinor: parseMoney(value), asOf: new Date(String(f.get('asOf'))).toISOString(), source: 'manual' } }));
            if (!result) throw new Error('余额未提交成功，请重试');
          } })}>校准</Button> },
        ]} />
        <Table rowKey="id" dataSource={categoryRows} columns={[{ title: '支出类别', dataIndex: 'category' }, { title: '币种', dataIndex: 'currency' }, { title: '本期', dataIndex: 'amount', render: formatMinor }, { title: '上期同长度期间', dataIndex: 'previous', render: formatMinor }]} />
        <Table rowKey="currency" dataSource={Object.entries(view.fundingBreakdown || {}).map(([currency, amounts]: any) => ({ currency, ...amounts }))} scroll={{ x: 850 }} pagination={false} columns={[{ title: '币种', dataIndex: 'currency' }, { title: '现金类消费', dataIndex: 'cashFundedConsumptionMinor', render: formatMinor }, { title: '信用类消费', dataIndex: 'creditFundedConsumptionMinor', render: formatMinor }, { title: '还款本金', dataIndex: 'loanPrincipalPaidMinor', render: formatMinor }, { title: '利息', dataIndex: 'interestPaidMinor', render: formatMinor }, { title: '费用', dataIndex: 'feesPaidMinor', render: formatMinor }, { title: '待拆分还款', dataIndex: 'unsplitDebtPaymentMinor', render: formatMinor }]} />
        <Table rowKey="id" dataSource={fundingRows} scroll={{ x: 800 }} columns={[{ title: '日期', dataIndex: 'date' }, { title: '用途', dataIndex: 'kind', render: (v: string) => KINDS[v] }, { title: '资金账户类型', dataIndex: 'funding' }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '还款本金', dataIndex: 'principalMinor', render: formatMinor }, { title: '利息', dataIndex: 'interestMinor', render: formatMinor }, { title: '费用', dataIndex: 'feeMinor', render: formatMinor }]} />
      </> },
      { key: 'transactions', label: '交易与关联复核', children: <>
        <Alert type="warning" message={`有 ${view.unresolvedAssociations.length} 项关联或分类待复核；无明确证据的同额交易不会自动合并。`} />
        <Table rowKey="id" dataSource={view.transactions} expandable={{ expandedRowRender: (t: any) => <div>{t.sources.map((o: any) => <div key={o.id}><p>{observationLabel(o)}</p><p>关联参考：{o.relatedReference || '无'} · 状态：{o.status} · 原始分类：{o.category || '无'}</p><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(o.rawFields, null, 2)}</pre><Button onClick={() => Modal.confirm({ title: '校正类别与贷款拆分', content: <Form id="finance-annotation" layout="vertical"><Input name="category" placeholder="支出类别" defaultValue={t.category} /><select name="kind" defaultValue={t.kind}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Input name="principal" placeholder="还款本金（元；留空表示未知）" defaultValue={t.principalMinor == null ? '' : formatMinor(t.principalMinor)} /><Input name="interest" placeholder="利息（元）" defaultValue={t.interestMinor == null ? '' : formatMinor(t.interestMinor)} /><Input name="fee" placeholder="费用（元）" defaultValue={t.feeMinor == null ? '' : formatMinor(t.feeMinor)} /></Form>, onOk: async () => {
          const el = document.getElementById('finance-annotation') as HTMLFormElement, f = new FormData(el), patch: any = { category: String(f.get('category') || ''), kind: String(f.get('kind')) };
          for (const [field, name] of [['principalMinor', 'principal'], ['interestMinor', 'interest'], ['feeMinor', 'fee']]) { const value = String(f.get(name) || ''); if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('本金、利息与费用请填非负金额，最多两位小数'); patch[field] = value ? parseMoney(value) : null; }
          const result = await run(() => client.annotateObservation(o.id, { patch, expectedRevision: ledger.revision })); if (!result) throw new Error('校正未提交成功，请重试');
        } })}>校正统计分类/还款拆分</Button></div>)}</div> }} scroll={{ x: 900 }} columns={[{ title: '日期', dataIndex: 'date' }, { title: '类型', dataIndex: 'kind', render: (v: string) => KINDS[v] }, { title: '说明', dataIndex: 'description' }, { title: '币种', dataIndex: 'currency' }, { title: '金额', dataIndex: 'amountMinor', render: formatMinor }, { title: '原始记录', dataIndex: 'observationIds', render: (v: string[]) => v.length }, { title: '来源', dataIndex: 'sources', render: (v: any[]) => [...new Set(v.map(s => s.provider))].join(' / ') }]} />
        <Table rowKey={(_: any, i?: number) => String(i)} dataSource={view.unresolvedAssociations} columns={[{ title: '待复核原因', dataIndex: 'reason', render:(reason:string)=>({unresolved_product_account:'关联产品账户待确认',unresolved_account_movement:'账户划转方向或对方账户待确认',unresolved_funding_account:'付款账户待确认',unsplit_debt_payment:'还款本金、利息与费用待拆分',unknown_kind:'交易类别待确认'} as Record<string,string>)[reason]||reason }, { title: '原记录与候选证据', render: (_: any, issue: any) => <div>{[issue.observationId, ...(issue.candidateObservationIds || [])].filter(Boolean).map((id: string) => <p key={id}>{observationLabel(ledger.observations.find((o: any) => o.id === id) || { id, date: '', provider: '', amountMinor: '0' })}</p>)}</div> }]} />
        <Space wrap><Select mode="multiple" maxCount={2} style={{ minWidth: 380 }} placeholder="选择两条原始记录" value={linkIds} onChange={setLinkIds} options={ledger.observations.map((o: any) => ({ value: o.id, label: observationLabel(o) }))} />
          <Select value={linkType} onChange={setLinkType} options={[{ value: 'duplicate', label: '同一笔交易' }, { value: 'transfer', label: '转账双腿' }, { value: 'refund', label: '退款与原消费' }, { value: 'distinct', label: '明确不同交易' }]} />
          <Button disabled={linkIds.length !== 2 || busy} onClick={() => void run(() => client.createLink({ expectedRevision: ledger.revision, link: { type: linkType, observationIds: linkIds } }))}>确认关联</Button>
        </Space>
        <Table rowKey="id" dataSource={ledger.links.filter((l: any) => l.status !== 'deleted')} columns={[{ title: '关联方式', dataIndex: 'type' }, { title: '记录', dataIndex: 'observationIds', render: (ids: string[]) => ids.join(' / ') }, { title: '操作', render: (_: any, l: any) => <Button onClick={() => void run(() => client.deleteLink(l.id, { expectedRevision: ledger.revision }))}>解除关联</Button> }]} />
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
