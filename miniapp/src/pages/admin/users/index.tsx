import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Button, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { adminApi } from '../../../utils/api';
import { fetchPermissions, getCurrentUser } from '../../../utils/permission';
import { createLatestRequestCoordinator, createOperationLocks } from './adminReviewCoordinator';
import './index.scss';

const roleLabels: Record<string, string> = {
  super_admin: '\u8d85\u7ea7\u7ba1\u7406\u5458', admin: '\u666e\u901a\u7ba1\u7406\u5458',
  teacher: '\u8001\u5e08', student: '\u5b66\u751f', pending: '\u5f85\u5206\u7c7b',
};
const statusLabels: Record<string, string> = {
  pending: '\u5f85\u5ba1\u6838', approved: '\u5df2\u901a\u8fc7', rejected: '\u5df2\u62d2\u7edd', disabled: '\u5df2\u505c\u7528',
};
const statusFilters = ['', 'pending', 'approved', 'rejected'];

function isSuperAdmin(user: any): boolean {
  return user?.user_type === 'super_admin' || user?.role === 'super_admin';
}

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
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    await loadCoordinator.current.run(async () => {
      const permissionResult = await fetchPermissions();
      const nextCapabilities = permissionResult.capabilities || [];
      const canRead = nextCapabilities.includes('business:all');
      if (!canRead) throw new Error('\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u67e5\u770b\u7528\u6237\u5206\u7c7b');
      const query = queryRef.current;
      const userResult = await adminApi.getUsers({
        page: 1,
        search: query.submittedSearch,
        review_status: query.status,
      });
      if (!userResult.success) throw new Error(errorMessage(userResult, '\u7528\u6237\u52a0\u8f7d\u5931\u8d25'));
      return {
        nextCapabilities,
        users: userResult.data?.users || [],
      };
    }, result => {
      setCapabilities(result.nextCapabilities);
      setUsers(result.users);
    }, (caught: any) => {
      setCapabilities([]);
      setError(caught?.message || '\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
      setUsers([]);
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

  const disableUser = async (user: any) => {
    if (!canReview || isSuperAdmin(user)) return;
    await runLocked(`user:${user.id}`, async () => {
      const modal = await Taro.showModal({ title: '\u505c\u7528\u7528\u6237', content: `\u786e\u8ba4\u505c\u7528 ${user.name || user.phone}\uff1f\u505c\u7528\u540e\u5c06\u65e0\u6cd5\u767b\u5f55\u3002` });
      if (!modal.confirm) return;
      const result: any = await adminApi.disableUser(user.id);
      if (!result.success) return void Taro.showToast({ title: errorMessage(result, '\u505c\u7528\u5931\u8d25'), icon: 'none' });
      Taro.showToast({ title: '\u5df2\u505c\u7528', icon: 'success' });
      await load();
    });
  };

  const currentRole = currentUser?.user_type;
  return <View className="admin-page">
    <View className="admin-header"><View><Text className="admin-title">{'\u7528\u6237\u6743\u9650'}</Text><Text className="admin-subtitle">{'\u89d2\u8272\u7533\u8bf7\u5df2\u8f6c\u79fb\u5230\u6570\u636e\u4e3b\u673a\u7684\u7b7e\u540d\u5ba1\u6838\u5de5\u4f5c\u53f0'}</Text></View></View>
    {currentRole === 'admin' && !canReview ? <View className="read-only-notice">{'\u666e\u901a\u7ba1\u7406\u5458\u53ef\u67e5\u770b\u8131\u654f\u7528\u6237\u72b6\u6001\uff0c\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u5904\u7406\u8d26\u53f7\u63a7\u5236\u64cd\u4f5c\u3002'}</View> : null}
    <View className="search-bar"><Input className="search-input" value={search} placeholder={'\u641c\u7d22\u59d3\u540d\u6216\u624b\u673a\u53f7'} onInput={event => setSearch(event.detail.value)} /><Button className="search-btn" onClick={() => setSubmittedSearch(search.trim())}>{'\u67e5\u8be2'}</Button></View>
    <ScrollView scrollX className="type-tabs">{statusFilters.map(item => <Text key={item || 'all'} className={`type-tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item ? statusLabels[item] : '\u5168\u90e8'}</Text>)}</ScrollView>
    <View className="user-list">
      {loading ? <View className="loading">{'\u6b63\u5728\u52a0\u8f7d\u7528\u6237\u2026'}</View> : null}
      {!loading && error ? <View className="error"><Text>{error}</Text><Button size="mini" onClick={() => void load()}>{'\u91cd\u8bd5'}</Button></View> : null}
      {!loading && !error && users.length === 0 ? <View className="empty">{'\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u7528\u6237'}</View> : null}
      {!loading && !error ? users.map(user => {
        const isFixedSuperAdmin = isSuperAdmin(user);
        const userRole = user.user_type || user.role || 'pending';
        const disabled = user.status === 0 || user.login_enabled === 0;
        const userLocked = lockedKeys.includes(`user:${user.id}`);
        return <View key={user.id} className={`user-item ${disabled ? 'disabled' : ''}`}>
          <View className="user-item-info"><Text className="user-item-name">{user.name || user.nickname || '\u672a\u547d\u540d\u7528\u6237'}</Text><Text className="user-item-type">{user.phone || '\u672a\u7ed1\u5b9a\u624b\u673a\u53f7'}{' \u00b7 '}{roleLabels[userRole] || userRole}{' \u00b7 '}{disabled ? statusLabels.disabled : (statusLabels[user.review_status] || user.review_status)}</Text>{userRole === 'teacher' ? <Text className="teacher-binding">teacher_id: {user.teacher_id || '\u672a\u7ed1\u5b9a'}</Text> : null}{isFixedSuperAdmin ? <Text className="protected-badge">{'\u56fa\u5b9a\u8d85\u7ea7\u7ba1\u7406\u5458'}</Text> : null}</View>
          {canReview && !isFixedSuperAdmin && !disabled ? <View className="user-actions"><Button className="disable-btn" size="mini" disabled={userLocked} onClick={() => void disableUser(user)}>{userLocked ? '\u4fdd\u5b58\u4e2d\u2026' : '\u505c\u7528'}</Button></View> : null}
        </View>;
      }) : null}
    </View>
  </View>;
}
