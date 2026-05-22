import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Button, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { adminApi } from '../../../utils/api';
import './index.scss';

// 有效期选项
const EXPIRY_OPTIONS = [
  { label: '永久有效', value: '' },
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' },
  { label: '90天', value: '90d' },
  { label: '1年', value: '1y' },
];

function getExpiryDate(option: string): string | undefined {
  if (!option) return undefined;
  const now = new Date();
  switch (option) {
    case '7d': now.setDate(now.getDate() + 7); break;
    case '30d': now.setDate(now.getDate() + 30); break;
    case '90d': now.setDate(now.getDate() + 90); break;
    case '1y': now.setFullYear(now.getFullYear() + 1); break;
    default: return undefined;
  }
  return now.toISOString();
}

// 全量权限列表（用于授予权限选择）
const ALL_PERMISSIONS = [
  { id: 'scheduling:view', module_id: 'scheduling', action: 'view', description: '查看排课（仅自己相关）' },
  { id: 'scheduling:edit', module_id: 'scheduling', action: 'edit', description: '编辑排课' },
  { id: 'scheduling:delete', module_id: 'scheduling', action: 'delete', description: '删除排课' },
  { id: 'scheduling:view_all', module_id: 'scheduling', action: 'view_all', description: '查看所有课程排课' },
  { id: 'question-bank:view', module_id: 'question-bank', action: 'view', description: '做题/查看/组卷/导出/批改' },
  { id: 'question-bank:edit', module_id: 'question-bank', action: 'edit', description: '编辑题目/导入/管理知识点' },
  { id: 'teaching-tools:view', module_id: 'teaching-tools', action: 'view', description: '使用教学工具' },
  { id: 'assets:view', module_id: 'assets', action: 'view', description: '查看资产' },
  { id: 'assets:edit', module_id: 'assets', action: 'edit', description: '编辑资产' },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userPermissions, setUserPermissions] = useState<any[]>([]);
  const [showGrantPanel, setShowGrantPanel] = useState(false);
  const [expiryOption, setExpiryOption] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params: any = { page };
      if (search) params.search = search;
      if (typeFilter !== 'all') params.user_type = typeFilter;
      const res = await adminApi.getUsers(params);
      if (res.success && res.data) {
        setUsers(res.data.users);
        setTotal(res.data.total);
      }
    } catch (err) {
      console.error('加载用户失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, typeFilter]);

  const handleSearch = () => {
    setPage(1);
    loadUsers();
  };

  const handleSelectUser = async (user: any) => {
    setSelectedUser(user);
    setShowGrantPanel(false);
    const res = await adminApi.getUserPermissions(user.id);
    if (res.success && res.data) {
      const payload = res.data as any;
      setUserPermissions(Array.isArray(payload) ? payload : (payload.permissions || []));
    }
  };

  const handleChangeType = async (userId: string, newType: string) => {
    const res = await adminApi.setUserType(userId, newType);
    if (res.success) {
      Taro.showToast({ title: '类型已更新', icon: 'success' });
      loadUsers();
    } else {
      Taro.showToast({ title: res.error || '更新失败', icon: 'error' });
    }
  };

  const handleGrant = async (permissionId: string) => {
    if (!selectedUser) return;
    const expiresAt = getExpiryDate(expiryOption);
    const res = await adminApi.grantPermission(selectedUser.id, permissionId, expiresAt);
    if (res.success) {
      Taro.showToast({ title: expiresAt ? `已授予（有效期至 ${expiresAt.slice(0,10)}）` : '已授予（永久）', icon: 'success' });
      const permRes = await adminApi.getUserPermissions(selectedUser.id);
      if (permRes.success && permRes.data) {
        const payload = permRes.data as any;
        setUserPermissions(Array.isArray(payload) ? payload : (payload.permissions || []));
      }
    } else {
      Taro.showToast({ title: res.error || '操作失败', icon: 'error' });
    }
  };

  const handleRevoke = async (permissionId: string) => {
    if (!selectedUser) return;
    const res = await adminApi.revokePermission(selectedUser.id, permissionId);
    if (res.success) {
      Taro.showToast({ title: '已撤销', icon: 'success' });
      // 刷新权限列表
      const permRes = await adminApi.getUserPermissions(selectedUser.id);
      if (permRes.success && permRes.data) {
        const payload = permRes.data as any;
        setUserPermissions(Array.isArray(payload) ? payload : (payload.permissions || []));
      }
    } else {
      Taro.showToast({ title: res.error || '操作失败', icon: 'error' });
    }
  };

  const isPermissionGranted = (permId: string) => {
    return userPermissions.some((p: any) => String(p.id) === String(permId) && p.status === 1);
  };

  const userTypeOptions = ['admin', 'teacher', 'student', 'invited'];
  const userTypeLabels: Record<string, string> = {
    admin: '管理员', teacher: '教师', student: '学生', invited: '被邀请者'
  };

  return (
    <View className="admin-page">
      <View className="admin-header">
        <Text className="admin-title">用户管理</Text>
        <Text className="admin-total">共 {total} 人</Text>
      </View>

      {/* 搜索栏 */}
      <View className="search-bar">
        <Input
          className="search-input"
          placeholder="搜索用户名或手机号"
          value={search}
          onInput={(e) => setSearch(e.detail.value)}
          onConfirm={handleSearch}
        />
        <Button className="search-btn" onClick={handleSearch}>搜索</Button>
      </View>

      {/* 类型筛选 */}
      <ScrollView className="type-tabs" scrollX>
        {['all', ...userTypeOptions].map(t => (
          <Text
            key={t}
            className={`type-tab ${typeFilter === t ? 'active' : ''}`}
            onClick={() => setTypeFilter(t)}
          >
            {t === 'all' ? '全部' : userTypeLabels[t]}
          </Text>
        ))}
      </ScrollView>

      {/* 用户列表 */}
      <ScrollView className="user-list" scrollY>
        {loading ? (
          <View className="loading"><Text>加载中...</Text></View>
        ) : users.length === 0 ? (
          <View className="empty"><Text>暂无用户</Text></View>
        ) : (
          users.map(user => (
            <View
              key={user.id}
              className={`user-item ${selectedUser?.id === user.id ? 'selected' : ''}`}
              onClick={() => handleSelectUser(user)}
            >
              <View className="user-avatar-circle">
                <Text>{user.name?.charAt(0) || '?'}</Text>
              </View>
              <View className="user-item-info">
                <Text className="user-item-name">{user.name}</Text>
                <Text className="user-item-type">{userTypeLabels[user.user_type]}</Text>
              </View>
              <Picker
                mode="selector"
                range={userTypeOptions}
                rangeKey="0"
                value={userTypeOptions.indexOf(user.user_type)}
                onChange={(e) => handleChangeType(user.id, userTypeOptions[Number(e.detail.value)])}
              >
                <View className="type-selector">
                  <Text className="type-text">{userTypeLabels[user.user_type]}</Text>
                  <Text className="arrow">▼</Text>
                </View>
              </Picker>
            </View>
          ))
        )}
      </ScrollView>

      {/* 用户权限面板 */}
      {selectedUser && (
        <View className="permission-panel">
          <View className="panel-header">
            <Text className="panel-title">{selectedUser.name} 的权限</Text>
            <Text className="panel-close" onClick={() => { setSelectedUser(null); setShowGrantPanel(false); }}>关闭</Text>
          </View>

          {!showGrantPanel ? (
            <>
              <ScrollView className="perm-list" scrollY>
                {userPermissions.length === 0 ? (
                  <Text className="no-perm">暂无显式权限（管理员拥有全部权限）</Text>
                ) : (
                  userPermissions.map((p: any) => (
                    <View key={p.id} className="perm-item">
                      <View className="perm-info">
                        <Text className="perm-action">{p.module_id}:{p.action}</Text>
                        <Text className="perm-desc">{p.description}</Text>
                        {p.expires_at && (
                          <Text className="perm-expiry">有效期至: {p.expires_at.slice(0, 10)}</Text>
                        )}
                      </View>
                      <View className="perm-right">
                        <Text className={`perm-status ${p.status === 1 ? 'active' : ''}`}>
                          {p.status === 1 ? '有效' : '已撤销'}
                        </Text>
                        {p.status === 1 && (
                          <Text className="perm-revoke" onClick={() => handleRevoke(String(p.id))}>撤销</Text>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
              <View className="grant-btn-wrap">
                <Button className="grant-btn" onClick={() => setShowGrantPanel(true)}>
                  授予权限
                </Button>
              </View>
            </>
          ) : (
            <>
              <ScrollView className="perm-list" scrollY>
                {/* 有效期选择 */}
                <View className="expiry-section">
                  <Text className="expiry-label">有效期：</Text>
                  <ScrollView className="expiry-tabs" scrollX>
                    {EXPIRY_OPTIONS.map(opt => (
                      <Text
                        key={opt.value}
                        className={`expiry-tab ${expiryOption === opt.value ? 'active' : ''}`}
                        onClick={() => setExpiryOption(opt.value)}
                      >
                        {opt.label}
                      </Text>
                    ))}
                  </ScrollView>
                </View>
                {ALL_PERMISSIONS.map((perm) => {
                  const granted = isPermissionGranted(perm.id);
                  return (
                    <View key={perm.id} className="perm-item">
                      <View className="perm-info">
                        <Text className="perm-action">{perm.module_id}:{perm.action}</Text>
                        <Text className="perm-desc">{perm.description}</Text>
                      </View>
                      <View className="perm-right">
                        {granted ? (
                          <>
                            <Text className="perm-status active">已授予</Text>
                            <Text className="perm-revoke" onClick={() => handleRevoke(perm.id)}>撤销</Text>
                          </>
                        ) : (
                          <Text className="perm-grant" onClick={() => handleGrant(perm.id)}>授予</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <View className="grant-btn-wrap">
                <Button className="grant-btn back" onClick={() => setShowGrantPanel(false)}>
                  返回权限列表
                </Button>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}
