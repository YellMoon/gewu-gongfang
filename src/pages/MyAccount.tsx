import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Avatar, Button, Card, Collapse, Descriptions, Skeleton, Space, Tag } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { DesktopAccountContext } from '../components/DesktopAccountContext';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { resolveDesktopIdentityBaseUrl } from '../services/managedSyncConfig.mjs';
import { cacheDesktopAccountProfile, loadDesktopAccountProfile, readCachedDesktopAccountProfile } from '../services/desktopAccountProfile.mjs';
import type { MyAccountContext } from '../navigation/navigationContext';
import IdentityDeviceCenter from './IdentityDeviceCenter';
import SystemSettings from './SystemSettings';
import './MyAccount.css';

const MyAccount: React.FC<{ context?: MyAccountContext }> = ({ context }) => {
  const account = useContext(DesktopAccountContext);
  const [snapshot, setSnapshot] = useState(() => ({ userId: account.userId, activeRole: account.activeRole,
    profile: readCachedDesktopAccountProfile({ userId: account.userId, activeRole: account.activeRole }) }));
  const profile = snapshot.userId === account.userId && snapshot.activeRole === account.activeRole ? snapshot.profile : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine !== false);
  const [retry, setRetry] = useState(0);
  const [openSections, setOpenSections] = useState<string[]>(context?.section === 'devices' ? ['devices'] : []);

  useEffect(() => {
    if (context?.section === 'devices') setOpenSections(['devices']);
    if (context?.section) window.requestAnimationFrame(() => document.getElementById(`my-account-${context.section}`)?.scrollIntoView({ block: 'nearest' }));
  }, [context?.section]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot({ userId: account.userId, activeRole: account.activeRole,
      profile: readCachedDesktopAccountProfile({ userId: account.userId, activeRole: account.activeRole }) });
    if (!online) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const runtime = await getRuntimeConfig();
        const session = readDesktopAuthorizationSession();
        if (session.authContext.userId !== account.userId || session.authContext.activeRole !== account.activeRole) {
          throw Object.assign(new Error('AUTHORIZATION_CONTEXT_REQUIRED'), { code: 'AUTHORIZATION_CONTEXT_REQUIRED' });
        }
        const data = await loadDesktopAccountProfile({ baseUrl: resolveDesktopIdentityBaseUrl(runtime), session, signal: controller.signal });
        if (!controller.signal.aborted) {
          cacheDesktopAccountProfile({ userId: account.userId, activeRole: account.activeRole, profile: data });
          setSnapshot({ userId: account.userId, activeRole: account.activeRole, profile: data });
        }
      } catch (cause: any) {
        if (!controller.signal.aborted) setError(['AUTHORIZATION_CONTEXT_REQUIRED', 'CLOUD_ONLINE_IDENTITY_REJECTED'].includes(cause?.code)
          ? '登录资料暂时不可用，请联网后重试。' : '暂时无法读取个人资料，请稍后重试。');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [online, retry, account.userId, account.activeRole]);

  const roles = profile?.eligibleRoles || (account.activeRole ? [account.activeRole] : []);
  const retryProfile = useCallback(() => setRetry(value => value + 1), []);
  const value = (field: string) => profile ? (profile[field] || '未登记') : '暂不可用';

  return <div className="my-account">
    <Card className="my-account__profile">
      <div className="my-account__identity">
        <Avatar size={52} icon={<UserOutlined />} />
        <div><div className="my-account__name">{profile?.name || account.name || '我的账号'}</div>
          <Space wrap size={4}>{roles.map((role: string) => <Tag key={role} color={role === 'super_admin' ? 'gold' : 'blue'}>
            {role === 'super_admin' ? '超级管理员' : '教师'}{roles.length > 1 && role === account.activeRole ? ' · 当前身份' : ''}
          </Tag>)}</Space>
        </div>
      </div>
      {!online && <Alert type="warning" showIcon message={profile ? '当前离线，显示上次读取的个人资料。' : '当前离线，联网后可读取个人资料。'} />}
      {error && online && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={retryProfile}>重试</Button>} />}
      <Skeleton loading={loading && !profile} active paragraph={{ rows: 2 }}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="middle">
          <Descriptions.Item label="账号名">{value('accountName')}</Descriptions.Item>
          <Descriptions.Item label="姓名">{value('name')}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{value('phone')}</Descriptions.Item>
          <Descriptions.Item label="微信号">{value('wechat')}</Descriptions.Item>
          {account.activeRole === 'teacher' && <Descriptions.Item label="任教科目">{value('subject')}</Descriptions.Item>}
        </Descriptions>
      </Skeleton>
    </Card>
    <section id="my-account-devices"><Collapse activeKey={openSections} onChange={keys => setOpenSections(typeof keys === 'string' ? [keys] : keys)}
      items={[{ key: 'devices', label: '登录设备', children: <IdentityDeviceCenter embedded /> }]} /></section>
    <section id="my-account-software-update"><SystemSettings /></section>
  </div>;
};

export default MyAccount;
