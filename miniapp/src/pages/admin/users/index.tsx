import { useEffect, useState } from 'react';
import { View, Text, Button, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { adminApi } from '../../../utils/api';
import './index.scss';

const roles = ['admin', 'teacher', 'student'];
const labels: Record<string, string> = { admin: '\u7ba1\u7406\u5458', teacher: '\u6559\u5e08', student: '\u5b66\u751f', pending: '\u5f85\u5ba1\u6838' };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [pairings, setPairings] = useState<any[]>([]);
  const load = async () => {
    const [userResult, pairingResult]: any[] = await Promise.all([adminApi.getUsers({ page: 1 }), adminApi.getPendingPairings()]);
    setUsers(userResult.data?.users || []);
    setPairings(pairingResult.data?.items || pairingResult.items || []);
  };
  useEffect(() => { load(); }, []);
  const setRole = async (id: string, role: string) => {
    const result = await adminApi.reviewUser(id, role);
    Taro.showToast({ title: result.success ? '\u5df2\u66f4\u65b0' : (result.error || '\u66f4\u65b0\u5931\u8d25'), icon: result.success ? 'success' : 'error' });
    if (result.success) await load();
  };
  const review = async (code: string, action: 'approve' | 'reject') => { await adminApi.reviewPairingCode(code, action); await load(); };
  return <View className="admin-page">
    <Text className="admin-title">{'\u7528\u6237\u4e0e\u8bbe\u5907\u5ba1\u6838'}</Text>
    {pairings.map(item => <View key={item.id}><Text>{item.deviceName} {item.phone}</Text><Button size="mini" onClick={() => review(item.pairingCode, 'approve')}>{'\u6279\u51c6'}</Button><Button size="mini" onClick={() => review(item.pairingCode, 'reject')}>{'\u62d2\u7edd'}</Button></View>)}
    {users.map(user => <View key={user.id} className="user-item"><Text>{user.name} {labels[user.review_status === 'pending' ? 'pending' : user.user_type]}</Text><Picker mode="selector" range={roles.map(role => labels[role])} value={Math.max(0, roles.indexOf(user.user_type))} onChange={event => setRole(user.id, roles[Number(event.detail.value)])}><View>{'\u4fee\u6539\u89d2\u8272'}</View></Picker></View>)}
  </View>;
}
