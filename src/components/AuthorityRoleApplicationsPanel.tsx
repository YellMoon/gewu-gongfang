import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Space, Table, Tag, message } from 'antd';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';

type RoleApplication = {
  applicationId: string;
  requestedIdentity: 'student' | 'teacher' | 'family_member';
  profileMode: 'existing' | 'new';
  bindingHint?: string | null;
  profileName?: string | null;
  profilePhone?: string | null;
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
  const { authorization, authContext } = readDesktopAuthorizationSession();
  if (authContext.activeRole !== 'super_admin'
    || !authContext.eligibleRoles.includes('super_admin')) {
    throw Object.assign(new Error('DESKTOP_SUPER_ADMIN_SESSION_REQUIRED'), {
      code: 'DESKTOP_SUPER_ADMIN_SESSION_REQUIRED',
    });
  }
  const match = /^Bearer (.+)$/u.exec(authorization);
  if (!match) throw Object.assign(new Error('DESKTOP_CLOUD_SESSION_REQUIRED'), { code: 'DESKTOP_CLOUD_SESSION_REQUIRED' });
  return { sessionToken: match[1] };
}

function roleLabel(value: RoleApplication['requestedIdentity']) {
  return value === 'teacher' ? '\u6559\u5e08' : value === 'student' ? '\u5b66\u751f' : '\u5bb6\u5ead\u6210\u5458';
}

function reviewErrorMessage(error: any) {
  const messages: Record<string, string> = {
    CLOUD_ROLE_APPLICATION_PROFILE_ID_CONFLICT: '\u5f85\u521b\u5efa\u7684\u8eab\u4efd\u7f16\u53f7\u5df2\u88ab\u5360\u7528\uff0c\u8bf7\u91cd\u65b0\u63d0\u4ea4\u7533\u8bf7',
    CLOUD_ROLE_APPLICATION_PROFILE_NAME_CONFLICT: '\u540c\u540d\u8eab\u4efd\u5df2\u5b58\u5728\uff0c\u8bf7\u6838\u5bf9\u540e\u5173\u8054\u5df2\u6709\u8eab\u4efd',
    CLOUD_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT: '\u8be5\u624b\u673a\u53f7\u5df2\u7528\u4e8e\u5176\u4ed6\u8eab\u4efd\uff0c\u8bf7\u6838\u5bf9\u7533\u8bf7\u4fe1\u606f',
    CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED: '\u7533\u8bf7\u4e2d\u7684\u624b\u673a\u53f7\u4e0e\u8d26\u53f7\u5df2\u9a8c\u8bc1\u624b\u673a\u53f7\u4e0d\u4e00\u81f4',
    CLOUD_ROLE_APPLICATION_PROFILE_MISMATCH: '\u9009\u62e9\u7684\u8eab\u4efd\u4e0e\u7533\u8bf7\u4eba\u586b\u5199\u7684\u59d3\u540d\u6216\u624b\u673a\u53f7\u4e0d\u4e00\u81f4',
    CLOUD_ROLE_APPLICATION_GUARDIAN_RELATION_REQUIRED: '\u8be5\u624b\u673a\u53f7\u5c1a\u672a\u767b\u8bb0\u4e3a\u6240\u9009\u5b66\u751f\u7684\u76d1\u62a4\u4eba',
    CLOUD_ROLE_APPLICATION_ACCOUNT_ROLE_CONFLICT: '\u8be5\u8d26\u53f7\u5df2\u7ed1\u5b9a\u5176\u4ed6\u8eab\u4efd\uff0c\u8bf7\u5237\u65b0\u540e\u6838\u5bf9',
    CLOUD_ROLE_APPLICATION_NOT_REVIEWABLE: '\u8be5\u7533\u8bf7\u5df2\u5904\u7406\uff0c\u8bf7\u5237\u65b0\u5217\u8868',
  };
  return messages[error?.code] || error?.message || '\u5ba1\u6838\u6682\u65f6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
}

const AuthorityRoleApplicationsPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<RoleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessionInput = cloudSessionInput();
      setVisible(true);
      setItems(await bridge().listRoleApplications(sessionInput));
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
    const profileId = null;
    setBusyId(application.applicationId);
    try {
      const result = await bridge().reviewRoleApplication(application.applicationId, { decision, profileId }, cloudSessionInput());
      if (result?.state !== decision) throw Object.assign(new Error('CLOUD_ROLE_APPLICATION_RESPONSE_INVALID'), { code: 'CLOUD_ROLE_APPLICATION_RESPONSE_INVALID' });
      message.success(decision === 'approved' ? '\u7533\u8bf7\u5df2\u901a\u8fc7' : '\u7533\u8bf7\u5df2\u9a73\u56de');
      await load();
    } catch (error: any) {
      message.error(reviewErrorMessage(error));
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
          message={errorCode || '\u8bf7\u6838\u5bf9\u7533\u8bf7\u4eba\u586b\u5199\u7684\u59d3\u540d\u548c\u624b\u673a\u53f7'}
          description={'\u4e91\u7aef\u4f1a\u7528\u59d3\u540d\u548c\u5df2\u9a8c\u8bc1\u624b\u673a\u53f7\u552f\u4e00\u6838\u5bf9\u5df2\u6709\u8d44\u6599\uff1b\u9996\u6b21\u767b\u8bb0\u65f6\uff0c\u901a\u8fc7\u540e\u4f1a\u81ea\u52a8\u5efa\u7acb\u5e76\u7ed1\u5b9a\u3002'}
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
                title: '\u7533\u8bf7\u4fe1\u606f',
                dataIndex: 'bindingHint',
                render: (value, item) => <Space direction="vertical" size={4}>
                  <span>{item.profileName && item.profilePhone ? `${item.profileName} \u00b7 ${item.profilePhone}` : (value || '\u672a\u63d0\u4f9b')}</span>
                  <span>{item.profileMode === 'existing' ? '\u7533\u8bf7\u4f7f\u7528\u5df2\u6709\u8d44\u6599' : '\u7533\u8bf7\u9996\u6b21\u767b\u8bb0'}</span>
                </Space>,
              },
              {
                title: '\u64cd\u4f5c',
                render: (_value, item) => <Space>
                  <Button
                    type="primary"
                    loading={busyId === item.applicationId}
                    onClick={() => Modal.confirm({ title: '\u786e\u8ba4\u901a\u8fc7\u7533\u8bf7', content: '\u4e91\u7aef\u5c06\u7acb\u5373\u6838\u5bf9\u59d3\u540d\u548c\u5df2\u9a8c\u8bc1\u624b\u673a\u53f7\uff0c\u5e76\u5b8c\u6210\u767b\u8bb0\u6216\u5173\u8054\u3002', onOk: () => queueDecision(item, 'approved') })}
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
