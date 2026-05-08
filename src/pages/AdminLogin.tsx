import React, { useState, useEffect } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';

interface AdminAccount {
  username: string;
  password: string;
  created_at: string;
}

const STORAGE_KEY = 'admin_accounts_geworks';

const AdminLogin: React.FC<{ onLoginSuccess: () => void }> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Initialize default admin account if not exists
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const defaultAccounts: AdminAccount[] = [
        { username: 'admin', password: '122508', created_at: new Date().toISOString() }
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultAccounts));
    }
  }, []);

  const handleLogin = (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const accounts: AdminAccount[] = stored ? JSON.parse(stored) : [];
      const account = accounts.find(
        (a) => a.username === values.username && a.password === values.password
      );

      if (account) {
        sessionStorage.setItem('admin_logged_in', 'true');
        message.success('登录成功');
        onLoginSuccess();
      } else {
        message.error('账号或密码错误');
      }
    } catch {
      message.error('登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 360,
          padding: 40,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}
      >
        <h2 style={{ textAlign: 'center', marginBottom: 24, color: '#1890ff' }}>
          管理员登录
        </h2>
        <Form onFinish={handleLogin} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="账号" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default AdminLogin;
