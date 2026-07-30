import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Table, Tag, message } from 'antd';
import {
  buildAdminGrantDraft,
  buildRoleReviewDraft,
  roleReviewApplications,
} from '../services/authorityRoleReviewRuntime.mjs';
import AuthorityOutboxPanel from './AuthorityOutboxPanel';

type RoleApplication = {
  applicationId: string;
  authorityId: string;
  userId: string;
  requestedRole: 'student' | 'teacher';
  bindingHint?: string | null;
  status: string;
  createdAt?: string;
};

function bridge() {
  if (!window.desktopAuthority) {
    throw Object.assign(new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE'), {
      code: 'DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE',
    });
  }
  return window.desktopAuthority;
}

const AuthorityRoleApplicationsPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<RoleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [busyId, setBusyId] = useState('');
  const [existingUserId, setExistingUserId] = useState('');

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
      setItems(roleReviewApplications(projection));
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

  const queueDecision = async (application: RoleApplication, decision: 'approve' | 'reject') => {
    if (busyId) return;
    setBusyId(application.applicationId);
    try {
      await bridge().appendDraft(buildRoleReviewDraft(application, decision));
      message.success('\u5ba1\u6838\u8349\u7a3f\u5df2\u52a0\u5165\u672c\u673a\u52a0\u5bc6\u547d\u4ee4\u7bb1\uff0c\u8bf7\u518d\u786e\u8ba4\u53d1\u9001');
    } catch (error: any) {
      message.error(error?.code || error?.message || 'AUTHORITY_ROLE_REVIEW_DRAFT_FAILED');
    } finally {
      setBusyId('');
    }
  };

  const queueAdminGrant = async () => {
    if (busyId) return;
    setBusyId('admin-grant');
    try {
      await bridge().appendDraft(buildAdminGrantDraft(existingUserId));
      setExistingUserId('');
      message.success('\u7ba1\u7406\u5458\u6388\u4e88\u8349\u7a3f\u5df2\u52a0\u5165\u672c\u673a\u52a0\u5bc6\u547d\u4ee4\u7bb1\uff0c\u8bf7\u518d\u786e\u8ba4\u53d1\u9001');
    } catch (error: any) {
      message.error(error?.code || error?.message || 'AUTHORITY_ROLE_ADMIN_GRANT_DRAFT_FAILED');
    } finally {
      setBusyId('');
    }
  };

  if (!visible && !loading) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={'\u6570\u636e\u4e3b\u673a\u89d2\u8272\u7533\u8bf7\u5ba1\u6838'}
        extra={<Button loading={loading} onClick={() => void load()}>{'\u5237\u65b0\u7b7e\u540d\u6295\u5f71'}</Button>}
      >
        <Alert
          type={errorCode ? 'error' : 'info'}
          showIcon
          message={errorCode || '\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u5ba1\u6838\uff1b\u6279\u51c6\u4f1a\u5728\u6743\u5a01\u4e3b\u673a\u4e0a\u4ea7\u751f\u53ef\u8ffd\u6eaf\u7684\u53e0\u52a0\u89d2\u8272\u6388\u6743'}
          description={'\u70b9\u51fb\u6279\u51c6\u6216\u62d2\u7edd\u53ea\u4f1a\u521b\u5efa\u52a0\u5bc6\u8349\u7a3f\uff1b\u5728\u4e0b\u65b9\u786e\u8ba4\u524d\u4e0d\u4f1a\u53d1\u9001\u3002'}
          style={{ marginBottom: 16 }}
        />
        <Card
          size="small"
          title={'\u76f4\u63a5\u6388\u4e88\u7ba1\u7406\u5458'}
          style={{ maxWidth: 560, marginBottom: 16 }}
        >
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <span>{'\u53ea\u80fd\u6388\u4e88\u5df2\u5b58\u5728\u4e14\u5904\u4e8e\u6d3b\u8dc3\u72b6\u6001\u7684\u7528\u6237 ID\uff1b\u4e0d\u4f1a\u521b\u5efa\u7528\u6237\uff0c\u4e5f\u4e0d\u4f1a\u7531\u5c0f\u7a0b\u5e8f\u53d1\u8d77\u3002'}</span>
            <Input
              value={existingUserId}
              onChange={event => setExistingUserId(event.target.value)}
              placeholder={'\u8f93\u5165\u5df2\u5b58\u5728\u7684\u7528\u6237 ID'}
              autoComplete="off"
            />
            <Button
              danger
              loading={busyId === 'admin-grant'}
              onClick={() => void queueAdminGrant()}
            >{'\u521b\u5efa\u7ba1\u7406\u5458\u6388\u4e88\u8349\u7a3f'}</Button>
          </Space>
        </Card>
        {items.length === 0 && !loading
          ? <Empty description={'\u5f53\u524d\u7b7e\u540d\u6295\u5f71\u4e2d\u6ca1\u6709\u5f85\u5ba1\u89d2\u8272\u7533\u8bf7'} />
          : <Table
            rowKey="applicationId"
            loading={loading}
            pagination={{ pageSize: 8 }}
            dataSource={items}
            columns={[
              {
                title: '\u7533\u8bf7\u7528\u6237',
                render: (_value, item) => <div>{item.userId}<br /><small>{item.applicationId}</small></div>,
              },
              {
                title: '\u7533\u8bf7\u89d2\u8272',
                render: (_value, item) => (
                  <Tag color={item.requestedRole === 'teacher' ? 'blue' : 'green'}>
                    {item.requestedRole === 'teacher' ? '\u8001\u5e08' : '\u5b66\u751f'}
                  </Tag>
                ),
              },
              {
                title: '\u53ef\u9009\u6863\u6848\u63d0\u793a',
                dataIndex: 'bindingHint',
                render: value => value || '\u672a\u63d0\u4f9b',
              },
              {
                title: '\u64cd\u4f5c',
                render: (_value, item) => <Space>
                  <Button
                    type="primary"
                    loading={busyId === item.applicationId}
                    onClick={() => void queueDecision(item, 'approve')}
                  >{'\u521b\u5efa\u6279\u51c6\u8349\u7a3f'}</Button>
                  <Button
                    danger
                    loading={busyId === item.applicationId}
                    onClick={() => void queueDecision(item, 'reject')}
                  >{'\u521b\u5efa\u62d2\u7edd\u8349\u7a3f'}</Button>
                </Space>,
              },
            ]}
          />}
      </Card>
      <AuthorityOutboxPanel compact focus="pending" />
    </Space>
  );
};

export default AuthorityRoleApplicationsPanel;
