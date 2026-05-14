import { useState, useEffect } from 'react';
import { View, Text, Input, Button, ScrollView, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { invitationApi } from '../../../utils/api';
import './index.scss';

export default function AdminInvitationsPage() {
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetPhone, setTargetPhone] = useState('');

  const loadInvitations = async () => {
    setLoading(true);
    try {
      const res = await invitationApi.list();
      if (res.success && res.data) {
        const payload = res.data as any;
        setInvitations(Array.isArray(payload) ? payload : (payload.invitations || []));
      }
    } catch (err) {
      console.error('加载邀请码失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInvitations(); }, []);

  const handleCreate = async () => {
    if (!targetName.trim()) {
      Taro.showToast({ title: '请输入邀请对象名称', icon: 'error' });
      return;
    }
    try {
      const res = await invitationApi.create({ target_name: targetName });
      if (res.success && res.data) {
        setShowCreate(false);
        setTargetName('');
        setTargetPhone('');
        loadInvitations();
        // 显示邀请码
        Taro.showModal({
          title: '邀请码已创建',
          content: `邀请码: ${res.data.code}\n有效期: 30天`,
          success: () => {
            Taro.setClipboardData({ data: res.data.code });
          }
        });
      } else {
        Taro.showToast({ title: res.error || '创建失败', icon: 'error' });
      }
    } catch (err) {
      Taro.showToast({ title: '创建失败', icon: 'error' });
    }
  };

  const handleRevoke = (id: string) => {
    Taro.showModal({
      title: '确认撤销',
      content: '确定要撤销该邀请码吗？',
      success: async (res) => {
        if (res.confirm) {
          const result = await invitationApi.revoke(id);
          if (result.success) {
            Taro.showToast({ title: '已撤销', icon: 'success' });
            loadInvitations();
          }
        }
      },
    });
  };

  const statusLabels: Record<number, string> = {
    0: '待使用', 1: '已使用', 2: '已过期'
  };
  const statusColors: Record<number, string> = {
    0: '#1890ff', 1: '#52c41a', 2: '#999'
  };

  return (
    <View className="admin-page">
      <View className="admin-header">
        <Text className="admin-title">邀请管理</Text>
        <Button className="add-btn" onClick={() => setShowCreate(true)}>
          + 创建邀请码
        </Button>
      </View>

      {/* 创建邀请码表单 */}
      {showCreate && (
        <View className="create-form">
          <Input
            className="form-input"
            placeholder="被邀请人姓名"
            value={targetName}
            onInput={(e) => setTargetName(e.detail.value)}
          />
          <View className="form-actions">
            <Button className="cancel-btn" onClick={() => setShowCreate(false)}>取消</Button>
            <Button className="submit-btn" onClick={handleCreate}>创建</Button>
          </View>
        </View>
      )}

      {/* 邀请码列表 */}
      <ScrollView className="invitation-list" scrollY>
        {loading ? (
          <View className="loading"><Text>加载中...</Text></View>
        ) : invitations.length === 0 ? (
          <View className="empty"><Text>暂无邀请记录</Text></View>
        ) : (
          invitations.map((inv) => (
            <View key={inv.id} className="invitation-item">
              <View className="inv-top">
                <View className="inv-code">
                  <Text className="code-text">{inv.code}</Text>
                  <Text
                    className="copy-btn"
                    onClick={() => Taro.setClipboardData({ data: inv.code })}
                  >
                    复制
                  </Text>
                </View>
                <Text className="inv-status" style={{ color: statusColors[inv.status] || '#999' }}>
                  {statusLabels[inv.status] || '未知'}
                </Text>
              </View>
              {inv.target_name && (
                <Text className="inv-target">目标: {inv.target_name}</Text>
              )}
              <View className="inv-meta">
                <Text className="inv-date">
                  创建: {new Date(inv.created_at).toLocaleDateString('zh-CN')}
                </Text>
                {inv.status === 0 && (
                  <Text className="revoke-btn" onClick={() => handleRevoke(inv.id)}>撤销</Text>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
