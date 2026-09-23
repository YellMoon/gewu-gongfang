import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { isVisitorIdentity } from '../../utils/accountExperience';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import {
  buildRoleApplicationRequest,
  applicationErrorMessage,
  applicationErrorState,
  copyForApplicationState,
  createApplicationOperationLock,
} from './applicationRuntime';
import './index.scss';

type RequestedIdentity = 'student' | 'teacher' | 'family_member';
type ProfileMode = 'existing' | 'new';

const ROLE_OPTIONS = [
  { value: 'student' as RequestedIdentity, label: '\u5b66\u751f' },
  { value: 'teacher' as RequestedIdentity, label: '\u6559\u5e08' },
  { value: 'family_member' as RequestedIdentity, label: '\u5bb6\u5ead\u6210\u5458' },
];
const PROFILE_MODE_OPTIONS = [
  { value: 'existing' as ProfileMode, label: '\u6211\u5df2\u6709\u76f8\u5173\u8d44\u6599' },
  { value: 'new' as ProfileMode, label: '\u9996\u6b21\u767b\u8bb0' },
];

function idempotencyKey(identityId: string, requestedIdentity: RequestedIdentity, profileMode: ProfileMode, rejectedApplicationId: string): string {
  // Each rejected application closes an attempt. Persist only opaque keys, not form data.
  const scope = rejectedApplicationId ? `:after:${rejectedApplicationId}` : '';
  const storageKey = `cloud_role_application_attempt:${identityId}${scope}`;
  const existing = String(Taro.getStorageSync(storageKey) || '').trim();
  if (existing) return existing;
  const legacyKey = !rejectedApplicationId
    ? String(Taro.getStorageSync(`cloud_role_application_key:${identityId}:${requestedIdentity}:${profileMode}`) || '').trim()
    : '';
  if (legacyKey) {
    Taro.setStorageSync(storageKey, legacyKey);
    return legacyKey;
  }
  const created = `miniapp-role-${identityId}-${requestedIdentity}-${profileMode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  Taro.setStorageSync(storageKey, created);
  return created;
}

function responseData(response: any): any {
  if (!response?.success) {
    throw Object.assign(new Error(response?.error || '\u8bf7\u6c42\u5931\u8d25'), { code: response?.code });
  }
  return response.data || response;
}

export default function AccountApplicationPage() {
  const operationLock = useRef(createApplicationOperationLock());
  const visible = useRef(true);
  const requestSequence = useRef(0);
  const refreshQueued = useRef(false);
  const [state, setState] = useState('loading');
  const [application, setApplication] = useState<any>(null);
  const [roleIndex, setRoleIndex] = useState(0);
  const [profileModeIndex, setProfileModeIndex] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  useDidShow(() => { visible.current = true; void load(); });
  useDidHide(() => { visible.current = false; requestSequence.current++; });

  const applyApplication = (result: any) => {
    const nextApplication = result.application || null;
    setApplication(nextApplication);
    setState(result.state || 'not_submitted');
    if (nextApplication?.requestedIdentity) {
      setRoleIndex(nextApplication.requestedIdentity === 'teacher' ? 1 : nextApplication.requestedIdentity === 'family_member' ? 2 : 0);
      setProfileModeIndex(nextApplication.profileMode === 'new' ? 1 : 0);
    }
  };

  const load = async () => {
    const session = authSessionRuntime.capture();
    if (!visible.current) return;
    if (!isVisitorIdentity(session.identity)) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return;
    }
    if (!operationLock.current.tryAcquire('refresh')) { refreshQueued.current = true; return; }
    const sequence = ++requestSequence.current;
    const isCurrent = () => visible.current && sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setState('loading');
    try {
      const result = responseData(await miniappCloudBusinessApi.readRoleApplication(session.token));
      if (isCurrent()) applyApplication(result);
    } catch (error: any) {
      if (!isCurrent()) return;
      const message = String(error?.message || '').toLowerCase();
      setState(message.includes('network') || message.includes('\u7f51\u7edc') ? 'offline' : 'network_error');
    } finally {
      finishOperation('refresh');
    }
  };

  function finishOperation(operation: string) {
    operationLock.current.release(operation);
    if (refreshQueued.current && visible.current) {
      refreshQueued.current = false;
      void load();
    }
  }

  useEffect(() => () => { visible.current = false; requestSequence.current++; refreshQueued.current = false; }, []);

  const submit = async () => {
    const session = authSessionRuntime.capture();
    if (!visible.current || !authSessionRuntime.isSameSession(session) || !isVisitorIdentity(session.identity)) return;
    if (!operationLock.current.tryAcquire('submit')) return;
    const sequence = ++requestSequence.current;
    const isCurrent = () => visible.current && sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setState('submitting');
    const requestedIdentity = ROLE_OPTIONS[roleIndex].value;
    const profileMode = requestedIdentity === 'family_member'
      ? 'existing' as ProfileMode
      : PROFILE_MODE_OPTIONS[profileModeIndex].value;
    try {
      const request = buildRoleApplicationRequest({ requestedIdentity, profileMode, profileName, contactPhone }) as {
        requestedIdentity: RequestedIdentity;
        profileMode: ProfileMode;
        profileName: string;
        profilePhone: string;
      };
      // Reconcile a lost response/review before writing. Reading never auto-submits.
      const latest = responseData(await miniappCloudBusinessApi.readRoleApplication(session.token));
      if (!isCurrent()) return;
      if (latest.state === 'submitted' || latest.state === 'approved') {
        applyApplication(latest);
        // UTF-8: Make it explicit that edited inputs did not replace a pending request.
        Taro.showToast({ title: latest.state === 'submitted' ? '已有申请待审核，本次未提交' : '申请已通过，请重新登录', icon: 'none' });
        return;
      }
      if (!['not_submitted', 'rejected'].includes(latest.state)
        || (latest.state === 'rejected' && !latest.application?.applicationId)) throw new Error('APPLICATION_STATE_INVALID');
      const rejectedApplicationId = latest.state === 'rejected' ? latest.application.applicationId : '';
      const result = responseData(await miniappCloudBusinessApi.submitRoleApplication(
        session.token,
        request,
        idempotencyKey(String(session.identity.id), requestedIdentity, profileMode, rejectedApplicationId),
      ));
      if (!isCurrent()) return;
      applyApplication(result);
      if (result.state === 'submitted') Taro.showToast({ title: '\u89d2\u8272\u7533\u8bf7\u5df2\u63d0\u4ea4', icon: 'success' });
    } catch (error: any) {
      if (!isCurrent()) return;
      if (error?.code === 'CLOUD_ROLE_APPLICATION_IDEMPOTENCY_CONFLICT') {
        // Another response may already have committed. Never rotate/repost blindly.
        try {
          const latest = responseData(await miniappCloudBusinessApi.readRoleApplication(session.token));
          if (isCurrent()) applyApplication(latest);
        } catch (_) {
          if (isCurrent()) setState('network_error');
        }
        return;
      }
      setState(applicationErrorState(error));
      Taro.showToast({ title: applicationErrorMessage(error), icon: 'none' });
    } finally {
      finishOperation('submit');
    }
  };

  const copy = copyForApplicationState(state);
  const editable = ['not_submitted', 'invalid', 'submit_error', 'rejected'].includes(state);
  const requestedIdentity = ROLE_OPTIONS[roleIndex].value;
  const profileMode = requestedIdentity === 'family_member'
    ? 'existing' as ProfileMode
    : PROFILE_MODE_OPTIONS[profileModeIndex].value;
  const nameLabel = requestedIdentity === 'family_member'
    ? '\u5b66\u751f\u59d3\u540d'
    : '\u59d3\u540d';
  const phoneLabel = '\u5f53\u524d\u8d26\u53f7\u624b\u673a\u53f7';

  return (
      <View className='application-page'>
      {state !== 'not_submitted' && <View className={`state-card state-${state}`}>
        <Text className='state-title'>{copy.title}</Text>
        <Text className='state-description'>{copy.description}</Text>
      </View>}

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
              <Text className='label'>{'\u7533\u8bf7\u65b9\u5f0f'}</Text>
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
            <Text className='label'>{nameLabel}</Text>
            <Input
              maxlength={64}
              value={profileName}
              onInput={event => setProfileName(event.detail.value)}
              placeholder={requestedIdentity === 'family_member' ? '\u8bf7\u586b\u5199\u5b66\u751f\u7684\u771f\u5b9e\u59d3\u540d' : '\u8bf7\u586b\u5199\u771f\u5b9e\u59d3\u540d'}
            />
          </View>
          <View className='field'>
            <Text className='label'>{phoneLabel}</Text>
            <Input
              type='number'
              maxlength={11}
              value={contactPhone}
              onInput={event => setContactPhone(event.detail.value)}
              placeholder='请输入 11 位手机号'
            />
            <Text className='field-tip'>{profileMode === 'new' ? '\u5fc5\u987b\u4e0e\u672c\u6b21\u767b\u5f55\u5df2\u9a8c\u8bc1\u7684\u624b\u673a\u53f7\u4e00\u81f4\uff1b\u901a\u8fc7\u540e\u4f1a\u81ea\u52a8\u5b8c\u6210\u767b\u8bb0\u3002' : '\u5fc5\u987b\u4e0e\u672c\u6b21\u767b\u5f55\u5df2\u9a8c\u8bc1\u7684\u624b\u673a\u53f7\u4e00\u81f4\uff1b\u5ba1\u6838\u65f6\u4f1a\u6838\u5bf9\u59d3\u540d\u548c\u5df2\u6709\u8d44\u6599\u3002'}</Text>
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
