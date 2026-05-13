import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Modal, Form, Input, InputNumber, Select as AntSelect,
  Space, message, Popconfirm, Tag, Card, Row, Col, Divider, Statistic
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Teacher } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';

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
    const deletedTeacher = teachers.find(t => t.id === id);
    dbService.deleteTeacher(id);
    message.success('删除成功');
    (window as any).operateLogger?.log('删除', `删除老师「${deletedTeacher?.name || id}」`, '老师管理');
    loadData();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingTeacher) {
        dbService.updateTeacher(editingTeacher.id, values);
        message.success('更新成功');
        (window as any).operateLogger?.log('修改', `修改老师「${values.name}」`, '老师管理');
      } else {
        dbService.createTeacher(values);
        message.success('添加成功');
        (window as any).operateLogger?.log('创建', `创建老师「${values.name}」`, '老师管理');
      }
      setModalVisible(false);
      loadData();
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

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="老师总数" value={teachers.length} prefix="👨‍🏫" />
          </Col>
        </Row>
      </Card>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加老师</Button>
        </div>
        
        <Table 
          columns={columns} 
          dataSource={teachers} 
          rowKey="id"
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title={editingTeacher ? '编辑老师' : '添加老师'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
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
      </Modal>
    </div>
  );
};

export default TeacherList;
