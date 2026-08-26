import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { isVisitorIdentity } from '../../utils/accountExperience';
import { miniappCloudBusinessApi } from '../../utils/api';
import {
  buildRoleApplicationRequest,
  copyForApplicationState,
  createApplicationOperationLock,
} from './applicationRuntime';
import './index.scss';

type RequestedIdentity = 'student' | 'teacher' | 'family_member';
type ProfileMode = 'existing' | 'new';

const ROLE_OPTIONS = [
  { value: 'student' as RequestedIdentity, label: '\u5b66\u751f' },
  { value: 'teacher' as RequestedIdentity, label: '\u8001\u5e08' },
  { value: 'family_member' as RequestedIdentity, label: '\u5bb6\u5ead\u6210\u5458' },
];
const PROFILE_MODE_OPTIONS = [
  { value: 'existing' as ProfileMode, label: '\u5173\u8054\u5df2\u6709\u6863\u6848' },
  { value: 'new' as ProfileMode, label: '\u65b0\u5efa\u6863\u6848' },
];

function idempotencyKey(identityId: string, requestedIdentity: RequestedIdentity, profileMode: ProfileMode): string {
  const storageKey = `cloud_role_application_key:${identityId}:${requestedIdentity}:${profileMode}`;
  const existing = String(Taro.getStorageSync(storageKey) || '').trim();
  if (existing) return existing;
  const created = `miniapp-role-${identityId}-${requestedIdentity}-${profileMode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  Taro.setStorageSync(storageKey, created);
  return created;
}

function responseData(response: any): any {
  if (!response?.success) throw new Error(response?.error || '\u8bf7\u6c42\u5931\u8d25');
  return response.data || response;
}

export default function AccountApplicationPage() {
  const identity: any = Taro.getStorageSync('user_info') || {};
  const operationLock = useRef(createApplicationOperationLock());
  const [state, setState] = useState('loading');
  const [application, setApplication] = useState<any>(null);
  const [roleIndex, setRoleIndex] = useState(0);
  const [profileModeIndex, setProfileModeIndex] = useState(0);
  const [bindingHint, setBindingHint] = useState('');

  const load = async () => {
    if (!operationLock.current.tryAcquire('refresh')) return;
    setState('loading');
    try {
      const token = String(Taro.getStorageSync('auth_token') || '').trim();
      const result = responseData(await miniappCloudBusinessApi.readRoleApplication(token));
      const nextApplication = result.application || null;
      setApplication(nextApplication);
      setState(result.state || 'not_submitted');
      if (nextApplication?.requestedIdentity) {
        setRoleIndex(nextApplication.requestedIdentity === 'teacher' ? 1 : nextApplication.requestedIdentity === 'family_member' ? 2 : 0);
      }
      if (nextApplication?.profileMode === 'new') setProfileModeIndex(1);
      if (nextApplication?.bindingHint) setBindingHint(nextApplication.bindingHint);
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      setState(message.includes('network') || message.includes('\u7f51\u7edc') ? 'offline' : 'network_error');
    } finally {
      operationLock.current.release('refresh');
    }
  };

  useEffect(() => {
    if (!isVisitorIdentity(identity)) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return;
    }
    void load();
  }, []);

  const submit = async () => {
    if (!operationLock.current.tryAcquire('submit')) return;
    setState('submitting');
    const requestedIdentity = ROLE_OPTIONS[roleIndex].value;
    const profileMode = requestedIdentity === 'family_member'
      ? 'existing' as ProfileMode
      : PROFILE_MODE_OPTIONS[profileModeIndex].value;
    try {
      const request = buildRoleApplicationRequest({ requestedIdentity, profileMode, bindingHint }) as {
        requestedIdentity: RequestedIdentity;
        profileMode: ProfileMode;
        bindingHint: string;
      };
      const token = String(Taro.getStorageSync('auth_token') || '').trim();
      const result = responseData(await miniappCloudBusinessApi.submitRoleApplication(
        token,
        request,
        idempotencyKey(String(identity.id), requestedIdentity, profileMode),
      ));
      setApplication(result.application || null);
      setState(result.state || 'submitted');
      Taro.showToast({ title: '\u89d2\u8272\u7533\u8bf7\u5df2\u63d0\u4ea4', icon: 'success' });
    } catch (error: any) {
      setState('invalid');
      Taro.showToast({ title: error?.message || '\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', icon: 'none' });
    } finally {
      operationLock.current.release('submit');
    }
  };

  const copy = copyForApplicationState(state);
  const editable = ['not_submitted', 'invalid', 'rejected'].includes(state);
  const requestedIdentity = ROLE_OPTIONS[roleIndex].value;
  const profileMode = requestedIdentity === 'family_member'
    ? 'existing' as ProfileMode
    : PROFILE_MODE_OPTIONS[profileModeIndex].value;

  return (
      <View className='application-page'>
      <View className={`state-card state-${state}`}>
        <Text className='state-kicker'>{'\u8d26\u53f7\u8eab\u4efd\u7533\u8bf7'}</Text>
        <Text className='state-title'>{copy.title}</Text>
        <Text className='state-description'>{copy.description}</Text>
      </View>

      {editable ? (
        <View className='application-form'>
          <Text className='section-title'>{'\u9009\u62e9\u8eab\u4efd'}</Text>
          <Picker
            mode='selector'
            range={ROLE_OPTIONS.map(option => option.label)}
            value={roleIndex}
            onChange={event => setRoleIndex(Number(event.detail.value))}
          >
            <View className='picker-value'>
              {ROLE_OPTIONS[roleIndex].label} <Text>{'\u203a'}</Text>
            </View>
          </Picker>

          {requestedIdentity !== 'family_member' ? (
            <View className='field'>
              <Text className='label'>{'\u6863\u6848\u65b9\u5f0f'}</Text>
              <Picker
                mode='selector'
                range={PROFILE_MODE_OPTIONS.map(option => option.label)}
                value={profileModeIndex}
                onChange={event => setProfileModeIndex(Number(event.detail.value))}
              >
                <View className='picker-value'>
                  {PROFILE_MODE_OPTIONS[profileModeIndex].label} <Text>{'\u203a'}</Text>
                </View>
              </Picker>
            </View>
          ) : null}

          <View className='field'>
            <Text className='label'>{profileMode === 'new' ? '\u65b0\u6863\u6848\u4fe1\u606f' : '\u5df2\u6709\u6863\u6848\u4fe1\u606f'}</Text>
            <Input
              maxlength={128}
              value={bindingHint}
              onInput={event => setBindingHint(event.detail.value)}
              placeholder={profileMode === 'new' ? '\u8bf7\u586b\u5199\u59d3\u540d\u548c\u5907\u6ce8\u4fe1\u606f' : '\u8bf7\u586b\u5199\u5df2\u6709\u6863\u6848\u7684\u540d\u79f0\u6216\u7f16\u53f7'}
            />
            <Text className='field-tip'>{profileMode === 'new' ? '\u5ba1\u6838\u901a\u8fc7\u540e\u4f1a\u5efa\u7acb\u6863\u6848\u5e76\u5b8c\u6210\u8eab\u4efd\u7ed1\u5b9a\u3002' : '\u5ba1\u6838\u65f6\u4f1a\u6838\u5bf9\u4fe1\u606f\u5e76\u5173\u8054\u6863\u6848\u3002'}</Text>
          </View>

          <Button
            className='primary-action'
            disabled={state === 'submitting'}
            loading={state === 'submitting'}
            onClick={() => void submit()}
          >
            {'\u63d0\u4ea4\u7533\u8bf7'}
          </Button>
        </View>
      ) : null}

      {['submitted', 'approved', 'offline', 'network_error'].includes(state)
        ? <Button className='secondary-action' onClick={() => void load()}>{'\u5237\u65b0\u72b6\u6001'}</Button>
        : null}
    </View>
  );
}
