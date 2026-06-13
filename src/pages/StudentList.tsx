import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Form, Input, InputNumber, Select as AntSelect,
  Space, message, Popconfirm, Tag, Row, Col, Divider, Statistic, AutoComplete
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Student, StudentSource, Institution, Payment, Consumption, PaymentType } from '../types';
import { calculateGrade } from '../utils/helpers';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';

const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

function normalizeSchoolName(value: any) {
  return String(typeof value === 'string' ? value : value?.name || '').trim();
}

function buildSchoolOptions(values: any[], searchText = '') {
  const names = [...values.map(normalizeSchoolName), normalizeSchoolName(searchText)].filter(Boolean);
  const unique = new Map<string, string>();
  names.forEach(name => {
    const key = name.toLocaleLowerCase('zh-CN');
    if (!unique.has(key)) unique.set(key, name);
  });
  return Array.from(unique.values())
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map(name => ({ label: name, value: name }));
}

const StudentList: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [schools, setSchools] = useState<string[]>([]);
  const [schoolSearchText, setSchoolSearchText] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [form] = Form.useForm();
  const sourceTypeValue = Form.useWatch('source_type', form);
  const dbService = (window as any).dbService;

  const loadData = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    const studentsData = dbService.getAllStudents();
    const institutionsData = dbService.getAllInstitutions();
    const paymentsData = dbService.getAllPayments();
    const consumptionsData = dbService.getAllConsumptions();
    
    // 从数据库学校表获取学校列表
    const rawSchools = dbService.getSchoolNames ? dbService.getSchoolNames() : (dbService.getAllSchools?.() || []);
    const schoolsFromDb = buildSchoolOptions(rawSchools).map(option => option.value);
    
    setStudents(studentsData);
    setInstitutions(institutionsData);
    setSchools(schoolsFromDb);
    setPayments(paymentsData);
    setConsumptions(consumptionsData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = () => {
    setEditingStudent(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    form.setFieldsValue({
      ...student,
      school: student.school || undefined,
      grade_year: student.grade_year || new Date().getFullYear()
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const deletedStudent = students.find(s => s.id === id);
    dbService.deleteStudent(id);
    message.success('删除成功');
    (window as any).operateLogger?.log('删除', `删除学生「${deletedStudent?.name || id}」`, '学生管理');
    loadData();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 处理学校字段（AutoComplete 返回单个字符串）
      values.school = normalizeSchoolName(Array.isArray(values.school) ? values.school[0] : values.school);
      // 自动保存学校信息
      if (values.school) {
        dbService.addOrUpdateSchool(values.school);
      }
      if (editingStudent) {
        dbService.updateStudent(editingStudent.id, values);
        message.success('更新成功');
        (window as any).operateLogger?.log('修改', `修改学生「${values.name}」`, '学生管理');
      } else {
        dbService.createStudent(values);
        message.success('添加成功');
        (window as any).operateLogger?.log('创建', `创建学生「${values.name}」`, '学生管理');
      }
      setModalVisible(false);
      loadData();
    } catch (error: any) {
      console.error('验证失败:', error);
    }
  };

  const getStudentBalance = (studentId: string) => {
    const studentPayments = payments.filter(p => p.student_id === studentId);
    const studentConsumptions = consumptions.filter(c => c.student_id === studentId);
    
    const totalHours = studentPayments
      .filter(p => p.payment_type === PaymentType.HOURS)
      .reduce((sum, p) => sum + p.amount, 0);
    const consumedHours = studentConsumptions.reduce((sum, c) => sum + c.hours, 0);
    
    const totalMoney = studentPayments
      .filter(p => p.payment_type === PaymentType.TUITION)
      .reduce((sum, p) => sum + p.amount, 0);
    const consumedMoney = studentConsumptions.reduce((sum, c) => sum + c.amount, 0);
    
    return {
      balanceHours: totalHours - consumedHours,
      balanceMoney: totalMoney - consumedMoney
    };
  };

  const studentsWithBalance = students.map(student => {
    const { balanceHours, balanceMoney } = getStudentBalance(student.id);
    return {
      ...student,
      balance_hours: balanceHours,
      balance_money: balanceMoney
    };
  });

  const columns: ColumnsType<Student> = [
    { title: '序号', key: 'index', width: 70, render: (_, __, index) => index + 1 },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 100 },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: '学校', dataIndex: 'school', key: 'school', width: 150 },
    { 
      title: '入学年份', 
      dataIndex: 'grade_year', 
      key: 'grade_year',
      width: 90,
      render: (year?: number) => year ? `${year}级` : '-'
    },
    { 
      title: '当前年级', 
      dataIndex: 'grade_current', 
      key: 'grade_current',
      width: 90,
      render: (grade?: string) => <Tag color="blue">{grade || '未设置'}</Tag>
    },
    { 
      title: '生源类型', 
      dataIndex: 'source_type', 
      key: 'source_type',
      width: 90,
      render: (type?: StudentSource) => (
        <Tag color={type === StudentSource.SELF ? 'green' : 'orange'}>
          {type === StudentSource.SELF ? '自有' : '机构'}
        </Tag>
      )
    },
    { 
      title: '剩余课时', 
      dataIndex: 'balance_hours', 
      key: 'balance_hours',
      width: 90,
      render: (hours: number) => (
        <Tag color={hours < 5 ? 'red' : 'green'}>{hours}课时</Tag>
      )
    },
    { 
      title: '账户余额', 
      dataIndex: 'balance_money', 
      key: 'balance_money',
      width: 100,
      render: (money: number) => `¥${money.toFixed(2)}`
    },
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

  const currentYear = new Date().getFullYear();
  const gradeYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const drawerFooter = (
    <div className="data-page-layout__drawer-footer">
      <Button onClick={() => setModalVisible(false)}>取消</Button>
      <Button type="primary" onClick={handleSubmit}>确定</Button>
    </div>
  );

  return (
    <DataPageLayout
      toolbar={
        <>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="学生总数" value={students.length} prefix="👨‍🎓" />
          </Col>
          <Col span={6}>
            <Statistic 
              title="总剩余课时" 
              value={studentsWithBalance.reduce((sum, s) => sum + s.balance_hours, 0)} 
              suffix="课时"
            />
          </Col>
          <Col span={6}>
            <Statistic 
              title="总账户余额" 
              value={studentsWithBalance.reduce((sum, s) => sum + s.balance_money, 0)} 
              prefix="¥"
              precision={2}
            />
          </Col>
          <Col span={6}>
            <Statistic 
              title="课时不足5的学生数" 
              value={studentsWithBalance.filter(s => s.balance_hours > 0 && s.balance_hours < 5).length} 
              prefix="⚠️"
              valueStyle={{ color: '#cf1322' }}
            />
          </Col>
        </Row>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加学生</Button>
        </div>
        </>
      }
      table={
        <Table 
          columns={columns} 
          dataSource={studentsWithBalance} 
          rowKey="id"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1200 }}
        />
      }
      drawerOpen={modalVisible}
      drawerTitle={editingStudent ? '编辑学生' : '添加学生'}
      onDrawerClose={() => setModalVisible(false)}
      drawerWidth={560}
      drawerFooter={drawerFooter}
      destroyOnClose
      drawerContent={
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input placeholder="请输入学生姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="请输入联系电话" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="school" label="学校">
                <AutoComplete
                  placeholder="搜索或输入学校名称"
                  allowClear
                  options={buildSchoolOptions(schools, schoolSearchText)}
                  filterOption={(inputValue, option) =>
                    normalizeSchoolName(option?.value).toLocaleLowerCase('zh-CN').includes(inputValue.toLocaleLowerCase('zh-CN'))
                  }
                  onSearch={setSchoolSearchText}
                  onSelect={(value) => {
                    form.setFieldValue('school', normalizeSchoolName(value));
                    setSchoolSearchText('');
                  }}
                  onBlur={() => {
                    const typed = normalizeSchoolName(form.getFieldValue('school') || schoolSearchText);
                    form.setFieldValue('school', typed || undefined);
                    setSchoolSearchText('');
                  }}
                  onInputKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== 'Tab') return;
                    const typed = normalizeSchoolName(form.getFieldValue('school') || schoolSearchText);
                    if (typed) form.setFieldValue('school', typed);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="grade_year" label="入学年份" rules={[{ required: true, message: '请选择入学年份' }]}>
                <Select placeholder="请选择入学年份">
                  {gradeYears.map(year => (
                    <Option key={year} value={year}>{year}级</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider>家长信息</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="parent_name" label="家长姓名">
                <Input placeholder="请输入家长姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="parent_wechat" label="家长微信">
                <Input placeholder="请输入家长微信号" />
              </Form.Item>
            </Col>
          </Row>

          <Divider>生源信息</Divider>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="student_source" label="学生来源">
                <Input placeholder="请填写学生具体来源（例如：家长介绍、抖音、学校老师推荐等）" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="source_type" label="生源类型" initialValue={StudentSource.SELF}>
                <Select placeholder="请选择" onChange={(val) => {
                  if (val !== StudentSource.INSTITUTION) {
                    form.setFieldValue('institution_id', undefined);
                  }
                }}>
                  <Option value={StudentSource.SELF}>自有生源</Option>
                  <Option value={StudentSource.INSTITUTION}>机构生源</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="institution_id" label="所属机构">
                <Select
                  placeholder={sourceTypeValue === StudentSource.INSTITUTION ? '请选择机构' : '选择机构生源后可编辑'}
                  allowClear
                  disabled={sourceTypeValue !== StudentSource.INSTITUTION}
                >
                  {(institutions || []).map(inst => (
                    <Option key={inst.id} value={inst.id}>{inst.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="balance_hours" label="剩余课时" initialValue={0}>
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="balance_money" label="账户余额" initialValue={0}>
                <InputNumber min={0} step={100} style={{ width: '100%' }} prefix="¥" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="其他备注信息" />
          </Form.Item>
        </Form>
      }
    />
  );
};

export default StudentList;
