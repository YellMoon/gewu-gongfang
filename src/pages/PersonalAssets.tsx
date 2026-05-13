import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Modal, Form,
  Input, InputNumber, Select as AntSelect, message, Tag, Divider, Tabs, Popconfirm, Tooltip
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, SettingOutlined,
  FundViewOutlined, WalletOutlined, RiseOutlined, FallOutlined, UploadOutlined,
  MailOutlined, InboxOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AssetRecord, AssetCategory, AssetStats } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer } from 'recharts';
import AutoCloseSelect from '../components/AutoCloseSelect';

const { RangePicker } = DatePicker;
const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

const dbService = () => (window as any).dbService;

// ===== 账单 CSV 解析器 =====
function parseCsvContent(fileName: string, content: string): { type: string; amount: number; date: string; description: string; counterparty: string }[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const results: any[] = [];

  // Auto-detect platform
  const isWechat = content.includes('微信支付');
  const isAlipay = content.includes('支付宝');
  const isBank = lines.some((l: string) => ['交易日期', '摘要', '借贷方向'].some((k: string) => l.includes(k)));

  let headerIdx = -1, headers: string[] = [];

  // Find header row
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = line.split(',').map((f: string) => f.trim().replace(/^"|"$/g, ''));
    if (isWechat && fields.includes('交易时间')) { headerIdx = i; headers = fields; break; }
    if (isAlipay && fields.some((f: string) => ['交易号', '商品说明'].includes(f))) { headerIdx = i; headers = fields; break; }
    if (!isWechat && !isAlipay && fields.some((f: string) => ['交易日期', '摘要', '对方户名'].includes(f))) { headerIdx = i; headers = fields; break; }
  }
  if (headerIdx === -1) return results;

  const mappedHeaders = headers.map((h: string) => {
    const map: Record<string, string> = {
      '交易时间': 'dt', '交易对方': 'cp', '商品': 'desc', '商品名称': 'desc',
      '收/支': 'dir', '金额(元)': 'amt', '金额': 'amt', '金额（元）': 'amt',
      '交易日期': 'date', '摘要': 'desc', '摘要信息': 'desc', '对方户名': 'cp',
      '收入金额': 'inc', '支出金额': 'exp', '借方发生额': 'exp', '贷方发生额': 'inc',
      '交易创建时间': 'dt', '付款时间': 'dt',
    };
    return map[h] || h;
  });

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('-') || line.startsWith('#')) continue;
    const fields = line.split(',').map((f: string) => f.trim().replace(/^"|"$/g, ''));
    if (fields.length < headers.length) continue;

    const raw: Record<string, string> = {};
    mappedHeaders.forEach((h: string, idx: number) => { raw[h] = fields[idx] || ''; });

    const dir = raw.dir || '';
    let type = 'other';
    let amount = 0;

    if (dir.includes('收入') || dir.includes('贷') || raw.inc) {
      type = 'income'; amount = parseFloat(raw.inc || raw.amt || '0') || 0;
    } else if (dir.includes('支出') || dir.includes('借') || raw.exp) {
      type = 'expense'; amount = parseFloat(raw.exp || raw.amt || '0') || 0;
    } else {
      amount = parseFloat(raw.amt || '0') || 0;
      if (amount > 0 && !dir.includes('不计') && !dir.includes('other')) type = 'expense';
    }

    if (type === 'other' || amount <= 0) continue;

    const dt = (raw.dt || raw.date || '').replace(/\//g, '-');
    results.push({
      type, amount,
      date: dt.split(' ')[0] || '',
      description: raw.desc || '',
      counterparty: raw.cp || '',
      time: dt.split(' ')[1] || '',
    });
  }
  return results;
}

const handleCsvUpload = (fileName: string, content: string, loadD: () => void, loadS: () => void) => {
  const records = parseCsvContent(fileName, content);
  if (records.length === 0) {
    message.warning('未能从文件中解析出账单记录，请确认文件格式');
    return;
  }
  const db = (window as any).dbService;
  let added = 0;
  for (const r of records) {
    try {
      db.createAssetRecord({
        date: r.date,
        type: r.type as 'income' | 'expense',
        category_id: r.type === 'income' ? 'builtin-other-income' : 'builtin-other-expense',
        category_name: r.type === 'income' ? '其他收入' : '其他支出',
        amount: r.amount,
        student_name: r.counterparty || undefined,
        note: `[账单导入] ${r.description || fileName}`.slice(0, 200),
      });
      added++;
    } catch (e) { /* skip */ }
  }
  loadD();
  loadS();
  message.success(`成功导入 ${added} 条账单记录`);
};

