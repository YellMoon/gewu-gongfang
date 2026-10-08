// UTF-8
import React from 'react';
import { Button, Dropdown } from 'antd';
import { DownOutlined, LockOutlined, SwapOutlined, UserOutlined } from '@ant-design/icons';

type Props = {
  name: string;
  role: string;
  busy: boolean;
  canElevate: boolean;
  canReturnTeacher: boolean;
  onLock: () => void;
  onSwitchRole: (role: 'super_admin' | 'teacher') => void;
};

const DesktopAccountMenu: React.FC<Props> = ({ name, role, busy, canElevate, canReturnTeacher, onLock, onSwitchRole }) => (
  <div className="desktop-identity-runtime-bar">
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'current-role', label: '当前身份：' + role, disabled: true },
      { key: 'my-account', label: '我的', icon: <UserOutlined /> },
      ...(canElevate ? [{ key: 'super_admin', label: '切换为超级管理员', icon: <SwapOutlined /> }] : []),
      ...(canReturnTeacher ? [{ key: 'teacher', label: '切换为教师', icon: <SwapOutlined /> }] : []),
      { type: 'divider' as const },
      { key: 'lock', label: '锁定', icon: <LockOutlined /> },
    ], onClick: ({ key }) => {
      if (key === 'lock') onLock();
      else if (key === 'super_admin' || key === 'teacher') onSwitchRole(key);
      else window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'my-account' }));
    } }}>
      <Button type="text" disabled={busy} className="desktop-account-trigger" aria-label={`我的：${name}，${role}`}>
        <UserOutlined />
        <span className="desktop-account-trigger__name" title={name}>{name}</span>
        <DownOutlined />
      </Button>
    </Dropdown>
  </div>
);

export default DesktopAccountMenu;
