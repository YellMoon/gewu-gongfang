
import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Form, Input, InputNumber, Select as AntSelect,
  Space, message, Popconfirm, Tag, Row, Col, DatePicker, Statistic
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Payment, Student, PaymentType } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';

const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

const PaymentList: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [form] = Form.useForm();
  const dbService = (window as any).dbService;

  const loadData = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    const paymentsData = dbService.getAllPayments();
    const studentsData = dbService.getAllStudents();
    setPayments(paymentsData);
    setStudents(studentsData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = () => {
    setEditingPayment(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (payment: Payment) => {
    setEditingPayment(payment);
    form.setFieldsValue(payment);
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const deletedPayment = payments.find(p => p.id === id);
    dbService.deletePayment(id);
    message.success('删除成功');
    (window as any).operateLogger?.log('删除', `删除缴费记录「¥${deletedPayment?.amount || 0}」`, '缴费管理');
    loadData();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const submitValues = {
        ...values,
        payment_date: values.payment_date.format('YYYY-MM-DD')
      };
      if (editingPayment) {
        dbService.updatePayment(editingPayment.id, submitValues);
        message.success('更新成功');
        (window as any).operateLogger?.log('修改', `修改缴费记录「¥${submitValues.amount}」- ${getStudentName(submitValues.student_id)}`, '缴费管理');
      } else {
        dbService.createPayment(submitValues);
        message.success('添加成功');
        (window as any).operateLogger?.log('创建', `创建缴费记录「¥${submitValues.amount}」- ${getStudentName(submitValues.student_id)}`, '缴费管理');
      }
      setModalVisible(false);
      loadData();
    } catch (error: any) {
      console.error('验证失败:', error);
    }
  };

  const getStudentName = (studentId: string) => {
    return students.find(s => s.id === studentId)?.name || '未知学生';
  };

  const columns: ColumnsType<Payment> = [
    { title: '序号', key: 'index', width: 70, render: (_, __, index) => index + 1 },
    { 
      title: '学生', 
      dataIndex: 'student_id', 
      key: 'student_id',
      width: 120,
      render: (studentId: string) => getStudentName(studentId)
    },
    { 
      title: '缴费金额', 
      dataIndex: 'amount', 
      key: 'amount',
      width: 120,
      render: (amount: number) => `¥${amount.toFixed(2)}`
    },
    { 
      title: '缴费类型', 
      dataIndex: 'payment_type', 
      key: 'payment_type',
      width: 100,
      render: (type: PaymentType) => (
        <Tag color={type === PaymentType.TUITION ? 'blue' : 'green'}>
          {type === PaymentType.TUITION ? '学费' : '课时'}
        </Tag>
      )
    },
    { 
      title: '缴费日期', 
      dataIndex: 'payment_date', 
      key: 'payment_date',
      width: 120
    },
    { 
      title: '缴费方式', 
      dataIndex: 'payment_method', 
      key: 'payment_method',
      width: 100
    },
    { title: '备注', dataIndex: 'notes', key: 'notes' },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const paymentMethods = ['现金', '微信', '支付宝', '银行转账', '其他'];

  return (
    <DataPageLayout
      toolbar={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Space size={18} wrap>
            <Statistic 
              title="总缴费笔数" 
              value={payments.length} 
            />
            <Statistic 
              title="总缴费金额" 
              value={payments.reduce((sum, p) => sum + p.amount, 0)} 
              prefix="¥"
              precision={2}
            />
            <Statistic 
              title="学费缴费笔数" 
              value={payments.filter(p => p.payment_type === PaymentType.TUITION).length} 
            />
            <Statistic 
              title="课时缴费笔数" 
              value={payments.filter(p => p.payment_type === PaymentType.HOURS).length} 
            />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加缴费记录</Button>
        </div>
      )}
      table={(
        <Table 
          columns={columns} 
          dataSource={payments} 
          rowKey="id"
          pagination={{ pageSize: 20 }}
        />
      )}
      drawerOpen={modalVisible}
      drawerTitle={editingPayment ? '编辑缴费记录' : '添加缴费记录'}
      drawerWidth={600}
      onDrawerClose={() => setModalVisible(false)}
      drawerFooter={(
        <div className="data-page-layout__drawer-footer">
          <Button onClick={() => setModalVisible(false)}>取消</Button>
          <Button type="primary" onClick={handleSubmit}>保存</Button>
        </div>
      )}
      drawerContent={(
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="student_id" 
                label="学生" 
                rules={[{ required: true, message: '请选择学生' }]}
              >
                <Select placeholder="请选择学生" showSearch>
                  {students.map(student => (
                    <Option key={student.id} value={student.id}>
                      {student.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="amount" 
                label="缴费金额" 
                rules={[{ required: true, message: '请输入缴费金额' }]}
              >
                <InputNumber min={0} style={{ width: '100%' }} prefix="¥" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="payment_type" 
                label="缴费类型" 
                initialValue={PaymentType.TUITION}
                rules={[{ required: true, message: '请选择缴费类型' }]}
              >
                <Select placeholder="请选择">
                  <Option value={PaymentType.TUITION}>学费</Option>
                  <Option value={PaymentType.HOURS}>课时</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="payment_date" 
                label="缴费日期" 
                rules={[{ required: true, message: '请选择缴费日期' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="payment_method" label="缴费方式">
            <Select placeholder="请选择缴费方式" allowClear>
              {paymentMethods.map(method => (
                <Option key={method} value={method}>{method}</Option>
              ))}
            </Select>
          </Form.Item>
          
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="其他备注信息" />
          </Form.Item>
        </Form>
      )}
    />
  );
};

export default PaymentList;
