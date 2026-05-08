import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined, LogoutOutlined } from '@ant-design/icons';

interface AdminAccount {
  username: string;
  password: string;
  created_at: string;
}

const STORAGE_KEY = 'admin_accounts_geworks';

const Admin: React.FC = () => {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [form] = Form.useForm();

  const loadAccounts = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setAccounts(JSON.parse(stored));
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleAdd = (values: { username: string; password: string }) => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const list: AdminAccount[] = stored ? JSON.parse(stored) : [];

    if (list.some((a) => a.username === values.username)) {
      message.error('该账号已存在');
      return;
    }

    list.push({
      username: values.username,
      password: values.password,
      created_at: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    loadAccounts();
    setAddModalVisible(false);
    form.resetFields();
    message.success('添加成功');
  };

  const handleDelete = (username: string) => {
    if (username === 'admin') {
      message.warning('默认 admin 账号不可删除');
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    let list: AdminAccount[] = stored ? JSON.parse(stored) : [];
    list = list.filter((a) => a.username !== username);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    loadAccounts();
    message.success('已删除');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_logged_in');
    message.success('已退出登录');
    window.location.reload();
  };

  const columns = [
    {
      title: '账号',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: AdminAccount) => (
        <Space>
          {record.username === 'admin' ? (
            <Tag color="blue">默认账号</Tag>
          ) : (
            <Popconfirm
              title="确定删除该账号？"
              onConfirm={() => handleDelete(record.username)}
            >
              <Button type="link" danger size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>管理员管理</h3>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddModalVisible(true)}
          >
            添加管理员
          </Button>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </Space>
      </div>

      <Table
        dataSource={accounts}
        columns={columns}
        rowKey="username"
        pagination={false}
      />

      <Modal
        title="添加管理员"
        open={addModalVisible}
        onCancel={() => {
          setAddModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item
            name="username"
            label="账号"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input placeholder="输入账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="输入密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Admin;
