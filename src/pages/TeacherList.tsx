import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Form, Input, InputNumber, Select as AntSelect,
  Space, message, Popconfirm, Row, Col, Statistic
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Teacher } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';

const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

const TeacherList: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [form] = Form.useForm();
  const dbService = (window as any).dbService;

  const loadData = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    const teachersData = dbService.getAllTeachers();
    setTeachers(teachersData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = () => {
    setEditingTeacher(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    form.setFieldsValue(teacher);
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const deletedTeacher = teachers.find(teacher => teacher.id === id);
    const cloudRuntime = (window as any).desktopIdentitySessionProvider;
    const stageLocalDraft = () => {
      dbService.deleteTeacher(id);
      (window as any).operateLogger?.log('delete', `teacher:${deletedTeacher?.name || id}`, 'teachers');
    };
    if (typeof cloudRuntime?.deleteCloudTeacher !== 'function' || !deletedTeacher?.updated_at) {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      loadData();
      return;
    }
    try {
      await cloudRuntime.deleteCloudTeacher({ teacherId: id, expectedUpdatedAt: deletedTeacher.updated_at });
      await dbService.refreshAuthorityProjection();
      message.success('\u4e91\u7aef\u6559\u5e08\u8d44\u6599\u5df2\u5220\u9664');
      loadData();
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code === 'CLOUD_BUSINESS_TEACHER_REFERENCED') {
        message.error('\u8be5\u6559\u5e08\u5df2\u88ab\u8bfe\u7a0b\u5f15\u7528\uff0c\u4e0d\u80fd\u5220\u9664');
        return;
      }
      const offline = code === 'ONLINE_DESKTOP_SESSION_REQUIRED' || error?.name === 'TypeError'
        || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.cause?.code || error?.code || ''));
      if (!offline) {
        message.error('\u4e91\u7aef\u5220\u9664\u6559\u5e08\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
        return;
      }
      stageLocalDraft();
      message.warning('\u5f53\u524d\u79bb\u7ebf\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      loadData();
    }
  };

  const submitTeacherToAuthority = async (values: any) => {
    const cloudRuntime = (window as any).desktopIdentitySessionProvider;
    const payload = {
      name: values.name.trim(), phone: values.phone?.trim() || null, subject: values.subject?.trim() || null,
      hourlyRate: values.hourly_rate ?? null, notes: values.notes?.trim() || null,
    };
    const stageLocalDraft = () => {
      if (editingTeacher) dbService.updateTeacher(editingTeacher.id, values);
      else dbService.createTeacher(values);
      (window as any).operateLogger?.log(editingTeacher ? 'update' : 'create', `teacher:${values.name}`, 'teachers');
    };
    const offline = (error: any) => {
      const code = String(error?.code || error?.message || '');
      return code === 'ONLINE_DESKTOP_SESSION_REQUIRED' || error?.name === 'TypeError'
        || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.cause?.code || error?.code || ''));
    };
    if (!editingTeacher && typeof cloudRuntime?.createCloudTeacher !== 'function') {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
    if (editingTeacher && (typeof cloudRuntime?.updateCloudTeacher !== 'function' || !editingTeacher.updated_at)) {
      stageLocalDraft();
      message.warning('\u5f53\u524d\u65e0\u4e91\u7aef\u4f1a\u8bdd\uff0c\u5df2\u4fdd\u5b58\u4e3a\u5f85\u786e\u8ba4\u63d0\u4ea4\u7684\u8349\u7a3f');
      return true;
    }
    try {
      if (editingTeacher) {
        await cloudRuntime.updateCloudTeacher({ teacherId: editingTeacher.id, expectedUpdatedAt: editingTeacher.updated_at, ...payload });
      } else {
        const teacherId = globalThis.crypto?.randomUUID?.() || `teacher-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await cloudRuntime.createCloudTeacher({ teacherId, ...payload });
      }
      await dbService.refreshAuthorityProjection();
      message.success(editingTeacher ? '\u4e91\u7aef\u6559\u5e08\u8d44\u6599\u5df2\u66f4\u65b0' : '\u4e91\u7aef\u6559\u5e08\u8d44\u6599\u5df2\u521b\u5efa');
      return true;
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code === 'CLOUD_BUSINESS_TEACHER_CONFLICT') {
        message.error('\u8be5\u6559\u5e08\u5df2\u88ab\u5176\u4ed6\u8bbe\u5907\u4fee\u6539\uff0c\u8bf7\u5237\u65b0\u540e\u518d\u7f16\u8f91');
        return false;
      }
      if (!offline(error)) {
        message.error('\u4e91\u7aef\u6559\u5e08\u8d44\u6599\u5199\u5165\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
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
      const completed = await submitTeacherToAuthority(values);
      if (completed) {
        setModalVisible(false);
        loadData();
      }
      return;
    } catch (error: any) {
      console.error('验证失败:', error);
    }
  };

  const columns: ColumnsType<Teacher> = [
    { title: '序号', key: 'index', width: 70, render: (_, __, index) => index + 1 },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 120 },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 140 },
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 120 },
    { 
      title: '课时费', 
      dataIndex: 'hourly_rate', 
      key: 'hourly_rate',
      width: 120,
      render: (rate?: number) => rate ? `¥${rate.toFixed(2)}/小时` : '-'
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

  const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];

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
            <Statistic title="老师总数" value={teachers.length} prefix="👨‍🏫" />
          </Col>
        </Row>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加老师</Button>
        </div>
        </>
      }
      table={
        <>
        
        <Table 
          columns={columns} 
          dataSource={teachers} 
          rowKey="id"
          pagination={{ pageSize: 20 }}
        />
        </>
      }
      drawerOpen={modalVisible}
      drawerTitle={editingTeacher ? '编辑老师' : '添加老师'}
      onDrawerClose={() => setModalVisible(false)}
      drawerWidth={600}
      drawerFooter={drawerFooter}
      drawerContent={
        <>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input placeholder="请输入老师姓名" />
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
              <Form.Item name="subject" label="科目">
                <Select placeholder="请选择科目" showSearch allowClear>
                  {subjects.map(subject => (
                    <Option key={subject} value={subject}>{subject}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="hourly_rate" label="课时费">
                <InputNumber min={0} step={10} style={{ width: '100%' }} prefix="¥" placeholder="元/小时" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="其他备注信息" />
          </Form.Item>
        </Form>
        </>
      }
    />
  );
};

export default TeacherList;