const PersonalAssets: React.FC = () => {
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'), dayjs().endOf('month')
  ]);
  const [modalVisible, setModalVisible] = useState(false);
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AssetRecord | null>(null);
  const [tabKey, setTabKey] = useState('all');
  const [form] = Form.useForm();
  const [catForm] = Form.useForm();
  const [emailForm] = Form.useForm();
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailResult, setEmailResult] = useState<any>(null);

  const loadData = useCallback(() => {
    const db = (window as any).dbService;
    if (!db) return;
    setRecords(db.getAllAssetRecords?.() || []);
    setCategories(db.getAllAssetCategories?.() || []);
  }, []);

  const loadStats = useCallback(() => {
    const db = (window as any).dbService;
    if (!db) return;
    const s = db.getAssetStats?.(dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD'));
    if (s) setStats(s);
  }, [dateRange]);

  useEffect(() => { loadData(); loadStats(); }, [loadData, loadStats]);

  const handleEmailCheck = async () => {
    setEmailChecking(true);
    setEmailResult(null);
    try {
      const values = await emailForm.validateFields();
      const res = await fetch('/api/bill-import/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.error) {
        message.error('检查失败: ' + data.error);
      } else {
        setEmailResult(data);
        message.success(`找到 ${data.total || 0} 条账单记录`);
      }
    } catch (e: any) {
      message.error('连接后端失败: ' + (e.message || '未知错误'));
    }
    setEmailChecking(false);
  };

  const importBillRecords = (records: any[]) => {
    const db = (window as any).dbService;
    let added = 0;
    for (const r of records) {
      try {
        db.createAssetRecord({
          date: r.date,
          type: r.type as 'income' | 'expense',
          category_id: r.type === 'income' ? 'builtin-other-income' : 'builtin-other-expense',
          category_name: r.type === 'income' ? '其他收入' : '其他支出',
          amount: r.amount,
          student_name: r.counterparty || undefined,
          note: `[${r.platform || '账单'}] ${r.description || ''}`.slice(0, 200),
        });
        added++;
      } catch (e) { /* skip */ }
    }
    loadData();
    loadStats();
    message.success(`已导入 ${added} 条账单记录`);
  };

  // Filter records based on date and tab
  const filteredRecords = records.filter(r => {
    const inDate = r.date >= dateRange[0].format('YYYY-MM-DD') && r.date <= dateRange[1].format('YYYY-MM-DD');
    if (!inDate) return false;
    if (tabKey === 'income') return r.type === 'income';
    if (tabKey === 'expense') return r.type === 'expense';
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  // Add / Edit record
  const handleSaveRecord = async () => {
    const values = await form.validateFields();
    const db = (window as any).dbService;
    if (editingRecord) {
      db.updateAssetRecord(editingRecord.id, {
        date: values.date.format('YYYY-MM-DD'),
        type: values.type,
        category_id: values.category_id,
        category_name: categories.find(c => c.id === values.category_id)?.name || '',
        amount: values.amount,
        student_name: values.student_name || undefined,
        note: values.note || undefined,
      });
    } else {
      db.createAssetRecord({
        date: values.date.format('YYYY-MM-DD'),
        type: values.type,
        category_id: values.category_id,
        category_name: categories.find(c => c.id === values.category_id)?.name || '',
        amount: values.amount,
        student_name: values.student_name || undefined,
        note: values.note || undefined,
      });
    }
    setModalVisible(false);
    setEditingRecord(null);
    form.resetFields();
    loadData();
    loadStats();
  };

  const handleDelete = (id: string) => {
    (window as any).dbService.deleteAssetRecord(id);
    loadData();
    loadStats();
  };

  // Categories
  const handleSaveCategory = async () => {
    const values = await catForm.validateFields();
    (window as any).dbService.createAssetCategory({ name: values.name, type: values.type, color: values.color });
    setCatModalVisible(false);
    catForm.resetFields();
    loadData();
  };

  const handleDeleteCategory = (id: string) => {
    (window as any).dbService.deleteAssetCategory(id);
    loadData();
  };

  // Export
  const handleExport = () => {
    const XLSX = (window as any).XLSX;
    if (!XLSX) { message.warning('导出组件未加载'); return; }
    const data = filteredRecords.map((r, i) => ({
      '序号': i + 1,
      '日期': r.date,
      '类型': r.type === 'income' ? '收入' : '支出',
      '分类': r.category_name,
      '金额': r.amount,
      '学员': r.student_name || '',
      '备注': r.note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '资产记录');
    XLSX.writeFile(wb, `资产统计_${dateRange[0].format('YYYYMMDD')}-${dateRange[1].format('YYYYMMDD')}.xlsx`);
  };

  // ---- Render ----
  const incomeCat = categories.filter(c => c.type === 'income');
  const expenseCat = categories.filter(c => c.type === 'expense');

  const columns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 70,
      render: (t: string) => t === 'income'
        ? <Tag color="green">收入</Tag>
        : <Tag color="red">支出</Tag>
    },
    { title: '分类', dataIndex: 'category_name', key: 'category_name', width: 100 },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 120,
      render: (v: number, r: AssetRecord) => (
        <span style={{ color: r.type === 'income' ? '#3f8600' : '#cf1322', fontWeight: 600 }}>
          {r.type === 'income' ? '+' : '-'}¥{v.toFixed(2)}
        </span>
      )
    },
    { title: '学员', dataIndex: 'student_name', key: 'student_name', width: 100 },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, r: AssetRecord) => (
        <Space>
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
              setEditingRecord(r);
              form.setFieldsValue({
                date: dayjs(r.date),
                type: r.type,
                category_id: r.category_id,
                amount: r.amount,
                student_name: r.student_name,
                note: r.note,
              });
              setModalVisible(true);
            }} />
          </Tooltip>
          <Popconfirm title="确定删除这条记录？" onConfirm={() => handleDelete(r.id)}>
            <Tooltip title="删除">
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* ===== Summary Cards ===== */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><RiseOutlined /> 总收入</span>}
              value={stats?.totalIncome || 0}
              precision={2} prefix="¥"
              valueStyle={{ color: '#3f8600', fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><FallOutlined /> 总支出</span>}
              value={stats?.totalExpense || 0}
              precision={2} prefix="¥"
              valueStyle={{ color: '#cf1322', fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><WalletOutlined /> 净收益</span>}
              value={stats?.netAmount || 0}
              precision={2} prefix="¥"
              valueStyle={{ color: (stats?.netAmount || 0) >= 0 ? '#3f8600' : '#cf1322', fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><FundViewOutlined /> 记录数</span>}
              value={filteredRecords.length}
              suffix="条"
              valueStyle={{ fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ===== Toolbar ===== */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Space>
              <span>日期：</span>
              <RangePicker
                value={dateRange}
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setDateRange([dates[0] as dayjs.Dayjs, dates[1] as dayjs.Dayjs]);
                  }
                }}
                allowClear={false}
              />
            </Space>
          </Col>
          <Col flex="auto">
            <Tabs activeKey={tabKey} onChange={setTabKey} size="small">
              <Tabs.TabPane tab="全部" key="all" />
              <Tabs.TabPane tab="收入" key="income" />
              <Tabs.TabPane tab="支出" key="expense" />
            </Tabs>
          </Col>
          <Col>
            <Space>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => {
                setEditingRecord(null);
                form.resetFields();
                form.setFieldsValue({ date: dayjs(), type: 'income' });
                setModalVisible(true);
              }}>新增记录</Button>
              <Button icon={<SettingOutlined />} onClick={() => setCatModalVisible(true)}>分类管理</Button>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>导出Excel</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ===== Monthly Trend Chart ===== */}
      {stats && stats.monthlyTrend.length > 0 && (
        <Card title="月度趋势" style={{ marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <ReTooltip />
              <Legend />
              <Bar dataKey="income" name="收入" fill="#3f8600" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="支出" fill="#cf1322" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ===== Category Summary ===== */}
      {stats && (stats.incomeByCategory.length > 0 || stats.expenseByCategory.length > 0) && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {stats.incomeByCategory.length > 0 && (
            <Col span={12}>
              <Card title="收入分类" size="small">
                {stats.incomeByCategory.map(c => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{c.category} <Tag style={{ marginLeft: 4 }}>{c.count}笔</Tag></span>
                    <span style={{ color: '#3f8600', fontWeight: 600 }}>¥{c.amount.toFixed(2)}</span>
                  </div>
                ))}
              </Card>
            </Col>
          )}
          {stats.expenseByCategory.length > 0 && (
            <Col span={12}>
              <Card title="支出分类" size="small">
                {stats.expenseByCategory.map(c => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{c.category} <Tag style={{ marginLeft: 4 }}>{c.count}笔</Tag></span>
                    <span style={{ color: '#cf1322', fontWeight: 600 }}>¥{c.amount.toFixed(2)}</span>
                  </div>
                ))}
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* ===== Records Table ===== */}
      <Card>
        <Table
          columns={columns}
          dataSource={filteredRecords}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
          size="small"
          scroll={{ x: 700 }}
        />
      </Card>

      {/* ===== Add/Edit Record Modal ===== */}
      <Modal
        title={editingRecord ? '编辑记录' : '新增记录'}
        open={modalVisible}
        onOk={handleSaveRecord}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select>
              <Option value="income">收入</Option>
              <Option value="expense">支出</Option>
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) => {
              const type = getFieldValue('type');
              const cats = type === 'income' ? incomeCat : expenseCat;
              return (
                <Form.Item name="category_id" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
                  <Select>
                    {cats.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="student_name" label="学员">
            <Input placeholder="关联学员（可选）" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== Auto Import Section ===== */}
      <Card title={<span><InboxOutlined /> 自动导入账单</span>} style={{ marginBottom: 16 }}>
        <Tabs defaultActiveKey="manual">
          <Tabs.TabPane tab={<span><UploadOutlined /> 手动上传CSV</span>} key="manual">
            <p style={{ color: '#666', marginBottom: 16 }}>
              支持上传微信/支付宝/银行导出的 CSV 账单文件，自动解析为收支记录。
            </p>
            <div style={{ border: '2px dashed #d9d9d9', borderRadius: 8, padding: 40, textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const content = (ev.target?.result || '') as string;
                  handleCsvUpload(file.name, content, loadData, loadStats);
                };
                reader.readAsText(file);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.csv,.xlsx'; input.onchange = (e: any) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const content = (ev.target?.result || '') as string;
                    handleCsvUpload(file.name, content, loadData, loadStats);
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}
            >
              <UploadOutlined style={{ fontSize: 48, color: '#1890ff' }} />
              <p style={{ marginTop: 12, color: '#666' }}>点击或拖拽 CSV 文件到此处</p>
              <p style={{ fontSize: 12, color: '#999' }}>支持格式：微信支付账单、支付宝账单、银行流水</p>
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span><MailOutlined /> 邮箱自动拉取</span>} key="email">
            <p style={{ color: '#666', marginBottom: 16 }}>
              配置邮箱后，系统将自动搜索并下载账单邮件中的附件进行解析。
              支持平台：微信、支付宝、云闪付、微众银行、同花顺、各大银行、证券公司。
            </p>
            <Form form={emailForm} layout="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Form.Item name="imap_server" label="IMAP 服务器" rules={[{ required: true }]}>
                <Input placeholder="imap.qq.com" style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="imap_port" label="端口" initialValue={993}>
                <InputNumber placeholder="993" style={{ width: 90 }} />
              </Form.Item>
              <Form.Item name="email" label="邮箱地址" rules={[{ required: true }]}>
                <Input placeholder="your@email.com" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="password" label="密码/授权码" rules={[{ required: true }]}>
                <Input.Password placeholder="授权码" style={{ width: 180 }} />
              </Form.Item>
              <Form.Item>
                <Button type="primary" icon={<MailOutlined />} loading={emailChecking} onClick={handleEmailCheck}>
                  {emailChecking ? '检查中...' : '测试并导入'}
                </Button>
              </Form.Item>
            </Form>
            {emailResult && (
              <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', borderRadius: 6 }}>
                <p>✅ 成功检查，找到 {emailResult.emails?.length || 0} 封账单邮件，共解析 {emailResult.total || 0} 条记录</p>
                {emailResult.emails?.map((e: any, idx: number) => (
                  <div key={idx} style={{ marginTop: 4, fontSize: 13, color: '#666' }}>
                    <b>{e.subject}</b> — {e.filename} ({e.count} 条)
                    <Button size="small" type="link" onClick={() => importBillRecords(e.records)}>导入</Button>
                  </div>
                ))}
              </div>
            )}
          </Tabs.TabPane>
        </Tabs>
      </Card>

      {/* ===== Category Management Modal ===== */}
      <Modal
        title="分类管理"
        open={catModalVisible}
        onCancel={() => { setCatModalVisible(false); catForm.resetFields(); }}
        footer={null}
        width={500}
        destroyOnClose
      >
        <Tabs>
          <Tabs.TabPane tab="收入分类" key="income">
            {incomeCat.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span><Tag color={c.color || '#1890ff'}>{c.name}</Tag></span>
                {!c.id.startsWith('builtin-') && (
                  <Popconfirm title="确定删除此分类？" onConfirm={() => handleDeleteCategory(c.id)}>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            ))}
          </Tabs.TabPane>
          <Tabs.TabPane tab="支出分类" key="expense">
            {expenseCat.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span><Tag color={c.color || '#cf1322'}>{c.name}</Tag></span>
                {!c.id.startsWith('builtin-') && (
                  <Popconfirm title="确定删除此分类？" onConfirm={() => handleDeleteCategory(c.id)}>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            ))}
          </Tabs.TabPane>
        </Tabs>
        <Divider />
        <Form form={catForm} layout="inline" onFinish={handleSaveCategory}>
          <Form.Item name="name" rules={[{ required: true, message: '请输入分类名称' }]}>
            <Input placeholder="分类名称" />
          </Form.Item>
          <Form.Item name="type" initialValue="income" rules={[{ required: true }]}>
            <Select style={{ width: 100 }}>
              <Option value="income">收入</Option>
              <Option value="expense">支出</Option>
            </Select>
          </Form.Item>
          <Form.Item name="color">
            <Input placeholder="#颜色" style={{ width: 100 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>添加</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PersonalAssets;
