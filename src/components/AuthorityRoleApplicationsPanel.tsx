import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Modal, Space, Table, Tag, message } from 'antd';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';

type RoleApplication = {
  applicationId: string;
  requestedIdentity: 'student' | 'teacher' | 'family_member';
  profileMode: 'existing' | 'new';
  bindingHint?: string | null;
  status: string;
  submittedAt?: string;
};

function bridge() {
  if (!window.desktopAuthority) {
    throw Object.assign(new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE'), {
      code: 'DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE',
    });
  }
  return window.desktopAuthority;
}

function cloudSessionInput() {
  const authorization = readDesktopAuthorizationSession().authorization;
  const match = /^Bearer (.+)$/u.exec(authorization);
  if (!match) throw Object.assign(new Error('DESKTOP_CLOUD_SESSION_REQUIRED'), { code: 'DESKTOP_CLOUD_SESSION_REQUIRED' });
  return { sessionToken: match[1] };
}

function roleLabel(value: RoleApplication['requestedIdentity']) {
  return value === 'teacher' ? '\u8001\u5e08' : value === 'student' ? '\u5b66\u751f' : '\u5bb6\u5ead\u6210\u5458';
}

const AuthorityRoleApplicationsPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<RoleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [busyId, setBusyId] = useState('');
  const [profileIds, setProfileIds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const projection = await bridge().readProjection();
      if (projection.role !== 'super_admin') {
        setVisible(false);
        setItems([]);
        setErrorCode('');
        return;
      }
      setVisible(true);
      setItems(await bridge().listRoleApplications(cloudSessionInput()));
      setErrorCode('');
    } catch (error: any) {
      setVisible(true);
      setItems([]);
      setErrorCode(error?.code || error?.message || 'AUTHORITY_ROLE_PROJECTION_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const queueDecision = async (application: RoleApplication, decision: 'approved' | 'rejected') => {
    if (busyId) return;
    const profileId = decision === 'approved' ? String(profileIds[application.applicationId] || '').trim() : null;
    if (decision === 'approved' && !profileId) {
      message.warning('\u8bf7\u586b\u5199\u5df2\u5b58\u5728\u7684\u6559\u5e08\u6216\u5b66\u751f\u6863\u6848\u7f16\u53f7');
      return;
    }
    setBusyId(application.applicationId);
    try {
      const result = await bridge().reviewRoleApplication(application.applicationId, { decision, profileId }, cloudSessionInput());
      if (result?.state !== decision) throw Object.assign(new Error('CLOUD_ROLE_APPLICATION_RESPONSE_INVALID'), { code: 'CLOUD_ROLE_APPLICATION_RESPONSE_INVALID' });
      message.success(decision === 'approved' ? '\u8eab\u4efd\u7ed1\u5b9a\u5df2\u5b8c\u6210' : '\u7533\u8bf7\u5df2\u9a73\u56de');
      await load();
    } catch (error: any) {
      message.error(error?.code || error?.message || 'AUTHORITY_ROLE_REVIEW_DRAFT_FAILED');
    } finally {
      setBusyId('');
    }
  };

  if (!visible && !loading) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={'\u4e91\u7aef\u8d26\u6237\u8eab\u4efd\u7533\u8bf7\u5ba1\u6838'}
        extra={<Button loading={loading} onClick={() => void load()}>{'\u5237\u65b0\u5f85\u5ba1\u5217\u8868'}</Button>}
      >
        <Alert
          type={errorCode ? 'error' : 'info'}
          showIcon
          message={errorCode || '\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u5ba1\u6838\uff1b\u5ba1\u6838\u7ed3\u679c\u7531\u4e91\u7aef\u8d26\u6237\u4e0e\u6863\u6848\u5173\u7cfb\u88c1\u51b3'}
          description={'\u6279\u51c6\u524d\u9700\u586b\u5199\u540c\u79df\u6237\u7684\u5b9e\u9645\u6863\u6848\u7f16\u53f7\uff1b\u4e91\u7aef\u4f1a\u518d\u6821\u9a8c\u684c\u9762\u4f1a\u8bdd\u3001\u8d85\u7ea7\u7ba1\u7406\u5458\u8eab\u4efd\u4e0e\u6863\u6848\u7c7b\u578b\u3002'}
          style={{ marginBottom: 16 }}
        />
        {items.length === 0 && !loading
          ? <Empty description={'\u5f53\u524d\u6ca1\u6709\u5f85\u5ba1\u7684\u8eab\u4efd\u7533\u8bf7'} />
          : <Table
            rowKey="applicationId"
            loading={loading}
            pagination={{ pageSize: 8 }}
            dataSource={items}
            columns={[
              {
                title: '\u7533\u8bf7\u7f16\u53f7',
                render: (_value, item) => <div>{item.applicationId}</div>,
              },
              {
                title: '\u7533\u8bf7\u89d2\u8272',
                render: (_value, item) => (
                  <Tag color={item.requestedIdentity === 'teacher' ? 'blue' : 'green'}>
                    {roleLabel(item.requestedIdentity)}
                  </Tag>
                ),
              },
              {
                title: '\u6863\u6848\u4fe1\u606f',
                dataIndex: 'bindingHint',
                render: (value, item) => <Space direction="vertical" size={4}>
                  <span>{value || '\u672a\u63d0\u4f9b'}</span>
                  <Input value={profileIds[item.applicationId] || ''} onChange={event => setProfileIds(current => ({ ...current, [item.applicationId]: event.target.value }))} placeholder={item.profileMode === 'new' ? '\u5148\u65b0\u5efa\u6863\u6848\uff0c\u518d\u586b\u5165\u7f16\u53f7' : '\u586b\u5165\u5df2\u6709\u6863\u6848\u7f16\u53f7'} />
                </Space>,
              },
              {
                title: '\u64cd\u4f5c',
                render: (_value, item) => <Space>
                  <Button
                    type="primary"
                    loading={busyId === item.applicationId}
                    onClick={() => Modal.confirm({ title: '\u786e\u8ba4\u7ed1\u5b9a\u8eab\u4efd', content: '\u7ed1\u5b9a\u540e\u4f1a\u7acb\u5373\u63d0\u4ea4\u4e91\u7aef\u6821\u9a8c\u3002', onOk: () => queueDecision(item, 'approved') })}
                  >{'\u786e\u8ba4\u901a\u8fc7'}</Button>
                  <Button
                    danger
                    loading={busyId === item.applicationId}
                    onClick={() => Modal.confirm({ title: '\u786e\u8ba4\u9a73\u56de\u7533\u8bf7', content: '\u9a73\u56de\u540e\u7533\u8bf7\u4eba\u53ef\u91cd\u65b0\u63d0\u4ea4\u3002', onOk: () => queueDecision(item, 'rejected') })}
                  >{'\u9a73\u56de'}</Button>
                </Space>,
              },
            ]}
          />}
      </Card>
    </Space>
  );
};

export default AuthorityRoleApplicationsPanel;
