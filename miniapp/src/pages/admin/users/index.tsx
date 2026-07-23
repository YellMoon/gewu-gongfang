import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Button, Input, Picker, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { adminApi, applicationApi, wechatBindingApi } from '../../../utils/api';
import { fetchPermissions, getCurrentUser } from '../../../utils/permission';
import { createLatestRequestCoordinator, createOperationLocks } from './adminReviewCoordinator';
import './index.scss';

const SUPER_ADMIN_PHONE = '13732250653';
const roles = ['admin', 'teacher', 'student'] as const;
const roleLabels: Record<string, string> = {
  super_admin: '\u8d85\u7ea7\u7ba1\u7406\u5458', admin: '\u666e\u901a\u7ba1\u7406\u5458',
  teacher: '\u8001\u5e08', student: '\u5b66\u751f', pending: '\u5f85\u5206\u7c7b',
};
const statusLabels: Record<string, string> = {
  pending: '\u5f85\u5ba1\u6838', approved: '\u5df2\u901a\u8fc7', rejected: '\u5df2\u62d2\u7edd', disabled: '\u5df2\u505c\u7528',
  submitted: '\u5f85\u5ba1\u6838', provisioning: '\u4e3b\u673a\u5efa\u6863\u4e2d',
  manual_resolution_required: '\u9700\u4eba\u5de5\u5904\u7406', withdrawn: '\u5df2\u64a4\u56de',
};
const statusFilters = ['', 'pending', 'approved', 'rejected'];

function errorMessage(result: any, fallback: string) {
  const code = result?.code;
  if (code === 'TEACHER_NOT_FOUND' || code === 'TEACHER_BINDING_NOT_FOUND') return '\u672a\u627e\u5230\u4e0e\u8be5\u624b\u673a\u53f7\u552f\u4e00\u5339\u914d\u7684\u8001\u5e08\u6863\u6848';
  if (code === 'TEACHER_PHONE_NOT_UNIQUE' || code === 'TEACHER_BINDING_AMBIGUOUS') return '\u8be5\u624b\u673a\u53f7\u5339\u914d\u591a\u4e2a\u8001\u5e08\u6863\u6848\uff0c\u8bf7\u5148\u6574\u7406\u6570\u636e';
  if (code === 'SUPER_ADMIN_IMMUTABLE' || code === 'SUPER_ADMIN_IDENTITY_PROTECTED') return '\u56fa\u5b9a\u8d85\u7ea7\u7ba1\u7406\u5458\u4e0d\u53ef\u53d8\u66f4';
  return result?.error || result?.message || fallback;
}

