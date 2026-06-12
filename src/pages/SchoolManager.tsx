import React, { useState, useEffect } from 'react';
import { Table, Button, Form, Input, Space, Popconfirm, message, Tag, Statistic } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import DataPageLayout from '../layout/DataPageLayout';

let dbService: any = null;

interface School {
  id: string;
  name: string;
  count: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

const SchoolManager: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!dbService) {
      const dbModule = require('../services/browserDatabase');
      dbService = dbModule.default;
    }
    loadData();
  }, []);

  const loadData = () => {
    const data = dbService.getAllSchools();
    setSchools(data.sort((a: School, b: School) => b.count - a.count));
  };

  const handleAdd = () => {
    setEditingSchool(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: School) => {
    setEditingSchool(record);
    form.setFieldsValue({ name: record.name, notes: record.notes });
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    dbService.data.schools = dbService.data.schools.filter((s: School) => s.id !== id);
    dbService.saveData();
    message.success('删除成功');
    loadData();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingSchool) {
        // 编辑
        const school = dbService.data.schools.find((s: School) => s.id === editingSchool.id);
        if (school) {
          school.name = values.name;
          school.updated_at = new Date().toISOString();
          dbService.saveData();
        }
        message.success('更新成功');
      } else {
        // 新增
        dbService.addOrUpdateSchool(values.name);
        message.success('添加成功');
      }
      setModalVisible(false);
      loadData();
    } catch (error) {
      console.error('验证失败:', error);
    }
  };

  const columns = [
    {
      title: '学校名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '关联学生数',
      dataIndex: 'count',
      key: 'count',
      width: 120,
      render: (count: number) => <Tag color="blue">{count} 人</Tag>,
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 200,
      render: (text?: string) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: School) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该学校？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <DataPageLayout
      toolbar={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Space size={18} wrap>
            <Statistic title="学校总数" value={schools.length} />
            <Statistic title="关联学生" value={schools.reduce((sum, school) => sum + Number(school.count || 0), 0)} suffix="人" />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加学校
          </Button>
        </div>
      )}
      table={(
        <Table
          columns={columns}
          dataSource={schools}
          rowKey="id"
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无学校数据，点击上方按钮添加' }}
        />
      )}
      drawerOpen={modalVisible}
      drawerTitle={editingSchool ? '编辑学校' : '添加学校'}
      onDrawerClose={() => setModalVisible(false)}
      drawerFooter={(
        <div className="data-page-layout__drawer-footer">
          <Button onClick={() => setModalVisible(false)}>取消</Button>
          <Button type="primary" onClick={handleSubmit}>保存</Button>
        </div>
      )}
      drawerContent={(
        <Form form={form} layout="vertical">
          <Form.Item 
            name="name" 
            label="学校名称" 
            rules={[{ required: true, message: '请输入学校名称' }]}
          >
            <Input placeholder="请输入学校名称" autoFocus />
          </Form.Item>
          {editingSchool && (
            <Form.Item name="notes" label="备注">
              <Input.TextArea rows={3} placeholder="可选：添加备注信息" />
            </Form.Item>
          )}
        </Form>
      )}
    />
  );
};

export default SchoolManager;
