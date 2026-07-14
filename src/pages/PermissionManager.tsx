import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PairingReviewPanel from '../components/PairingReviewPanel';
import { AuthorizationUser, ReviewableRole, disableUser, getMyCapabilities, listUsers, reviewUser } from '../services/authorizationApi';
import { authorizationEmptyText, authorizationErrorText, createAuthorizationPresentation } from '../services/authorizationPresentation.mjs';
import { createLatestRequestCoordinator } from '../services/authorizationRequestCoordinator.mjs';
import './PermissionManager.css';

type PresentedUser = AuthorizationUser & { roleLabel: string; statusLabel: string; teacherBindingLabel: string; bindingState: string; canReview: boolean; disabled: boolean };
const roleOptions = [
  { value: 'admin', label: '普通管理员' },
  { value: 'teacher', label: '老师' },
  { value: 'student', label: '学生' },
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
  const requestCoordinator = useRef(createLatestRequestCoordinator());

  const canReview = capabilities.includes('users:review');
  const presentation = useMemo(() => createAuthorizationPresentation({
    capabilities, users: users.map(user => ({ ...user, binding_error: bindingErrors[user.id] })),
  }), [capabilities, users, bindingErrors]);
  const rows = presentation.rows as PresentedUser[];
  const selected = rows.find(row => row.id === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true); setErrorCode('');
    await requestCoordinator.current.run(() => Promise.all([
        listUsers({ search, role, status, pageSize: 100 }), getMyCapabilities(),
      ]), {
      success: ([userResult, effectiveCapabilities]: any) => {
        setUsers(userResult.users); setCapabilities(effectiveCapabilities);
        setSelectedId(current => userResult.users.some((user: AuthorizationUser) => user.id === current) ? current : (userResult.users[0]?.id || ''));
      },
      error: (error: any) => setErrorCode(error?.code || 'NETWORK_ERROR'),
      settled: () => setLoading(false),
    });
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
      title: '确认用户角色',
      content: selectedRole === 'teacher'
        ? `将 ${selected.name || selected.nickname || selected.phone || selected.id} 设为${roleLabel}。系统会根据手机号校验并绑定唯一 teacher_id。`
        : `将 ${selected.name || selected.nickname || selected.phone || selected.id} 设为${roleLabel}？`,
      okText: '确认审核', cancelText: '取消',
      async onOk() {
        setSaving(true); setErrorCode('');
        try {
          await reviewUser(selected.id, selectedRole);
          setBindingErrors(previous => { const next = { ...previous }; delete next[selected.id]; return next; });
          message.success('用户角色已更新'); await load();
        } catch (error: any) {
          const code = error?.code || 'NETWORK_ERROR'; setErrorCode(code);
          if (['TEACHER_NOT_FOUND', 'TEACHER_PHONE_NOT_UNIQUE', 'DUPLICATE_TEACHER_PHONE'].includes(code)) setBindingErrors(previous => ({ ...previous, [selected.id]: code }));
          throw error;
        } finally { setSaving(false); }
      },
    });
  };
  const confirmDisable = () => {
    if (!selected || !canReview || !selected.canReview) return;
    Modal.confirm({
      title: '确认停用用户',
      content: `停用 ${selected.name || selected.nickname || selected.phone || selected.id} 后，该用户将无法登录桌面端或小程序。`,
      okText: '确认停用', okButtonProps: { danger: true }, cancelText: '取消',
      async onOk() {
        setSaving(true); setErrorCode('');
        try { await disableUser(selected.id); message.success('用户已停用'); await load(); }
        catch (error: any) { setErrorCode(error?.code || 'NETWORK_ERROR'); throw error; }
        finally { setSaving(false); }
      },
    });
  };

  const columns: ColumnsType<PresentedUser> = [
    { title: '用户', key: 'identity', render: (_, row) => <div><strong>{row.name || row.nickname || '未填姓名'}</strong><div className="authorization-muted">{row.phone || '未绑定手机号'}</div></div> },
    { title: '角色', dataIndex: 'roleLabel', key: 'role' },
    { title: '状态', key: 'status', render: (_, row) => <Tag color={row.disabled ? 'default' : row.review_status === 'pending' ? 'gold' : 'green'}>{row.statusLabel}</Tag> },
    { title: '教师绑定', key: 'binding', responsive: ['md'], render: (_, row) => <span className={`authorization-binding ${row.bindingState}`}>{row.teacherBindingLabel}</span> },
    { title: '操作', key: 'action', render: (_, row) => <Button disabled={saving} onClick={() => setSelectedId(row.id)}>{canReview ? '审核 / 查看' : '查看'}</Button> },
  ];
  const pendingCount = rows.filter(row => row.review_status === 'pending').length;
  const teacherCount = rows.filter(row => row.role === 'teacher').length;
  const disabledCount = rows.filter(row => row.disabled).length;

  return <main className="authorization-workbench">
    <div className="authorization-heading"><div><Typography.Title level={2}>用户与权限</Typography.Title><Typography.Paragraph type="secondary">用户类型、数据范围与教师身份由统一授权规则管理。</Typography.Paragraph></div></div>
    {!canReview && !loading && !errorCode && <Alert showIcon type="info" message="当前为只读视图" description="普通管理员可查看用户分类，仅超级管理员可以审核或变更角色。" />}
    {errorCode && <Alert className="authorization-alert" showIcon type="error" message={authorizationErrorText(errorCode)} action={<Button onClick={load}>重试</Button>} />}
    <Row gutter={[12, 12]} className="authorization-summary">
      <Col xs={12} md={6}><Card><Statistic title="当前结果" value={rows.length} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="待审核" value={pendingCount} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="老师" value={teacherCount} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="已停用" value={disabledCount} /></Card></Col>
    </Row>
    <Card className="authorization-list-card">
      <div className="authorization-filters">
        <Input.Search aria-label="搜索用户" placeholder="姓名或手机号" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onSearch={setSearch} enterButton="搜索" allowClear />
        <Select aria-label="筛选角色" value={role} onChange={setRole} options={[{ value: '', label: '全部角色' }, { value: 'super_admin', label: '超级管理员' }, ...roleOptions, { value: 'pending', label: '待分类' }]} />
        <Select aria-label="筛选状态" value={status} onChange={setStatus} options={[{ value: '', label: '全部状态' }, { value: 'pending', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已拒绝' }]} />
      </div>
      <Table<PresentedUser> rowKey="id" loading={loading || saving} dataSource={errorCode ? [] : rows} columns={columns} pagination={false} locale={{ emptyText: <Empty description={authorizationEmptyText({ search, role, status })} /> }} onRow={row => ({ onClick: () => setSelectedId(row.id) })} />
    </Card>
    {selected && <Card className="authorization-detail" title="用户详情">
      <Descriptions column={{ xs: 1, md: 2 }}><Descriptions.Item label="用户">{selected.name || selected.nickname || selected.id}</Descriptions.Item><Descriptions.Item label="手机号">{selected.phone || '-'}</Descriptions.Item><Descriptions.Item label="当前角色">{selected.roleLabel}</Descriptions.Item><Descriptions.Item label="审核状态">{selected.statusLabel}</Descriptions.Item><Descriptions.Item label="teacher_id">{selected.teacherBindingLabel}</Descriptions.Item></Descriptions>
      {['teacher-not-found', 'duplicate-teacher-phone'].includes(selected.bindingState) && <Alert className="authorization-alert" type="warning" showIcon message={selected.teacherBindingLabel} description="请先确认用户手机号与教师档案一致，且只对应一条教师记录。" />}
      {canReview && <Space className="authorization-review-actions" wrap>
        <Select aria-label="选择用户角色" value={selectedRole} options={roleOptions} onChange={setSelectedRole} disabled={saving || !selected.canReview} />
        <Button type="primary" onClick={confirmReview} loading={saving} disabled={saving || !selected.canReview}>审核并保存</Button>
        <Button className="authorization-disable-action" danger onClick={confirmDisable} disabled={saving || !selected.canReview}>停用用户</Button>
        {selected.disabled && <Tag>已停用用户不可变更</Tag>}
      </Space>}
    </Card>}
    {canReview && <PairingReviewPanel users={rows} />}
  </main>;
};

export default PermissionManager;
