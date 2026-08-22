import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Picker, Text, View } from '@tarojs/components';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import './index.scss';

type PendingAccount = { accountId: string; status: 'pending_authorization'; createdAt: string };
type AssignableRole = 'teacher' | 'student';
type BusinessProfile = { id: string; name: string };

const ROLE_OPTIONS: Array<{ value: AssignableRole; label: string }> = [
  { value: 'teacher', label: '\u8001\u5e08' },
  { value: 'student', label: '\u5b66\u751f' },
];

export default function CloudAccountAdminPage() {
  const identity: any = Taro.getStorageSync('user_info') || {};
  const [accounts, setAccounts] = useState<PendingAccount[]>([]);
  const [roleIndexByAccount, setRoleIndexByAccount] = useState<Record<string, number>>({});
  const [profilesByRole, setProfilesByRole] = useState<Record<AssignableRole, BusinessProfile[]>>({ teacher: [], student: [] });
  const [profileIndexByAccount, setProfileIndexByAccount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState('');

  const load = async () => {
    const token = authSessionRuntime.capture().token;
    if (!token) return;
    setLoading(true);
    const response = await miniappCloudBusinessApi.listPendingAccounts(token);
    if (response.success && response.data?.accounts) setAccounts(response.data.accounts);
    else Taro.showToast({ title: response.error || '\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u65b0\u8d26\u53f7', icon: 'none' });
    setLoading(false);
  };

  useEffect(() => {
    if (identity?.token_use !== 'miniapp-cloud' || identity?.role !== 'super_admin') {
      Taro.reLaunch({ url: '/pages/schedule/index' });
      return;
    }
    void load();
    const token = authSessionRuntime.capture().token;
    if (!token) return;
    void Promise.all(ROLE_OPTIONS.map(async option => {
      const response = await miniappCloudBusinessApi.listAssignableProfiles(token, option.value);
      if (response.success && response.data?.profiles) setProfilesByRole(current => ({ ...current, [option.value]: response.data.profiles }));
    }));
  }, []);

  const assign = async (accountId: string) => {
    const token = authSessionRuntime.capture().token;
    if (!token || busyAccountId) return;
    const role = ROLE_OPTIONS[roleIndexByAccount[accountId] || 0].value;
    const profile = profilesByRole[role][profileIndexByAccount[accountId] || 0];
    if (!profile) {
      Taro.showToast({ title: '\u8bf7\u5148\u9009\u62e9\u5df2\u5bfc\u5165\u7684\u6863\u6848', icon: 'none' });
      return;
    }
    setBusyAccountId(accountId);
    const response = await miniappCloudBusinessApi.assignAccountRole(token, accountId, role, profile.id);
    if (response.success) {
      Taro.showToast({ title: '\u89d2\u8272\u5df2\u6388\u4e88', icon: 'success' });
      setAccounts(current => current.filter(account => account.accountId !== accountId));
    } else {
      Taro.showToast({ title: response.error || '\u6388\u4e88\u5931\u8d25', icon: 'none' });
    }
    setBusyAccountId('');
  };

  return <View className='cloud-account-admin-page'>
    <View className='cloud-account-admin-header'>
      <Text className='cloud-account-admin-kicker'>{'CLOUD ACCOUNT'}</Text>
      <Text className='cloud-account-admin-title'>{'\u65b0\u8d26\u53f7\u6388\u6743'}</Text>
      <Text className='cloud-account-admin-description'>{'\u4ec5\u663e\u793a\u7b49\u5f85\u89d2\u8272\u6388\u4e88\u7684\u4e91\u7aef\u8d26\u53f7\uff0c\u4e0d\u663e\u793a\u624b\u673a\u53f7\u3002'}</Text>
    </View>
    {loading ? <Text className='cloud-account-admin-empty'>{'\u6b63\u5728\u8bfb\u53d6\u2026'}</Text> : null}
    {!loading && accounts.length === 0 ? <Text className='cloud-account-admin-empty'>{'\u5f53\u524d\u6ca1\u6709\u5f85\u6388\u6743\u8d26\u53f7'}</Text> : null}
    {accounts.map(account => {
      const roleIndex = roleIndexByAccount[account.accountId] || 0;
      const role = ROLE_OPTIONS[roleIndex].value;
      const profiles = profilesByRole[role];
      const profileIndex = profileIndexByAccount[account.accountId] || 0;
      return <View className='cloud-account-admin-card' key={account.accountId}>
        <Text className='cloud-account-admin-id'>{account.accountId}</Text>
        <Text className='cloud-account-admin-time'>{'\u521b\u5efa\u4e8e '}{account.createdAt}</Text>
        <Picker mode='selector' range={ROLE_OPTIONS.map(option => option.label)} value={roleIndex} onChange={event => {
          setRoleIndexByAccount(current => ({ ...current, [account.accountId]: Number(event.detail.value) }));
          setProfileIndexByAccount(current => ({ ...current, [account.accountId]: 0 }));
        }}>
          <View className='cloud-account-admin-picker'>{ROLE_OPTIONS[roleIndex].label}<Text>{'\u203a'}</Text></View>
        </Picker>
        <Picker mode='selector' range={profiles.map(profile => profile.name)} value={profileIndex} disabled={profiles.length === 0} onChange={event => setProfileIndexByAccount(current => ({ ...current, [account.accountId]: Number(event.detail.value) }))}>
          <View className='cloud-account-admin-picker'>{profiles[profileIndex]?.name || '\u6682\u65e0\u53ef\u7ed1\u5b9a\u6863\u6848'}<Text>{'\u203a'}</Text></View>
        </Picker>
        <Button className='cloud-account-admin-action' loading={busyAccountId === account.accountId} disabled={Boolean(busyAccountId)} onClick={() => void assign(account.accountId)}>{'\u6388\u4e88\u89d2\u8272'}</Button>
      </View>;
    })}
  </View>;
}
