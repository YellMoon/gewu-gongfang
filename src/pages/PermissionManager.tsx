import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PairingReviewPanel from '../components/PairingReviewPanel';
import { AuthorizationUser, ReviewableRole, getMyCapabilities, listUsers, reviewUser } from '../services/authorizationApi';
import { authorizationEmptyText, authorizationErrorText, createAuthorizationPresentation } from '../services/authorizationPresentation.mjs';
import './PermissionManager.css';

type PresentedUser = AuthorizationUser & { roleLabel: string; statusLabel: string; teacherBindingLabel: string; bindingState: string; canReview: boolean; disabled: boolean };
const roleOptions = [
  { value: 'admin', label: '\u666e\u901a\u7ba1\u7406\u5458' },
  { value: 'teacher', label: '\u8001\u5e08' },
  { value: 'student', label: '\u5b66\u751f' },
];

const PermissionManager: React.FC = () => {
  const [users, setUsers] = useState<AuthorizationUser[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ReviewableRole>('student');
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({});

  const canReview = capabilities.includes('users:review');
  const presentation = useMemo(() => createAuthorizationPresentation({
    capabilities, users: users.map(user => ({ ...user, binding_error: bindingErrors[user.id] })),
  }), [capabilities, users, bindingErrors]);
  const rows = presentation.rows as PresentedUser[];
  const selected = rows.find(row => row.id === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true); setErrorCode('');
    try {
      const [userResult, effectiveCapabilities] = await Promise.all([
        listUsers({ search, role, status, pageSize: 100 }), getMyCapabilities(),
      ]);
      setUsers(userResult.users); setCapabilities(effectiveCapabilities);
      setSelectedId(current => userResult.users.some(user => user.id === current) ? current : (userResult.users[0]?.id || ''));
    } catch (error: any) { setErrorCode(error?.code || 'NETWORK_ERROR'); }
    finally { setLoading(false); }
  }, [search, role, status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selected && ['admin', 'teacher', 'student'].includes(selected.role)) setSelectedRole(selected.role as ReviewableRole);
    else setSelectedRole('student');
  }, [selectedId, selected?.role]);

  const confirmReview = () => {
    if (!selected || !canReview || !selected.canReview) return;
    const roleLabel = roleOptions.find(option => option.value === selectedRole)?.label;
    Modal.confirm({
      title: '\u786e\u8ba4\u7528\u6237\u89d2\u8272',
      content: selectedRole === 'teacher'
        ? `\u5c06 ${selected.name || selected.nickname || selected.phone || selected.id} \u8bbe\u4e3a${roleLabel}\u3002\u7cfb\u7edf\u4f1a\u6839\u636e\u624b\u673a\u53f7\u6821\u9a8c\u5e76\u7ed1\u5b9a\u552f\u4e00 teacher_id\u3002`
        : `\u5c06 ${selected.name || selected.nickname || selected.phone || selected.id} \u8bbe\u4e3a${roleLabel}\uff1f`,
      okText: '\u786e\u8ba4\u5ba1\u6838', cancelText: '\u53d6\u6d88',
      async onOk() {
        setSaving(true); setErrorCode('');
        try {
          await reviewUser(selected.id, selectedRole);
          setBindingErrors(previous => { const next = { ...previous }; delete next[selected.id]; return next; });
          message.success('\u7528\u6237\u89d2\u8272\u5df2\u66f4\u65b0'); await load();
        } catch (error: any) {
          const code = error?.code || 'NETWORK_ERROR'; setErrorCode(code);
          if (['TEACHER_NOT_FOUND', 'DUPLICATE_TEACHER_PHONE'].includes(code)) setBindingErrors(previous => ({ ...previous, [selected.id]: code }));
          throw error;
        } finally { setSaving(false); }
      },
    });
  };

  const columns: ColumnsType<PresentedUser> = [
    { title: '\u7528\u6237', key: 'identity', render: (_, row) => <div><strong>{row.name || row.nickname || '\u672a\u586b\u59d3\u540d'}</strong><div className="authorization-muted">{row.phone || '\u672a\u7ed1\u5b9a\u624b\u673a\u53f7'}</div></div> },
    { title: '\u89d2\u8272', dataIndex: 'roleLabel', key: 'role' },
    { title: '\u72b6\u6001', key: 'status', render: (_, row) => <Tag color={row.disabled ? 'default' : row.review_status === 'pending' ? 'gold' : 'green'}>{row.statusLabel}</Tag> },
    { title: '\u6559\u5e08\u7ed1\u5b9a', key: 'binding', responsive: ['md'], render: (_, row) => <span className={`authorization-binding ${row.bindingState}`}>{row.teacherBindingLabel}</span> },
    { title: '\u64cd\u4f5c', key: 'action', render: (_, row) => <Button disabled={saving} onClick={() => setSelectedId(row.id)}>{canReview ? '\u5ba1\u6838 / \u67e5\u770b' : '\u67e5\u770b'}</Button> },
  ];
  const pendingCount = rows.filter(row => row.review_status === 'pending').length;
  const teacherCount = rows.filter(row => row.role === 'teacher').length;
  const disabledCount = rows.filter(row => row.disabled).length;

  return <main className="authorization-workbench">
    <div className="authorization-heading"><div><Typography.Title level={2}>\u7528\u6237\u4e0e\u6743\u9650</Typography.Title><Typography.Paragraph type="secondary">\u7528\u6237\u7c7b\u578b\u3001\u6570\u636e\u8303\u56f4\u4e0e\u6559\u5e08\u8eab\u4efd\u7531\u7edf\u4e00\u6388\u6743\u89c4\u5219\u7ba1\u7406\u3002</Typography.Paragraph></div></div>
    {!canReview && !loading && !errorCode && <Alert showIcon type="info" message="\u5f53\u524d\u4e3a\u53ea\u8bfb\u89c6\u56fe" description="\u666e\u901a\u7ba1\u7406\u5458\u53ef\u67e5\u770b\u7528\u6237\u5206\u7c7b\uff0c\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u4ee5\u5ba1\u6838\u6216\u53d8\u66f4\u89d2\u8272\u3002" />}
    {errorCode && <Alert className="authorization-alert" showIcon type="error" message={authorizationErrorText(errorCode)} action={<Button onClick={load}>\u91cd\u8bd5</Button>} />}
    <Row gutter={[12, 12]} className="authorization-summary">
      <Col xs={12} md={6}><Card><Statistic title="\u5f53\u524d\u7ed3\u679c" value={rows.length} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="\u5f85\u5ba1\u6838" value={pendingCount} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="\u8001\u5e08" value={teacherCount} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="\u5df2\u505c\u7528" value={disabledCount} /></Card></Col>
    </Row>
    <Card className="authorization-list-card">
      <div className="authorization-filters">
        <Input.Search aria-label="\u641c\u7d22\u7528\u6237" placeholder="\u59d3\u540d\u6216\u624b\u673a\u53f7" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={setSearch} enterButton="\u641c\u7d22" allowClear />
        <Select aria-label="\u7b5b\u9009\u89d2\u8272" value={role} onChange={setRole} options={[{ value: '', label: '\u5168\u90e8\u89d2\u8272' }, { value: 'super_admin', label: '\u8d85\u7ea7\u7ba1\u7406\u5458' }, ...roleOptions, { value: 'pending', label: '\u5f85\u5206\u7c7b' }]} />
        <Select aria-label="\u7b5b\u9009\u72b6\u6001" value={status} onChange={setStatus} options={[{ value: '', label: '\u5168\u90e8\u72b6\u6001' }, { value: 'pending', label: '\u5f85\u5ba1\u6838' }, { value: 'approved', label: '\u5df2\u901a\u8fc7' }, { value: 'rejected', label: '\u5df2\u62d2\u7edd' }]} />
      </div>
      <Table<PresentedUser> rowKey="id" loading={loading || saving} dataSource={errorCode ? [] : rows} columns={columns} pagination={false} locale={{ emptyText: <Empty description={authorizationEmptyText({ search, role, status })} /> }} onRow={row => ({ onClick: () => setSelectedId(row.id) })} />
    </Card>
    {selected && <Card className="authorization-detail" title="\u7528\u6237\u8be6\u60c5">
      <Descriptions column={{ xs: 1, md: 2 }}><Descriptions.Item label="\u7528\u6237">{selected.name || selected.nickname || selected.id}</Descriptions.Item><Descriptions.Item label="\u624b\u673a\u53f7">{selected.phone || '-'}</Descriptions.Item><Descriptions.Item label="\u5f53\u524d\u89d2\u8272">{selected.roleLabel}</Descriptions.Item><Descriptions.Item label="\u5ba1\u6838\u72b6\u6001">{selected.statusLabel}</Descriptions.Item><Descriptions.Item label="teacher_id">{selected.teacherBindingLabel}</Descriptions.Item></Descriptions>
      {['teacher-not-found', 'duplicate-teacher-phone'].includes(selected.bindingState) && <Alert className="authorization-alert" type="warning" showIcon message={selected.teacherBindingLabel} description="\u8bf7\u5148\u786e\u8ba4\u7528\u6237\u624b\u673a\u53f7\u4e0e\u6559\u5e08\u6863\u6848\u4e00\u81f4\uff0c\u4e14\u53ea\u5bf9\u5e94\u4e00\u6761\u6559\u5e08\u8bb0\u5f55\u3002" />}
      {canReview && <Space className="authorization-review-actions" wrap>
        <Select aria-label="\u9009\u62e9\u7528\u6237\u89d2\u8272" value={selectedRole} options={roleOptions} onChange={setSelectedRole} disabled={saving || !selected.canReview} />
        <Button type="primary" onClick={confirmReview} loading={saving} disabled={saving || !selected.canReview}>\u5ba1\u6838\u5e76\u4fdd\u5b58</Button>
        {selected.disabled && <Tag>\u5df2\u505c\u7528\u7528\u6237\u4e0d\u53ef\u53d8\u66f4</Tag>}
      </Space>}
    </Card>}
    {canReview && <PairingReviewPanel />}
  </main>;
};

export default PermissionManager;
