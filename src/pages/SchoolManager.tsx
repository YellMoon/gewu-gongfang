import React, { useState, useEffect } from 'react';
import { Button, Form, Input, Space, Popconfirm, message, Tag, Statistic, Select as AntSelect } from 'antd'; // UTF-8
import Select from '../components/AutoCloseSelect';
import Table from '../components/NumberedTable';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import DataPageLayout from '../layout/DataPageLayout';

let dbService: any = null;

interface School {
  kind?: 'school' | 'alliance';
  member_school_ids?: string[];
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
  const selectedKind = Form.useWatch('kind', form) || 'school';

  useEffect(() => {
    if (!dbService) {
      const dbModule = require('../services/browserDatabase');
      dbService = dbModule.default;
    }
    loadData();
    // UTF-8: refresh acknowledged data without discarding the original editor.
    window.addEventListener('authority-projection-refreshed', loadData);
    return () => window.removeEventListener('authority-projection-refreshed', loadData);
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
    form.setFieldsValue({ name: record.name, kind: record.kind || 'school', member_school_ids: record.member_school_ids || [], notes: record.notes });
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    dbService.deleteSchool(id);
    message.success('删除成功');
    loadData();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingSchool) {
        // 编辑
        dbService.updateSchool(editingSchool.id, { name: values.name, kind: values.kind, member_school_ids: values.kind === 'alliance' ? values.member_school_ids || [] : [] });
        message.success('更新成功');
      } else {
        // 新增
        dbService.addOrUpdateSchool(values.name, values.kind, values.kind === 'alliance' ? values.member_school_ids || [] : []);
        message.success('添加成功');
      }
      setModalVisible(false);
      loadData();
    } catch (error) {
      console.error('验证失败:', error);
    }
  };

  const columns = [
    { title: '类型', dataIndex: 'kind', key: 'kind', width: 90, render: (kind?: string) => <Tag color={kind === 'alliance' ? 'purple' : 'blue'}>{kind === 'alliance' ? '联盟' : '学校'}</Tag> },
    {
      title: '学校或联盟名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '关联学生数',
      dataIndex: 'count',
      key: 'count',
      width: 120,
      render: (count: number, record: School) => record.kind === 'alliance' ? '-' : <Tag color="blue">{count} 人</Tag>,
    },
    { title: '联盟成员学校', key: 'members', width: 200, render: (_: unknown, record: School) => record.kind === 'alliance' ? (record.member_school_ids || []).map(id => schools.find(s => s.id === id)?.name || id).join('、') || '未设置' : '-' },
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
          <Popconfirm title="确定删除该学校或联盟？" onConfirm={() => handleDelete(record.id)}>
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
            <Statistic title="学校或联盟总数" value={schools.length} />
            <Statistic title="关联学生" value={schools.filter(school => school.kind !== 'alliance').reduce((sum, school) => sum + Number(school.count || 0), 0)} suffix="人" />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加学校或联盟
          </Button>
        </div>
      )}
      table={(
        <Table
          columns={columns}
          dataSource={schools}
          rowKey="id"
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无学校或联盟数据，点击上方按钮添加' }}
        />
      )}
      modalOpen={modalVisible}
      modalTitle={editingSchool ? '编辑学校或联盟' : '添加学校或联盟'}
      onModalCancel={() => setModalVisible(false)}
      modalFooter={(
        <div className="data-page-layout__modal-footer">
          <Button onClick={() => setModalVisible(false)}>取消</Button>
          <Button type="primary" onClick={handleSubmit}>保存</Button>
        </div>
      )}
      modalContent={(
        <Form form={form} layout="vertical" initialValues={{ kind: 'school' }}>
          <Form.Item name="kind" label="类型" rules={[{ required: true }]} extra="学生只能归属学校；试卷和试题可关联多个学校或联盟。">
            <Select options={[{value:'school',label:'学校'},{value:'alliance',label:'联盟'}]} />
          </Form.Item>
          {selectedKind === 'alliance' && <Form.Item name="member_school_ids" label="联盟成员学校" preserve={false} extra="可关联多所学校；一所学校可加入多个联盟。成员关系不自动决定试卷覆盖地区。">
            <AntSelect mode="multiple" showSearch optionFilterProp="label" options={schools.filter(s => s.kind !== 'alliance').map(s => ({value:s.id,label:s.name}))} />
          </Form.Item>}
          <Form.Item 
            name="name" 
            label="学校或联盟名称"
            rules={[{ required: true, message: '请输入学校或联盟名称' }]}
          >
            <Input placeholder="请输入学校或联盟名称" autoFocus />
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