export default function AdminUsersPage() {
  const currentUser = getCurrentUser();
  const [users, setUsers] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [wechatBindings, setWechatBindings] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [lockedKeys, setLockedKeys] = useState<string[]>([]);
  const loadCoordinator = useRef(createLatestRequestCoordinator());
  const operationLocks = useRef(createOperationLocks());
  const queryRef = useRef({ submittedSearch, status });
  queryRef.current = { submittedSearch, status };

  const canReview = capabilities.includes('users:review');
  const canReviewApplications = capabilities.includes('applications:review');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    await loadCoordinator.current.run(async () => {
      const permissionResult = await fetchPermissions();
      const nextCapabilities = permissionResult.capabilities || [];
      const canRead = nextCapabilities.includes('business:all');
      if (!canRead) throw new Error('\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u67e5\u770b\u7528\u6237\u5206\u7c7b');
      const query = queryRef.current;
      const [userResult, applicationResult, bindingResult] = await Promise.all([
        adminApi.getUsers({ page: 1, search: query.submittedSearch, review_status: query.status }),
        nextCapabilities.includes('applications:review') ? applicationApi.adminList() : Promise.resolve({ success: true, data: { items: [] } }),
        wechatBindingApi.adminList(),
      ]);
      if (!userResult.success) throw new Error(errorMessage(userResult, '\u7528\u6237\u52a0\u8f7d\u5931\u8d25'));
      if (!applicationResult.success) throw new Error(errorMessage(applicationResult, '\u7533\u8bf7\u52a0\u8f7d\u5931\u8d25'));
      if (!bindingResult.success) throw new Error(errorMessage(bindingResult, '\u5fae\u4fe1\u7ed1\u5b9a\u7533\u8bf7\u52a0\u8f7d\u5931\u8d25'));
      const applicationResponse: any = applicationResult;
      const bindingResponse: any = bindingResult;
      return {
        nextCapabilities,
        users: userResult.data?.users || [],
        applications: applicationResponse.data?.items || applicationResponse.items || [],
        wechatBindings: bindingResponse.data?.items || bindingResponse.items || [],
      };
    }, result => {
      setCapabilities(result.nextCapabilities);
      setUsers(result.users);
      setApplications(result.applications);
      setWechatBindings(result.wechatBindings);
    }, (caught: any) => {
      setCapabilities([]);
      setError(caught?.message || '\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
      setUsers([]);
      setApplications([]);
      setWechatBindings([]);
    }, () => {
      setLoading(false);
    });
  }, []);

  const runLocked = useCallback(async (key: string, operation: () => Promise<void>) => {
    if (operationLocks.current.isLocked(key)) return false;
    setLockedKeys(keys => [...keys, key]);
    try {
      return await operationLocks.current.run(key, operation);
    } finally {
      setLockedKeys(keys => keys.filter(value => value !== key));
    }
  }, []);

  useEffect(() => { void load(); }, [load, status, submittedSearch]);

  const reviewUser = async (user: any, role: typeof roles[number]) => {
    if (!canReview) return;
    await runLocked(`user:${user.id}`, async () => {
      const teacherNotice = role === 'teacher' ? '\n\u7cfb\u7edf\u5c06\u6309\u624b\u673a\u53f7\u7ed1\u5b9a\u552f\u4e00 teacher_id\u3002' : '';
      const modal = await Taro.showModal({ title: '\u786e\u8ba4\u7528\u6237\u5206\u7c7b', content: `\u5c06 ${user.name || user.phone || '\u8be5\u7528\u6237'} \u8bbe\u4e3a${roleLabels[role]}\uff1f${teacherNotice}` });
      if (!modal.confirm) return;
      const result: any = await adminApi.reviewUser(user.id, role);
      if (!result.success) return void Taro.showToast({ title: errorMessage(result, '\u5ba1\u6838\u5931\u8d25'), icon: 'none' });
      Taro.showToast({ title: '\u5df2\u5b8c\u6210\u5206\u7c7b', icon: 'success' });
      await load();
    });
  };

  const disableUser = async (user: any) => {
    if (!canReview || user.phone === SUPER_ADMIN_PHONE) return;
    await runLocked(`user:${user.id}`, async () => {
      const modal = await Taro.showModal({ title: '\u505c\u7528\u7528\u6237', content: `\u786e\u8ba4\u505c\u7528 ${user.name || user.phone}\uff1f\u505c\u7528\u540e\u5c06\u65e0\u6cd5\u767b\u5f55\u3002` });
      if (!modal.confirm) return;
      const result: any = await adminApi.disableUser(user.id);
      if (!result.success) return void Taro.showToast({ title: errorMessage(result, '\u505c\u7528\u5931\u8d25'), icon: 'none' });
      Taro.showToast({ title: '\u5df2\u505c\u7528', icon: 'success' });
      await load();
    });
  };

  const reviewApplication = async (application: any, action: 'approve' | 'reject' | 'retry') => {
    if (!canReviewApplications) return;
    await runLocked(`application:${application.id}`, async () => {
      let reason = '';
      if (action === 'reject') {
        const modal: any = await Taro.showModal({
          title: '\u9000\u56de\u7533\u8bf7',
          content: '',
          editable: true,
          placeholderText: '\u8bf7\u586b\u5199\u5177\u4f53\u9000\u56de\u539f\u56e0',
        } as any);
        if (!modal.confirm) return;
        reason = String(modal.content || '').trim();
        if (reason.length < 2) {
          Taro.showToast({ title: '\u8bf7\u586b\u5199\u81f3\u5c11 2 \u4e2a\u5b57\u7684\u9000\u56de\u539f\u56e0', icon: 'none' });
          return;
        }
      } else {
        const modal = await Taro.showModal({
          title: action === 'approve' ? '\u6279\u51c6\u7533\u8bf7' : '\u91cd\u8bd5\u4e3b\u673a\u5efa\u6863',
          content: action === 'approve'
            ? '\u6279\u51c6\u540e\u5c06\u7531\u6570\u636e\u4e3b\u673a\u5efa\u7acb\u6216\u7ed1\u5b9a\u6743\u5a01\u6863\u6848\uff0c\u662f\u5426\u7ee7\u7eed\uff1f'
            : '\u5c06\u91cd\u65b0\u63d0\u4ea4\u539f\u5efa\u6863\u4efb\u52a1\uff0c\u662f\u5426\u7ee7\u7eed\uff1f',
        });
        if (!modal.confirm) return;
      }

      const result: any = action === 'approve'
        ? await applicationApi.approveApplication(application.id, application.revision)
        : action === 'reject'
          ? await applicationApi.rejectApplication(application.id, application.revision, reason)
          : await applicationApi.retryApplication(application.id, application.revision);
      if (!result.success) {
        Taro.showToast({ title: errorMessage(result, '\u7533\u8bf7\u5904\u7406\u5931\u8d25'), icon: 'none' });
        return;
      }
      Taro.showToast({ title: '\u7533\u8bf7\u72b6\u6001\u5df2\u66f4\u65b0', icon: 'success' });
      await load();
    });
  };

  const reviewBinding = async (binding: any, action: 'approve' | 'reject') => {
    if (!canReview) return;
    await runLocked(`binding:${binding.id}`, async () => {
      let reason = '';
      if (action === 'reject') {
        const modal: any = await Taro.showModal({
          title: '\u62d2\u7edd\u5fae\u4fe1\u7ed1\u5b9a',
          content: '',
          editable: true,
          placeholderText: '\u8bf7\u586b\u5199\u62d2\u7edd\u539f\u56e0',
        } as any);
        if (!modal.confirm) return;
        reason = String(modal.content || '').trim();
        if (reason.length < 2) {
          Taro.showToast({ title: '\u8bf7\u586b\u5199\u81f3\u5c11 2 \u4e2a\u5b57\u7684\u62d2\u7edd\u539f\u56e0', icon: 'none' });
          return;
        }
      } else {
        const modal = await Taro.showModal({
          title: '\u6279\u51c6\u5fae\u4fe1\u7ed1\u5b9a',
          content: `\u786e\u8ba4\u5c06 ${binding.phoneMasked || '\u8be5\u624b\u673a\u53f7'} \u7684\u8d26\u53f7\u7ed1\u5b9a\u5230\u672c\u6b21\u7533\u8bf7\u7684\u5fae\u4fe1\uff1f`,
        });
        if (!modal.confirm) return;
      }
      const result: any = action === 'approve'
        ? await wechatBindingApi.approve(binding.id, binding.revision)
        : await wechatBindingApi.reject(binding.id, binding.revision, reason);
      if (!result.success) {
        Taro.showToast({ title: errorMessage(result, '\u5fae\u4fe1\u7ed1\u5b9a\u5ba1\u6838\u5931\u8d25'), icon: 'none' });
        return;
      }
      Taro.showToast({ title: action === 'approve' ? '\u5df2\u6279\u51c6\u7ed1\u5b9a' : '\u5df2\u62d2\u7edd\u7ed1\u5b9a', icon: 'success' });
      await load();
    });
  };

  const currentRole = currentUser?.user_type;
  return <View className="admin-page">
    <View className="admin-header"><View><Text className="admin-title">{'\u7528\u6237\u6743\u9650\u5ba1\u6838'}</Text><Text className="admin-subtitle">{'\u6309\u89d2\u8272\u7edf\u4e00\u5206\u7c7b\uff0c\u8001\u5e08\u5fc5\u987b\u7ed1\u5b9a\u552f\u4e00 teacher_id'}</Text></View></View>
    {currentRole === 'admin' && !canReview ? <View className="read-only-notice">{'\u666e\u901a\u7ba1\u7406\u5458\u53ef\u67e5\u770b\u5206\u7c7b\uff0c\u4ec5\u56fa\u5b9a\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u5ba1\u6838\u6216\u505c\u7528\u7528\u6237\u3002'}</View> : null}
    <View className="binding-review-section">
      <View className="application-review-heading">
        <Text className="application-review-title">{'\u5fae\u4fe1\u7ed1\u5b9a\u7533\u8bf7'}</Text>
        <Text className="application-review-count">{wechatBindings.length}</Text>
      </View>
      {currentRole === 'admin' && !canReview ? <Text className="binding-read-only">{'\u666e\u901a\u7ba1\u7406\u5458\u53ef\u67e5\u770b\u8131\u654f\u7533\u8bf7\uff0c\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u6279\u51c6\u6216\u62d2\u7edd\u3002'}</Text> : null}
      {!loading && !error && wechatBindings.length === 0 ? <View className="empty compact">{'\u6682\u65e0\u5f85\u5ba1\u6838\u7684\u5fae\u4fe1\u7ed1\u5b9a\u7533\u8bf7'}</View> : null}
      {!loading && !error ? wechatBindings.map(binding => {
        const bindingLocked = lockedKeys.includes(`binding:${binding.id}`);
        return <View key={binding.id} className="binding-card">
          <View className="application-card-heading">
            <View>
              <Text className="application-name">{binding.targetName || '\u672a\u547d\u540d\u7528\u6237'}</Text>
              <Text className="application-kind">{'\u624b\u673a\u53f7\uff1a'}{binding.phoneMasked}</Text>
            </View>
            <Text className="application-status status-submitted">{'\u5f85\u5ba1\u6838'}</Text>
          </View>
          <Text className="binding-created-at">{'\u7533\u8bf7\u65f6\u95f4\uff1a'}{binding.createdAt || '\u672a\u77e5'}</Text>
          {canReview && <View className="application-actions">
            <Button size="mini" disabled={bindingLocked} onClick={() => void reviewBinding(binding, 'approve')}>{bindingLocked ? '\u5904\u7406\u4e2d\u2026' : '\u6279\u51c6\u7ed1\u5b9a'}</Button>
            <Button size="mini" className="reject" disabled={bindingLocked} onClick={() => void reviewBinding(binding, 'reject')}>{'\u62d2\u7edd'}</Button>
          </View>}
        </View>;
      }) : null}
    </View>
    <View className='application-review-section'>
      <View className='application-review-heading'><Text className='application-review-title'>{'\u6b63\u5f0f\u8d26\u53f7\u7533\u8bf7'}</Text><Text className='application-review-count'>{applications.length}</Text></View>
      {!loading && !error && applications.length === 0 ? <View className='empty compact'>{'\u6682\u65e0\u8d26\u53f7\u7533\u8bf7'}</View> : null}
      {!loading && !error ? applications.map(application => {
        const payload = application.payload || {};
        const student = application.applicationType === 'student';
        const applicationLocked = lockedKeys.includes(`application:${application.id}`);
        return <View key={application.id} className='application-card'>
          <View className='application-card-heading'>
            <View><Text className='application-name'>{student ? payload.studentName : payload.name}</Text><Text className='application-kind'>{student ? (application.applicantIdentityKind === 'parent' ? '\u5bb6\u957f\u4ee3\u5b66\u751f\u7533\u8bf7' : '\u5b66\u751f\u672c\u4eba\u7533\u8bf7') : '\u8001\u5e08\u7533\u8bf7'}</Text></View>
            <Text className={`application-status status-${application.status}`}>{statusLabels[application.status] || application.status}</Text>
          </View>
          {student ? <View className='application-details'>
            <Text>{'\u5b66\u751f\u624b\u673a\u53f7\uff1a'}{payload.studentPhone}</Text><Text>{'\u5bb6\u957f\u624b\u673a\u53f7\uff1a'}{payload.parentPhone}</Text>
            <Text>{'\u5b66\u6821\u4e0e\u5e74\u7ea7\uff1a'}{payload.school}{' \u00b7 '}{payload.currentGrade}</Text><Text>{'\u5bb6\u957f\u5173\u7cfb\uff1a'}{payload.parentRelation}</Text>
          </View> : <View className='application-details'><Text>{'\u7533\u8bf7\u624b\u673a\u53f7\uff1a'}{payload.phone}</Text><Text>{'\u4efb\u6559\u5b66\u79d1\uff1a'}{payload.subject || '\u672a\u586b\u5199'}</Text></View>}
          {application.hostTaskId ? <Text className='application-host-task'>{'\u4e3b\u673a\u4efb\u52a1\uff1a'}{application.hostTaskId}</Text> : null}
          {application.rejectionReason ? <Text className='application-reason'>{'\u9000\u56de\u539f\u56e0\uff1a'}{application.rejectionReason}</Text> : null}
          {canReviewApplications ? <View className='application-actions'>
            {application.status === 'submitted' ? <><Button size='mini' disabled={applicationLocked} onClick={() => void reviewApplication(application, 'approve')}>{'\u6279\u51c6'}</Button><Button size='mini' className='reject' disabled={applicationLocked} onClick={() => void reviewApplication(application, 'reject')}>{'\u9000\u56de'}</Button></> : null}
            {['provisioning', 'manual_resolution_required'].includes(application.status) ? <Button size='mini' disabled={applicationLocked} onClick={() => void reviewApplication(application, 'retry')}>{applicationLocked ? '\u5904\u7406\u4e2d\u2026' : '\u91cd\u8bd5\u5efa\u6863'}</Button> : null}
          </View> : null}
        </View>;
      }) : null}
    </View>
    <View className="search-bar"><Input className="search-input" value={search} placeholder={'\u641c\u7d22\u59d3\u540d\u6216\u624b\u673a\u53f7'} onInput={event => setSearch(event.detail.value)} /><Button className="search-btn" onClick={() => setSubmittedSearch(search.trim())}>{'\u67e5\u8be2'}</Button></View>
    <ScrollView scrollX className="type-tabs">{statusFilters.map(item => <Text key={item || 'all'} className={`type-tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item ? statusLabels[item] : '\u5168\u90e8'}</Text>)}</ScrollView>
    <View className="user-list">
      {loading ? <View className="loading">{'\u6b63\u5728\u52a0\u8f7d\u7528\u6237\u2026'}</View> : null}
      {!loading && error ? <View className="error"><Text>{error}</Text><Button size="mini" onClick={() => void load()}>{'\u91cd\u8bd5'}</Button></View> : null}
      {!loading && !error && users.length === 0 ? <View className="empty">{'\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u7528\u6237'}</View> : null}
      {!loading && !error ? users.map(user => {
        const isFixedSuperAdmin = user.phone === SUPER_ADMIN_PHONE || user.user_type === 'super_admin' || user.role === 'super_admin';
        const userRole = user.user_type || user.role || 'pending';
        const disabled = user.status === 0 || user.login_enabled === 0;
        const userLocked = lockedKeys.includes(`user:${user.id}`);
        return <View key={user.id} className={`user-item ${disabled ? 'disabled' : ''}`}>
          <View className="user-item-info"><Text className="user-item-name">{user.name || user.nickname || '\u672a\u547d\u540d\u7528\u6237'}</Text><Text className="user-item-type">{user.phone || '\u672a\u7ed1\u5b9a\u624b\u673a\u53f7'}{' \u00b7 '}{roleLabels[userRole] || userRole}{' \u00b7 '}{disabled ? statusLabels.disabled : (statusLabels[user.review_status] || user.review_status)}</Text>{userRole === 'teacher' ? <Text className="teacher-binding">teacher_id: {user.teacher_id || '\u672a\u7ed1\u5b9a'}</Text> : null}{isFixedSuperAdmin ? <Text className="protected-badge">{'\u56fa\u5b9a\u8d85\u7ea7\u7ba1\u7406\u5458'}</Text> : null}</View>
          {canReview && !isFixedSuperAdmin ? <View className="user-actions"><Picker disabled={userLocked} mode="selector" range={roles.map(role => roleLabels[role])} value={Math.max(0, roles.indexOf(userRole as typeof roles[number]))} onChange={event => void reviewUser(user, roles[Number(event.detail.value)])}><View className="type-selector">{userLocked ? '\u4fdd\u5b58\u4e2d\u2026' : '\u5ba1\u6838\u5206\u7c7b'}</View></Picker>{!disabled ? <Button className="disable-btn" size="mini" disabled={userLocked} onClick={() => void disableUser(user)}>{'\u505c\u7528'}</Button> : null}</View> : null}
        </View>;
      }) : null}
    </View>
  </View>;
}
