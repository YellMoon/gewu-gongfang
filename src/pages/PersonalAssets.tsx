import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, DatePicker, Button, Space, Modal, Form,
  Input, InputNumber, Select as AntSelect, message, Tag, Divider, Tabs, Popconfirm, Tooltip
} from 'antd';
import Table from '../components/NumberedTable';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, SettingOutlined,
  FundViewOutlined, WalletOutlined, RiseOutlined, FallOutlined, UploadOutlined,
  MailOutlined, InboxOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AssetRecord, AssetCategory, AssetStats } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer } from 'recharts';
import AutoCloseSelect from '../components/AutoCloseSelect';
import PersonalFinancePanel from '../components/PersonalFinancePanel';

const { RangePicker } = DatePicker;
const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

const dbService = () => (window as any).dbService;

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
              title={<span><RiseOutlined /> 手工及历史记录收入</span>}
              value={stats?.totalIncome || 0}
              precision={2} prefix="¥"
              valueStyle={{ color: '#3f8600', fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><FallOutlined /> 手工及历史记录支出</span>}
              value={stats?.totalExpense || 0}
              precision={2} prefix="¥"
              valueStyle={{ color: '#cf1322', fontWeight: 600, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={<span><WalletOutlined /> 记录结余</span>}
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
                {stats.incomeByCategory.map((c, index) => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{index + 1}. {c.category} <Tag style={{ marginLeft: 4 }}>{c.count}笔</Tag></span>
                    <span style={{ color: '#3f8600', fontWeight: 600 }}>¥{c.amount.toFixed(2)}</span>
                  </div>
                ))}
              </Card>
            </Col>
          )}
          {stats.expenseByCategory.length > 0 && (
            <Col span={12}>
              <Card title="支出分类" size="small">
                {stats.expenseByCategory.map((c, index) => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{index + 1}. {c.category} <Tag style={{ marginLeft: 4 }}>{c.count}笔</Tag></span>
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
      <PersonalFinancePanel />

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
            {incomeCat.map((c, index) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{index + 1}. <Tag color={c.color || '#1890ff'}>{c.name}</Tag></span>
                {!c.id.startsWith('builtin-') && (
                  <Popconfirm title="确定删除此分类？" onConfirm={() => handleDeleteCategory(c.id)}>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            ))}
          </Tabs.TabPane>
          <Tabs.TabPane tab="支出分类" key="expense">
            {expenseCat.map((c, index) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{index + 1}. <Tag color={c.color || '#cf1322'}>{c.name}</Tag></span>
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
