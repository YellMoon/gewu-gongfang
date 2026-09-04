import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Form, Input, InputNumber, Select as AntSelect,
  Space, message, Popconfirm, Tag, Row, Col, Divider, Statistic
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Student, StudentSource, Institution, Payment, Consumption, PaymentType } from '../types';
import { calculateGrade } from '../utils/helpers';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';
import { studentContactFormValues } from '../services/studentContactDraftProjection.mjs';

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

function schoolOptionMatches(inputValue: string, optionValue: any) {
  const input = normalizeSchoolName(inputValue).toLocaleLowerCase('zh-CN');
  const target = normalizeSchoolName(optionValue).toLocaleLowerCase('zh-CN');
  if (!input) return true;
  if (target.includes(input)) return true;
  let cursor = 0;
  for (const char of input) {
    cursor = target.indexOf(char, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

function contactText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function studentContactCommands(values: any, existingContacts: any[] = [], includeExpectedVersions = false) {
  const fields = [
    { slot: 1, relationship: 'student', phone: 'phone', wechat: 'student_wechat' },
    { slot: 2, relationship: 'guardian', phone: 'parent_phone', wechat: 'parent_wechat' },
    { slot: 3, relationship: 'guardian', phone: 'second_parent_phone', wechat: 'second_parent_wechat' },
  ] as const;
  return fields.flatMap(field => {
    const existing = existingContacts.find(contact => Number(contact.slot) === field.slot);
    const phone = contactText(values[field.phone]);
    const wechat = contactText(values[field.wechat]);
    if (!phone && !wechat && !existing) return [];
    if (!phone && !wechat && existing && includeExpectedVersions) {
      return [{ slot: field.slot, relationship: field.relationship, phone: null, wechat: null, expectedUpdatedAt: existing.updated_at }];
    }
    return [{
      slot: field.slot,
      relationship: field.relationship,
      phone,
      wechat,
      ...(includeExpectedVersions ? { expectedUpdatedAt: existing?.updated_at ?? null } : {}),
    }];
  });
}

const StudentList: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentContacts, setStudentContacts] = useState<any[]>([]);
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
    const studentContactsData = dbService.getAllStudentContacts ? dbService.getAllStudentContacts() : [];
    const institutionsData = dbService.getAllInstitutions();
    const paymentsData = dbService.getAllPayments();
    const consumptionsData = dbService.getAllConsumptions();
    
    // 从数据库学校表获取学校列表
    const rawSchools = dbService.getSchoolNames ? dbService.getSchoolNames() : (dbService.getAllSchools?.() || []);
    const schoolsFromDb = buildSchoolOptions(rawSchools).map(option => option.value);
    
    setStudents(studentsData);
    setStudentContacts(studentContactsData);
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
      ...studentContactFormValues(student, studentContacts),
      school: student.school ? [student.school] : [],
      grade_year: student.grade_year || new Date().getFullYear()
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const deletedStudent = students.find(student => student.id === id);
    const cloudRuntime = (window as any).desktopIdentitySessionProvider;
    const stageLocalDraft = () => {
      dbService.deleteStudent(id);
      (window as any).operateLogger?.log('delete', `student:${deletedStudent?.name || id}`, 'students');
    };
    if (typeof cloudRuntime?.deleteCloudStudent !== 'function' || !deletedStudent?.updated_at) {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      loadData();
      return;
    }
    try {
      await cloudRuntime.deleteCloudStudent({ studentId: id, expectedUpdatedAt: deletedStudent.updated_at });
      await dbService.refreshAuthorityProjection();
      message.success('\u4e91\u7aef\u5b66\u751f\u8d44\u6599\u5df2\u5220\u9664');
      loadData();
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code === 'CLOUD_BUSINESS_STUDENT_REFERENCED') {
        message.error('\u8be5\u5b66\u751f\u5df2\u88ab\u6392\u8bfe\u6216\u8bfe\u7a0b\u5f15\u7528\uff0c\u4e0d\u80fd\u5220\u9664');
        return;
      }
      const offline = code === 'ONLINE_DESKTOP_SESSION_REQUIRED' || error?.name === 'TypeError'
        || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.cause?.code || error?.code || ''));
      if (!offline) {
        message.error('\u4e91\u7aef\u5220\u9664\u5b66\u751f\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
        return;
      }
      stageLocalDraft();
      message.warning('\u5f53\u524d\u79bb\u7ebf\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      loadData();
    }
  };

  const submitExistingStudentToAuthority = async (values: any) => {
    if (!editingStudent) return false;
    const stageLocalDraft = () => {
      dbService.updateStudent(editingStudent.id, values);
      (window as any).operateLogger?.log('update', `student:${values.name}`, 'students');
    };
    const cloudRuntime = (window as any).desktopIdentitySessionProvider;
    if (typeof cloudRuntime?.updateCloudStudentRecord !== 'function' || !editingStudent.updated_at) {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
    const contacts = studentContactCommands(
      values,
      studentContacts.filter(contact => contact.student_id === editingStudent.id),
      true,
    );
    try {
      await cloudRuntime.updateCloudStudentRecord({
        studentId: editingStudent.id,
        expectedUpdatedAt: editingStudent.updated_at,
        name: values.name.trim(),
        school: values.school || null,
        gradeYear: values.grade_year ?? null,
        gradeCurrent: values.grade_current ?? null,
        institutionId: values.institution_id ?? null,
        parentName: values.parent_name?.trim() || null,
        notes: values.notes ?? null,
        sourceType: values.source_type ?? null,
        studentSource: values.student_source?.trim() || null,
        contacts,
      });
      await dbService.refreshAuthorityProjection();
      message.success('\u4e91\u7aef\u5b66\u751f\u8d44\u6599\u5df2\u66f4\u65b0');
      return true;
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code === 'CLOUD_BUSINESS_STUDENT_CONFLICT') {
        message.error('\u8be5\u5b66\u751f\u5df2\u88ab\u5176\u4ed6\u8bbe\u5907\u4fee\u6539\uff0c\u8bf7\u5237\u65b0\u540e\u518d\u7f16\u8f91');
        return false;
      }
      const offline = code === 'ONLINE_DESKTOP_SESSION_REQUIRED' || error?.name === 'TypeError'
        || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.cause?.code || error?.code || ''));
      if (!offline) {
        message.error('\u4e91\u7aef\u5b66\u751f\u8d44\u6599\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
        return false;
      }
      stageLocalDraft();
      message.warning('\u5f53\u524d\u79bb\u7ebf\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
  };

  const submitNewStudentToAuthority = async (values: any) => {
    const stageLocalDraft = () => {
      dbService.createStudent(values);
      (window as any).operateLogger?.log('create', `student:${values.name}`, 'students');
    };
    const cloudRuntime = (window as any).desktopIdentitySessionProvider;
    if (typeof cloudRuntime?.createCloudStudentRecord !== 'function') {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
    const contacts = studentContactCommands(values);
    const studentId = globalThis.crypto?.randomUUID?.() || `student-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await cloudRuntime.createCloudStudentRecord({
        studentId,
        name: values.name.trim(),
        school: values.school || null,
        gradeYear: values.grade_year ?? null,
        gradeCurrent: values.grade_current || calculateGrade(values.grade_year),
        institutionId: values.institution_id ?? null,
        parentName: values.parent_name?.trim() || null,
        notes: values.notes ?? null,
        sourceType: values.source_type ?? null,
        studentSource: values.student_source?.trim() || null,
        contacts,
      });
      await dbService.refreshAuthorityProjection();
      (window as any).operateLogger?.log('create', `student:${values.name}`, 'students');
      message.success('\u4e91\u7aef\u5b66\u751f\u8d44\u6599\u5df2\u521b\u5efa');
      return true;
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      const offline = code === 'ONLINE_DESKTOP_SESSION_REQUIRED' || error?.name === 'TypeError'
        || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.cause?.code || error?.code || ''));
      if (!offline) {
        message.error('\u4e91\u7aef\u521b\u5efa\u5b66\u751f\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
        return false;
      }
      stageLocalDraft();
      message.warning('\u5f53\u524d\u79bb\u7ebf\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 处理学校字段（AutoComplete 返回单个字符串）
      values.school = normalizeSchoolName(Array.isArray(values.school) ? values.school[0] : values.school);
      const legacyEditedStudent = editingStudent;
      if (!editingStudent) {
        const completed = await submitNewStudentToAuthority(values);
        if (completed) {
          setModalVisible(false);
          loadData();
        }
        return;
      }
      if (editingStudent) {
        const completed = await submitExistingStudentToAuthority(values);
        if (completed) {
          setModalVisible(false);
          loadData();
        }
        return;
      }
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
                <AntSelect
                  mode="tags"
                  maxCount={1}
                  maxTagCount={1}
                  placeholder="搜索或输入学校名称"
                  allowClear
                  showSearch
                  listHeight={360}
                  options={buildSchoolOptions(schools, schoolSearchText)}
                  filterOption={(inputValue, option) =>
                    schoolOptionMatches(inputValue, option?.value ?? option?.label)
                  }
                  onSearch={setSchoolSearchText}
                  onChange={(value) => {
                    const selected = Array.isArray(value) ? value.slice(-1)[0] : value;
                    form.setFieldValue('school', selected ? [normalizeSchoolName(selected)] : []);
                  }}
                  onSelect={(value) => {
                    form.setFieldValue('school', [normalizeSchoolName(value)]);
                    setSchoolSearchText('');
                  }}
                  onBlur={() => {
                    const raw = form.getFieldValue('school');
                    const typed = normalizeSchoolName(Array.isArray(raw) ? raw.slice(-1)[0] : raw || schoolSearchText);
                    form.setFieldValue('school', typed ? [typed] : []);
                    setSchoolSearchText('');
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
          <Divider>{'\u5b66\u751f\u4e0e\u5bb6\u957f\u8054\u7cfb\u65b9\u5f0f\uff08\u6700\u591a\u4e09\u7ec4\uff09'}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="student_wechat" label={'\u5b66\u751f\u5fae\u4fe1\u53f7'}>
                <Input placeholder={'\u8bf7\u8f93\u5165\u5b66\u751f\u5fae\u4fe1\u53f7'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="parent_phone" label={'\u5bb6\u957f\u4e00\u624b\u673a\u53f7'}>
                <Input placeholder={'\u8bf7\u8f93\u5165\u5bb6\u957f\u4e00\u624b\u673a\u53f7'} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="second_parent_phone" label={'\u5bb6\u957f\u4e8c\u624b\u673a\u53f7'}>
                <Input placeholder={'\u8bf7\u8f93\u5165\u5bb6\u957f\u4e8c\u624b\u673a\u53f7'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="second_parent_wechat" label={'\u5bb6\u957f\u4e8c\u5fae\u4fe1\u53f7'}>
                <Input placeholder={'\u8bf7\u8f93\u5165\u5bb6\u957f\u4e8c\u5fae\u4fe1\u53f7'} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      }
    />
  );
};

export default StudentList;
